/**
 * Model-facing temporal evidence tools. URL-first, local files only: no website, server, or
 * crawler network. The legacy sherlock_check/sherlock_sites tools remain available separately.
 * @module dsh-sherlock/dsh/temporal-tools
 */
import { analyzeCase } from '../temporal/analyze.js'
import { classifySource, extractPage } from '../temporal/extract.js'
import { fetchPage } from '../temporal/fetch.js'
import { parseDate } from '../temporal/time.js'
import { generateReport } from '../temporal/report.js'
import { addDateAssertion, addEvent, addSource, createCase, listCases, listEvents, listSources, loadCase, readSourceText, sha256 } from '../temporal/store.js'

const CASE_OUTPUT = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'number' },
    caseId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    title: { type: 'string' },
    subject: { type: 'object', additionalProperties: true },
    scope: { type: 'object', additionalProperties: true },
    distribution: { type: 'string' },
    policy: { type: 'object', additionalProperties: true },
    question: { type: 'string' },
    purpose: { type: 'string' },
    status: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    cases: { type: 'array', items: { type: 'object', additionalProperties: true } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'question', 'purpose', 'status', 'createdAt', 'updatedAt', 'cases', 'warnings'],
  additionalProperties: false,
}

const SOURCE_SUMMARY = {
  type: 'object',
  properties: {
    sourceId: { type: 'string' },
    snapshotId: { type: 'string' },
    url: { type: 'string' },
    title: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    httpStatus: { type: 'number' },
    access: { type: 'string' },
    contentType: { type: 'string' },
    fetchedAt: { type: 'string' },
    sha256: { type: 'string' },
    timeCandidates: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
  required: ['sourceId', 'snapshotId', 'url', 'title', 'httpStatus', 'access', 'contentType', 'fetchedAt', 'sha256', 'timeCandidates'],
  additionalProperties: false,
}

const INGEST_OUTPUT = {
  type: 'object',
  properties: {
    caseId: { type: 'string' },
    sources: { type: 'array', items: SOURCE_SUMMARY },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['caseId', 'sources', 'warnings'],
  additionalProperties: false,
}

const DATE = {
  type: 'object',
  properties: {
    assertionId: { type: 'string' },
    eventId: { type: 'string' },
    sourceId: { type: 'string' },
    rawText: { type: 'string' },
    role: { type: 'string' },
    parsed: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    quoteSha256: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    span: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
  },
  required: ['assertionId', 'eventId', 'sourceId', 'rawText', 'role', 'parsed', 'quoteSha256', 'span'],
  additionalProperties: false,
}

const ASSERT_OUTPUT = {
  type: 'object',
  properties: {
    caseId: { type: 'string' },
    event: { type: 'object', additionalProperties: true },
    dates: { type: 'array', items: DATE },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['caseId', 'event', 'dates', 'warnings'],
  additionalProperties: false,
}

const TIMELINE_ENTRY = {
  type: 'object',
  properties: {
    eventId: { type: 'string' },
    label: { type: 'string' },
    category: { type: 'string' },
    time: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    status: { type: 'string' },
    evidence: { type: 'object', additionalProperties: true },
    citationIds: { type: 'array', items: { type: 'string' } },
    conflictIds: { type: 'array', items: { type: 'string' } },
    gapIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['eventId', 'label', 'category', 'time', 'status', 'evidence', 'citationIds', 'conflictIds', 'gapIds'],
  additionalProperties: false,
}

const ANALYZE_OUTPUT = {
  type: 'object',
  properties: {
    caseId: { type: 'string' },
    timeline: { type: 'array', items: TIMELINE_ENTRY },
    conflicts: { type: 'array', items: { type: 'object', additionalProperties: true } },
    gaps: { type: 'array', items: { type: 'object', additionalProperties: true } },
    coverage: { type: 'object', additionalProperties: true },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['caseId', 'timeline', 'conflicts', 'gaps', 'coverage', 'warnings'],
  additionalProperties: false,
}

const REPORT_OUTPUT = {
  type: 'object',
  properties: {
    reportId: { type: 'string' },
    caseId: { type: 'string' },
    dir: { type: 'string' },
    files: { type: 'array', items: { type: 'object', additionalProperties: true } },
    summary: { type: 'object', additionalProperties: true },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['reportId', 'caseId', 'dir', 'files', 'summary', 'warnings'],
  additionalProperties: false,
}

const SEARCH_OUTPUT = {
  type: 'object',
  properties: {
    caseId: { type: 'string' },
    results: { type: 'array', items: { type: 'object', additionalProperties: true } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['caseId', 'results', 'warnings'],
  additionalProperties: false,
}

/**
 * @param {import('../core/config.js').SherlockConfig} config
 * @param {string} _version
 * @param {any} [ctx]
 */
export function createTemporalTools(config, _version, ctx = null) {
  return [
    {
      name: 'chrono_case',
      description: 'Create, open, or list a local temporal evidence case. This creates no website, server, or account; cases are local files. Use it before chrono_ingest/chrono_assert/chrono_analyze/chrono_report.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'open', 'list'] },
          case_id: { type: 'string', description: 'Required for open.' },
          title: { type: 'string', description: 'Short case title for create.' },
          question: { type: 'string', description: 'The question or claim to investigate.' },
          purpose: { type: 'string', enum: ['publish', 'legal', 'policy', 'due_diligence', 'internal'] },
          subject_type: { type: 'string', enum: ['event', 'organization', 'policy', 'institution', 'public_role'] },
          subject_name: { type: 'string' },
          from: { type: 'string', description: 'Optional ISO date lower bound.' },
          to: { type: 'string', description: 'Optional ISO date upper bound.' },
          languages: { type: 'array', items: { type: 'string' } },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: { schema: CASE_OUTPUT, render: (args, value) => [{ type: 'text', text: renderCase(value) }] },
      timeoutMs: 15_000,
      async execute(args) {
        const action = stringArg(args.action, 'action', ['create', 'open', 'list'])
        if (action === 'list') {
          const cases = await listCases(config.chronoRoot)
          return { caseId: null, title: '', question: '', purpose: '', status: 'listed', createdAt: '', updatedAt: '', cases, warnings: [] }
        }
        if (action === 'open') {
          const caseId = requiredString(args.case_id, 'case_id')
          const record = await loadCase(config.chronoRoot, caseId)
          return { ...record, cases: [], warnings: [] }
        }
        if (args.subject_type === 'public_role') throw new Error('chrono_case: public_role cases require a public-interest basis; this MVP accepts event/organization/policy/institution only')
        const title = requiredString(args.title, 'title')
        const question = requiredString(args.question, 'question')
        const record = await createCase(config.chronoRoot, {
          title,
          question,
          purpose: optionalString(args.purpose) ?? 'publish',
          subjectType: optionalString(args.subject_type) ?? 'event',
          subjectName: optionalString(args.subject_name) ?? title,
          from: optionalString(args.from),
          to: optionalString(args.to),
          languages: Array.isArray(args.languages) ? args.languages.filter((item) => typeof item === 'string') : undefined,
        })
        return { ...record, cases: [], warnings: [] }
      },
    },
    {
      name: 'chrono_search',
      description: 'Search through DSH\'s configured web-search provider as a discovery aid, returning URLs/titles/snippets/dates. It does not create evidence; pass chosen URLs to chrono_ingest. If the provider is unavailable, the result says so instead of inventing results.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          queries: { type: 'array', items: { type: 'string' }, description: '1–5 search queries.' },
          max_results: { type: 'number', description: '1–10 results per query; default 5.' },
        },
        required: ['case_id', 'queries'],
        additionalProperties: false,
      },
      output: { schema: SEARCH_OUTPUT, render: (args, value) => [{ type: 'text', text: renderSearch(value) }] },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const caseId = requiredString(args.case_id, 'case_id')
        await loadCase(config.chronoRoot, caseId)
        if (!Array.isArray(args.queries) || args.queries.length === 0) throw new Error('chrono_search: queries must be non-empty')
        if (args.queries.length > 5) throw new Error('chrono_search: at most 5 queries')
        const maxResults = Number.isInteger(args.max_results) ? Math.min(10, Math.max(1, args.max_results)) : 5
        const web = typeof ctx?.get === 'function' ? ctx.get('web') : null
        if (!web || typeof web.search !== 'function') return { caseId, results: [], warnings: ['web search service unavailable in this profile; use DSH web_search or pass URLs to chrono_ingest'] }
        const results = []
        const warnings = []
        for (const query of args.queries) {
          if (typeof query !== 'string' || !query.trim()) { warnings.push('skipped empty query'); continue }
          try {
            const result = await web.search({ query, maxResults }, exec?.signal)
            for (const [index, source] of (result.sources ?? []).entries()) {
              results.push({ query, rank: index + 1, url: source.url, title: source.title ?? null, snippet: source.snippet ?? null, publishedAt: source.publishedAt ?? null })
            }
            if (result.truncated) warnings.push(`${query}: results truncated`)
          } catch (error) {
            warnings.push(`${query}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        return { caseId, results, warnings }
      },
    },
    {
      name: 'chrono_ingest',
      description: 'Fetch public URLs into a local evidence case and freeze text snapshots with SHA-256. URL-first; no site or crawler network. Does not return raw HTML. Call chrono_assert afterwards to record date assertions.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          urls: { type: 'array', items: { type: 'string' }, description: '1–10 public http(s) URLs.' },
        },
        required: ['case_id', 'urls'],
        additionalProperties: false,
      },
      output: { schema: INGEST_OUTPUT, render: (args, value) => [{ type: 'text', text: renderSources(value) }] },
      timeoutMs: 120_000,
      async execute(args, exec) {
        const caseId = requiredString(args.case_id, 'case_id')
        await loadCase(config.chronoRoot, caseId)
        if (!Array.isArray(args.urls) || args.urls.length === 0) throw new Error('chrono_ingest: urls must be a non-empty array')
        if (args.urls.length > 10) throw new Error('chrono_ingest: at most 10 URLs per call')
        const existing = await listSources(config.chronoRoot, caseId)
        if (existing.length + args.urls.length > config.chronoMaxSources) throw new Error(`chrono_ingest: case source limit is ${config.chronoMaxSources}`)
        const sources = []
        const warnings = []
        for (const rawUrl of args.urls) {
          if (typeof rawUrl !== 'string') { warnings.push('skipped a non-string URL'); continue }
          try {
            const fetched = await fetchPage(rawUrl, { timeoutMs: config.chronoTimeoutMs, maxBytes: config.chronoMaxBytes, userAgent: config.userAgent, signal: exec?.signal })
            const extracted = extractPage(fetched)
            extracted.sourceClass = classifySource(fetched.domain)
            const source = await addSource(config.chronoRoot, caseId, fetched, extracted)
            sources.push({
              sourceId: source.sourceId,
              snapshotId: source.snapshotId,
              url: source.finalUrl,
              title: source.title,
              httpStatus: source.httpStatus,
              access: source.access,
              contentType: source.contentType,
              fetchedAt: source.fetchedAt,
              sha256: source.sha256,
              timeCandidates: source.timeCandidates,
            })
            if (source.access !== 'open') warnings.push(`${source.finalUrl}: ${source.access} (${source.httpStatus})`)
          } catch (error) {
            warnings.push(`${rawUrl}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        return { caseId, sources, warnings }
      },
    },
    {
      name: 'chrono_assert',
      description: 'Record an event and its date assertions from a stored snapshot. Raw date text is retained; the tool normalizes it to an interval with precision/timezone. The model must not do date arithmetic. Use one call per event.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          source_id: { type: 'string' },
          event_id: { type: 'string', description: 'Optional existing event to append to.' },
          event_label: { type: 'string' },
          event_category: { type: 'string', enum: ['corporate', 'regulatory', 'legal', 'policy', 'market', 'crisis', 'election', 'appointment', 'other'] },
          dates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                raw_text: { type: 'string' },
                role: { type: 'string', enum: ['event', 'announcement', 'effective', 'publication', 'update', 'correction', 'retraction', 'access', 'deadline', 'period'] },
              },
              required: ['raw_text', 'role'],
              additionalProperties: false,
            },
          },
        },
        required: ['case_id', 'source_id', 'event_label', 'dates'],
        additionalProperties: false,
      },
      output: { schema: ASSERT_OUTPUT, render: (args, value) => [{ type: 'text', text: renderAssert(value) }] },
      timeoutMs: 30_000,
      async execute(args) {
        const caseId = requiredString(args.case_id, 'case_id')
        const sourceId = requiredString(args.source_id, 'source_id')
        const label = requiredString(args.event_label, 'event_label')
        await loadCase(config.chronoRoot, caseId)
        const sources = await listSources(config.chronoRoot, caseId)
        const source = sources.find((row) => row.sourceId === sourceId)
        if (!source) throw new Error(`chrono_assert: unknown source ${sourceId}`)
        const { text } = await readSourceText(config.chronoRoot, caseId, sourceId)
        const event = args.event_id
          ? (await listEvents(config.chronoRoot, caseId)).find((row) => row.eventId === args.event_id)
          : await addEvent(config.chronoRoot, caseId, { label, category: optionalString(args.event_category) ?? 'other', sourceIds: [sourceId] })
        if (!event) throw new Error(`chrono_assert: unknown event ${args.event_id}`)
        if (!Array.isArray(args.dates) || args.dates.length === 0) throw new Error('chrono_assert: dates must be a non-empty array')
        if (args.dates.length > 20) throw new Error('chrono_assert: at most 20 date assertions per call')
        const anchor = source.timeCandidates?.find((candidate) => candidate.field === 'published' && candidate.parsed)?.parsed?.earliest ?? source.fetchedAt
        const dates = []
        const warnings = []
        for (const item of args.dates) {
          if (!item || typeof item !== 'object') { warnings.push('skipped a non-object date'); continue }
          const rawText = requiredString(item.raw_text, 'dates[].raw_text')
          const role = requiredString(item.role, 'dates[].role')
          const parsed = parseDate(rawText, { anchor })
          const index = text.indexOf(rawText)
          const span = index >= 0 ? { start: index, end: index + rawText.length } : null
          if (!parsed) warnings.push(`unparsed date: ${rawText}`)
          if (!span) warnings.push(`quote not found in snapshot: ${rawText}`)
          /** @type {any} */
          const assertion = await addDateAssertion(config.chronoRoot, caseId, {
            eventId: event.eventId,
            sourceId,
            rawText,
            role,
            parsed,
            anchor,
            span,
            quoteSha256: span ? sha256(rawText) : null,
          })
          dates.push({ assertionId: assertion.assertionId, eventId: event.eventId, sourceId, rawText, role, parsed: assertion.parsed, quoteSha256: assertion.quoteSha256, span: assertion.span })
        }
        return { caseId, event, dates, warnings }
      },
    },
    {
      name: 'chrono_analyze',
      description: 'Run deterministic date-conflict, evidence, timeline, gap, and coverage analysis on a case. It does not issue a true/false verdict. Use action="check" first, then action="timeline".',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          action: { type: 'string', enum: ['check', 'timeline'] },
        },
        required: ['case_id'],
        additionalProperties: false,
      },
      output: { schema: ANALYZE_OUTPUT, render: (args, value) => [{ type: 'text', text: renderAnalysis(value) }] },
      timeoutMs: 30_000,
      async execute(args) {
        const caseId = requiredString(args.case_id, 'case_id')
        await loadCase(config.chronoRoot, caseId)
        const analysis = await analyzeCase(config.chronoRoot, caseId)
        const warnings = []
        if (analysis.coverage.sourceCount === 0) warnings.push('no sources have been ingested')
        if (analysis.timeline.length === 0) warnings.push('no events/dates have been asserted')
        return { caseId, timeline: analysis.timeline, conflicts: analysis.conflicts, gaps: analysis.gaps, coverage: analysis.coverage, warnings }
      },
    },
    {
      name: 'chrono_report',
      description: 'Generate the four-file temporal evidence report (report.md, timeline.csv, sources.csv, report.manifest.json) from an existing case. It adds no facts and is not a true/false verdict or legal opinion. The model should present the files.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          audience: { type: 'string', enum: ['editor', 'legal', 'policy', 'internal'] },
        },
        required: ['case_id'],
        additionalProperties: false,
      },
      output: { schema: REPORT_OUTPUT, render: (args, value) => [{ type: 'text', text: renderReport(value) }] },
      timeoutMs: 60_000,
      async execute(args) {
        const caseId = requiredString(args.case_id, 'case_id')
        const report = await generateReport(config.chronoRoot, caseId, { audience: /** @type {'editor'|'legal'|'policy'|'internal'} */ (optionalString(args.audience) ?? 'editor') })
        return report
      },
    },
  ]
}

