import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fetchPage } from '../lib/temporal/fetch.js'
import { extractPage } from '../lib/temporal/extract.js'
import { parseDate } from '../lib/temporal/time.js'
import { clearRobotsCache, robotsAllowed } from '../lib/temporal/robots.js'
import { analyzeCase } from '../lib/temporal/analyze.js'
import { generateReport } from '../lib/temporal/report.js'
import { addDateAssertion, addEvent, addSource, createCase } from '../lib/temporal/store.js'
import { createTemporalTools } from '../lib/dsh/temporal-tools.js'
import { createSourceTools } from '../lib/dsh/source-tools.js'
import { registerCommand } from '../lib/dsh/command.js'

test('date parser keeps precision, intervals, and timezone provenance', () => {
  const day = parseDate('2024-03-15')
  assert.equal(day.precision, 'day')
  assert.equal(day.timeZone, null)
  assert.equal(day.earliest, '2024-03-15T00:00:00.000Z')
  assert.equal(day.latest, '2024-03-16T00:00:00.000Z')

  const offset = parseDate('2024-03-15T10:00:00+08:00')
  assert.equal(offset.earliest, '2024-03-15T02:00:00.000Z')
  assert.equal(offset.timeZone, '+08:00')
  assert.equal(offset.uncertain, false)

  const chinese = parseDate('2024年3月15日 14:30 北京时间')
  assert.equal(chinese.earliest, '2024-03-15T06:30:00.000Z')
  assert.equal(chinese.precision, 'minute')

  assert.equal(parseDate('03/04/2024'), null)
  assert.equal(parseDate('近日'), null)
  const relative = parseDate('昨天 09:30', { anchor: '2024-03-20T00:00:00Z' })
  assert.equal(relative.earliest, '2024-03-19T09:30:00.000Z')
})