/** @param {unknown} value @param {string} name @param {string[]} allowed */
function stringArg(value, name, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join(', ')}`)
  return value
}

/** @param {unknown} value @param {string} name */
function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

/** @param {unknown} value */
function optionalString(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined }

/** @param {any} value */
function renderCase(value) {
  if (value.status === 'listed') return value.cases.length ? value.cases.map((row) => `- ${row.caseId}: ${row.title}`).join('\n') : 'No cases yet.'
  return `Case ${value.caseId}: ${value.title}\nQuestion: ${value.question}\nStatus: ${value.status}`
}

/** @param {any} value */
function renderSources(value) {
  if (!value.sources.length) return `No sources ingested.${value.warnings.length ? `\nWarnings:\n- ${value.warnings.join('\n- ')}` : ''}`
  const lines = [`Ingested ${value.sources.length} source(s) for ${value.caseId}.`]
  for (const source of value.sources) lines.push(`- ${source.sourceId} ${source.httpStatus} ${source.access} ${source.url} (${source.sha256.slice(0, 12)}…)`)
  if (value.warnings.length) lines.push(`Warnings: ${value.warnings.join('; ')}`)
  return lines.join('\n')
}

/** @param {any} value */
function renderSearch(value) {
  if (!value.results.length) return `No search results.${value.warnings.length ? `\nWarnings:\n- ${value.warnings.join('\n- ')}` : ''}`
  return [`Search results for ${value.caseId}:`, ...value.results.map((row) => `- ${row.rank}. ${row.title ?? row.url} — ${row.url}${row.publishedAt ? ` (${row.publishedAt})` : ''}`), ...(value.warnings.length ? [`Warnings: ${value.warnings.join('; ')}`] : [])].join('\n')
}

/** @param {any} value */
function renderAssert(value) {
  const lines = [`Event ${value.event.eventId}: ${value.event.label}`]
  for (const date of value.dates) lines.push(`- ${date.role}: ${date.rawText}${date.parsed ? ` → ${date.parsed.earliest}..${date.parsed.latest} (${date.parsed.precision}${date.parsed.timeZone ? `, ${date.parsed.timeZone}` : ', tz unknown'})` : ' (unparsed)'}`)
  if (value.warnings.length) lines.push(`Warnings: ${value.warnings.join('; ')}`)
  return lines.join('\n')
}

/** @param {any} value */
function renderAnalysis(value) {
  const lines = [`${value.timeline.length} timeline entries; ${value.conflicts.length} conflicts; ${value.gaps.length} gaps.`]
  for (const entry of value.timeline) lines.push(`- ${entry.time?.earliest ?? 'unknown'} ${entry.label} [${entry.evidence.T}/${entry.evidence.S}/${entry.evidence.C}/${entry.evidence.E} ${entry.evidence.band}] ${entry.status}`)
  if (value.warnings.length) lines.push(`Warnings: ${value.warnings.join('; ')}`)
  return lines.join('\n')
}

/** @param {any} value */
function renderReport(value) {
  return `Report ${value.reportId} generated for ${value.caseId}.\n${value.files.map((file) => `- ${file.path} (${file.sha256.slice(0, 12)}…)`).join('\n')}\nPresent these files with the present tool, not raw HTML.`
}