test('HTML extraction separates published, updated, and observed candidates', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'last-modified': 'Thu, 21 Mar 2024 10:00:00 GMT' })
      res.end(`<!doctype html><html><head><title>Factory announcement</title>
        <meta property="article:published_time" content="2024-03-15T10:00:00+08:00">
        <meta property="article:modified_time" content="2024-03-16T10:00:00+08:00">
        <script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2024-03-15T10:00:00+08:00"}</script>
        </head><body>The factory closed on 15 March 2024.</body></html>`)
      return
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const page = await fetchPage(`http://127.0.0.1:${port}/page`, { allowPrivateHosts: true })
    const extracted = extractPage(page)
    assert.equal(extracted.title, 'Factory announcement')
    assert.ok(extracted.timeCandidates.some((candidate) => candidate.field === 'published' && candidate.parsed?.timeZone === '+08:00' && candidate.teg === 'T2'))
    assert.ok(extracted.timeCandidates.some((candidate) => candidate.field === 'updated' && candidate.source === 'http.last-modified'))
    assert.ok(extracted.timeCandidates.some((candidate) => candidate.field === 'observed'))
    assert.match(page.sha256, /^[0-9a-f]{64}$/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('store, conflict analysis, and report stay deterministic and non-verdict', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-temporal-'))
  try {
    const record = await createCase(root, { title: 'Factory closure', question: 'When did the factory close?' })
    const base = {
      requestedUrl: 'https://a.example/story', finalUrl: 'https://a.example/story', httpStatus: 200,
      contentType: 'text/html', charset: 'utf-8', fetchedAt: '2024-03-22T00:00:00.000Z', byteLength: 10,
      sha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), text: 'The factory closed on 2024-03-15.',
      headers: {}, redirects: [], access: 'open', domain: 'a.example',
    }
    const sourceA = await addSource(root, record.caseId, { ...base }, { title: 'A', sourceClass: 'media', timeCandidates: [] })
    const sourceB = await addSource(root, record.caseId, { ...base, requestedUrl: 'https://b.example/story', finalUrl: 'https://b.example/story', domain: 'b.example', text: 'The factory closed on 2024-03-20.' }, { title: 'B', sourceClass: 'media', timeCandidates: [] })
    const event = await addEvent(root, record.caseId, { label: 'Factory closed', category: 'corporate', sourceIds: [sourceA.sourceId, sourceB.sourceId] })
    await addDateAssertion(root, record.caseId, { eventId: event.eventId, sourceId: sourceA.sourceId, rawText: '2024-03-15T00:00:00+08:00', role: 'event', parsed: parseDate('2024-03-15T00:00:00+08:00'), anchor: null, span: null, quoteSha256: 'c'.repeat(64) })
    await addDateAssertion(root, record.caseId, { eventId: event.eventId, sourceId: sourceB.sourceId, rawText: '2024-03-20T00:00:00+08:00', role: 'event', parsed: parseDate('2024-03-20T00:00:00+08:00'), anchor: null, span: null, quoteSha256: 'd'.repeat(64) })
    const analysis = await analyzeCase(root, record.caseId)
    assert.equal(analysis.conflicts.some((conflict) => conflict.type === 'hard_time'), true)
    assert.equal(analysis.evidence, undefined)
    assert.equal(analysis.timeline.length, 1)
    assert.equal(analysis.timeline[0].status, 'contested')
    assert.equal(analysis.timeline[0].evidence.band, 'low')
    assert.equal(analysis.coverage.domains.length, 2)

    const report = await generateReport(root, record.caseId, { audience: 'editor' })
    assert.equal(report.files.length, 5)
    const reportText = await readFile(path.join(root, 'cases', record.caseId, 'reports', report.reportId, 'report.md'), 'utf8')
    assert.match(reportText, /不是真伪裁决/)
    assert.doesNotMatch(reportText, /<html/i)
    const manifest = JSON.parse(await readFile(path.join(root, 'cases', record.caseId, 'reports', report.reportId, 'report.manifest.json'), 'utf8'))
    assert.equal(manifest.caseId, record.caseId)
    assert.equal(manifest.files.length, 4)
    assert.equal(manifest.sources.length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('temporal tools expose eight tools and a valid creation schema', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-temporal-tools-'))
  try {
    const tools = createTemporalTools({ chronoRoot: root, chronoTimeoutMs: 1000, chronoMaxBytes: 1024, userAgent: 'test' }, '0.2.0')
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['chrono_analyze', 'chrono_assert', 'chrono_case', 'chrono_claim', 'chrono_ingest', 'chrono_report', 'chrono_review', 'chrono_search'])
    const created = await tools.find((tool) => tool.name === 'chrono_case').execute({ action: 'create', title: 'Case', question: 'Question' })
    assert.match(created.caseId, /^case-/)
    const search = await tools.find((tool) => tool.name === 'chrono_search').execute({ case_id: created.caseId, queries: ['example'] })
    assert.deepEqual(search.results, [])
    assert.match(search.warnings[0], /unavailable/i)
    if (process.env.DSH_TOOLS_PATH) {
      const mod = await import(process.env.DSH_TOOLS_PATH)
      assert.deepEqual(mod.validateJsonSchemaValue(tools.find((tool) => tool.name === 'chrono_case').output.schema, created, ''), [])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('temporal tools record, analyze, and report a date conflict', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-temporal-e2e-'))
  try {
    const config = { chronoRoot: root, chronoTimeoutMs: 1000, chronoMaxBytes: 1024, userAgent: 'test' }
    const tools = createTemporalTools(config, '0.2.0')
    const created = await tools.find((tool) => tool.name === 'chrono_case').execute({ action: 'create', title: 'Closure', question: 'When?' })
    const base = {
      requestedUrl: 'https://a.example/x', finalUrl: 'https://a.example/x', httpStatus: 200,
      contentType: 'text/html', charset: 'utf-8', fetchedAt: '2024-03-22T00:00:00.000Z', byteLength: 10,
      sha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), text: 'The factory closed on 2024-03-15.',
      headers: {}, redirects: [], access: 'open', domain: 'a.example',
    }
    const source = await addSource(root, created.caseId, base, { title: 'A', sourceClass: 'media', timeCandidates: [] })
    const asserted = await tools.find((tool) => tool.name === 'chrono_assert').execute({
      case_id: created.caseId,
      source_id: source.sourceId,
      event_label: 'Factory closed',
      event_category: 'corporate',
      dates: [{ raw_text: '2024-03-15', role: 'event' }],
    })
    assert.equal(asserted.dates.length, 1)
    assert.equal(asserted.dates[0].parsed.precision, 'day')
    const analysis = await tools.find((tool) => tool.name === 'chrono_analyze').execute({ case_id: created.caseId, action: 'check' })
    assert.equal(analysis.timeline.length, 1)
    assert.equal(analysis.timeline[0].label, 'Factory closed')
    const report = await tools.find((tool) => tool.name === 'chrono_report').execute({ case_id: created.caseId, audience: 'editor' })
    assert.equal(report.files.length, 5)
    if (process.env.DSH_TOOLS_PATH) {
      const mod = await import(process.env.DSH_TOOLS_PATH)
      assert.deepEqual(mod.validateJsonSchemaValue(tools.find((tool) => tool.name === 'chrono_assert').output.schema, asserted, ''), [])
      assert.deepEqual(mod.validateJsonSchemaValue(tools.find((tool) => tool.name === 'chrono_analyze').output.schema, analysis, ''), [])
      assert.deepEqual(mod.validateJsonSchemaValue(tools.find((tool) => tool.name === 'chrono_report').output.schema, report, ''), [])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('source tool fallback and /chrono command work without external services', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-source-tools-'))
  try {
    const config = { chronoRoot: root, chronoTimeoutMs: 1000, chronoMaxBytes: 1024, chronoMaxSources: 50, userAgent: 'test' }
    const created = await createCase(root, { title: 'Command case', question: 'Question?' })
    const tools = createSourceTools(config, { get: () => undefined })
    const collect = await tools.find((tool) => tool.name === 'chrono_collect').execute({ case_id: created.caseId, urls: ['http://127.0.0.1:1/private'] }, { signal: new AbortController().signal })
    assert.equal(collect.mode, 'foreground')
    assert.ok(collect.warnings.length)
    assert.deepEqual(collect.sources, [])
    const sourceAnalysis = await analyzeCase(root, created.caseId)
    assert.ok(sourceAnalysis.coverage.queries.length >= 1)
    if (process.env.DSH_TOOLS_PATH) {
      const mod = await import(process.env.DSH_TOOLS_PATH)
      assert.deepEqual(mod.validateJsonSchemaValue(tools.find((tool) => tool.name === 'chrono_collect').output.schema, collect, ''), [])
    }
    await assert.rejects(tools.find((tool) => tool.name === 'chrono_watch').execute({ action: 'create', case_id: created.caseId, rrule: 'RRULE:FREQ=DAILY' }, { agent: { session: { id: 'session' } } }), /schedule service unavailable/)

    let handler
    registerCommand({
      inject(_deps, callback) { callback({ commands: { register(definition) { handler = definition.handler; return () => {} } } }) },
      logger: { warn() {} },
    }, config)
    const listed = await handler({ rawInput: 'list' })
    assert.equal(listed.kind, 'success')
    assert.match(listed.text, /Command case/)
    const status = await handler({ rawInput: `status ${created.caseId}` })
    assert.equal(status.kind, 'success')
    assert.match(status.text, /Command case/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('chrono_watch creates and deletes a schedule-backed watch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-watch-'))
  try {
    const calls = []
    const schedule = {
      async create(request, sessionId) { calls.push({ kind: 'create', request, sessionId }); return { id: 'schedule-test' } },
      async edit(request, sessionId) { calls.push({ kind: 'edit', request, sessionId }); return { deleted: true } },
    }
    const config = { chronoRoot: root, chronoTimeoutMs: 1000, chronoMaxBytes: 1024, chronoMaxSources: 50, userAgent: 'test' }
    const created = await createCase(root, { title: 'Watch case', question: 'What changed?' })
    const tools = createSourceTools(config, { get: (name) => name === 'schedule' ? schedule : undefined })
    const watch = await tools.find((tool) => tool.name === 'chrono_watch').execute({
      action: 'create', case_id: created.caseId, rrule: 'DTSTART;TZID=Asia/Shanghai:20261116T090000\nRRULE:FREQ=WEEKLY', urls: ['https://example.com/a'], title: 'Weekly watch',
    }, { agent: { session: { id: 'session-test' } } })
    assert.equal(watch.mode, 'watch-create')
    assert.equal(watch.watches.length, 1)
    assert.equal(watch.watches[0].scheduleId, 'schedule-test')
    assert.equal(calls[0].sessionId, 'session-test')
    const deleted = await tools.find((tool) => tool.name === 'chrono_watch').execute({ action: 'delete', case_id: created.caseId, watch_id: watch.watches[0].watchId }, { agent: { session: { id: 'session-test' } } })
    assert.equal(deleted.mode, 'watch-delete')
    assert.equal(deleted.watches.length, 0)
    assert.equal(calls[1].request.action, 'delete')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('chrono_diff reports source and date changes against a baseline report', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-diff-'))
  try {
    const config = { chronoRoot: root, chronoTimeoutMs: 1000, chronoMaxBytes: 1024, chronoMaxSources: 50, userAgent: 'test' }
    const record = await createCase(root, { title: 'Diff case', question: 'What changed?' })
    const base = {
      requestedUrl: 'https://a.example/a', finalUrl: 'https://a.example/a', httpStatus: 200,
      contentType: 'text/html', charset: 'utf-8', fetchedAt: '2024-03-02T00:00:00.000Z', byteLength: 10,
      sha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), text: 'The event was on 2024-03-01.',
      headers: {}, redirects: [], access: 'open', domain: 'a.example',
    }
    const source = await addSource(root, record.caseId, base, { title: 'A', sourceClass: 'media', timeCandidates: [] })
    const event = await addEvent(root, record.caseId, { label: 'Event', category: 'other', sourceIds: [source.sourceId] })
    await addDateAssertion(root, record.caseId, { eventId: event.eventId, sourceId: source.sourceId, rawText: '2024-03-01', role: 'event', parsed: parseDate('2024-03-01'), span: null, quoteSha256: 'c'.repeat(64), teg: 'T4' })
    const report = await generateReport(root, record.caseId, { audience: 'internal' })
    const tools = createSourceTools(config, { get: () => undefined })
    const noChange = await tools.find((tool) => tool.name === 'chrono_diff').execute({ case_id: record.caseId, baseline_report_id: report.reportId })
    assert.equal(noChange.sourcesAdded.length, 0)
    assert.equal(noChange.datesAdded.length, 0)
    await addDateAssertion(root, record.caseId, { eventId: event.eventId, sourceId: source.sourceId, rawText: '2024-03-02', role: 'event', parsed: parseDate('2024-03-02'), span: null, quoteSha256: 'd'.repeat(64), teg: 'T4' })
    const changed = await tools.find((tool) => tool.name === 'chrono_diff').execute({ case_id: record.caseId, baseline_report_id: report.reportId })
    assert.equal(changed.datesAdded.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('report language lint rejects verdict/identity language in case labels', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-lint-'))
  try {
    const record = await createCase(root, { title: 'Lint', question: 'Question?' })
    const source = await addSource(root, record.caseId, {
      requestedUrl: 'https://a.example/x', finalUrl: 'https://a.example/x', httpStatus: 200,
      contentType: 'text/html', charset: 'utf-8', fetchedAt: '2024-03-02T00:00:00.000Z', byteLength: 10,
      sha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), text: 'x', headers: {}, redirects: [], access: 'open', domain: 'a.example',
    }, { title: 'confirmed identity', sourceClass: 'media', timeCandidates: [] })
    await addEvent(root, record.caseId, { label: 'The same person', category: 'other', sourceIds: [source.sourceId] })
    await assert.rejects(generateReport(root, record.caseId, { audience: 'editor' }), /language lint failed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('robots gate honours a simple Disallow and fails open on an unavailable file', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('User-agent: *\nDisallow: /private\nAllow: /private/open\n')
      return
    }
    res.writeHead(200).end('ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    clearRobotsCache()
    assert.equal((await robotsAllowed(`${base}/private/page`, { timeoutMs: 1000 })).allowed, false)
    assert.equal((await robotsAllowed(`${base}/public/page`, { timeoutMs: 1000 })).allowed, true)
    clearRobotsCache()
    const unavailable = await robotsAllowed('http://127.0.0.1:1/robots-unreachable', { timeoutMs: 200 })
    assert.equal(unavailable.allowed, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})


test('claim and review tools keep human decisions append-only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-review-'))
  try {
    const config = { chronoRoot: root, chronoTimeoutMs: 1000, chronoMaxBytes: 1024, chronoMaxSources: 50, userAgent: 'test' }
    const created = await createCase(root, { title: 'Review case', question: 'When?' })
    const source = await addSource(root, created.caseId, {
      requestedUrl: 'https://a.example/x', finalUrl: 'https://a.example/x', httpStatus: 200,
      contentType: 'text/html', charset: 'utf-8', fetchedAt: '2024-03-22T00:00:00.000Z', byteLength: 10,
      sha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), text: 'The event was on 2024-03-15.', headers: {}, redirects: [], access: 'open', domain: 'a.example',
    }, { title: 'A', sourceClass: 'media', timeCandidates: [] })
    const event = await addEvent(root, created.caseId, { label: 'Event', category: 'other', sourceIds: [source.sourceId] })
    await addDateAssertion(root, created.caseId, { eventId: event.eventId, sourceId: source.sourceId, rawText: '2024-03-15', role: 'event', parsed: parseDate('2024-03-15'), span: null, quoteSha256: 'c'.repeat(64), teg: 'T4' })
    const tools = createTemporalTools(config, '0.3.0')
    const claim = await tools.find((tool) => tool.name === 'chrono_claim').execute({ case_id: created.caseId, text: 'The event happened', status: 'proposed' })
    assert.equal(claim.claim.text, 'The event happened')
    const reviewed = await tools.find((tool) => tool.name === 'chrono_review').execute({ action: 'resolve', case_id: created.caseId, conflict_id: 'conf-test', resolution: 'explained', note: 'Same interval' })
    assert.equal(reviewed.review.conflictId, 'conf-test')
    const list = await tools.find((tool) => tool.name === 'chrono_review').execute({ action: 'list', case_id: created.caseId })
    assert.equal(list.reviews.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
