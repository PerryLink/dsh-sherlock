/**
 * Additional temporal source tools: RSS/Atom, GDELT, Wayback CDX, a background collector, and
 * durable watches. All are local-plugin tools; none hosts a site or crawls a network.
 * @module dsh-sherlock/dsh/source-tools
 */
import { ingestFeed, ingestGdelt, ingestUrls, queryArchive } from '../temporal/sources.js'
import { extractPage } from '../temporal/extract.js'
import { fetchPage } from '../temporal/fetch.js'
import { addArchive, addVerification, listDateAssertions, listReports, listSources, listWatches, loadCase, nextId, readReportManifest, saveWatches, sha256 } from '../temporal/store.js'
import { analyzeCase } from '../temporal/analyze.js'

const SOURCE_TOOL_OUTPUT = {
  type: 'object',
  properties: {
    caseId: { type: 'string' },
    mode: { type: 'string' },
    jobId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    feedUrl: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    query: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    url: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    entries: { type: 'array', items: { type: 'object', additionalProperties: true } },
    articles: { type: 'array', items: { type: 'object', additionalProperties: true } },
    captures: { type: 'array', items: { type: 'object', additionalProperties: true } },
    sources: { type: 'array', items: { type: 'object', additionalProperties: true } },
    watches: { type: 'array', items: { type: 'object', additionalProperties: true } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['caseId', 'mode', 'jobId', 'sources', 'warnings'],
  additionalProperties: false,
}

const VERIFY_OUTPUT = {
  type: 'object',
  properties: {
    caseId: { type: 'string' },
    sourceId: { type: 'string' },
    changed: { type: 'boolean' },
    previous: { type: 'object', additionalProperties: true },
    current: { type: 'object', additionalProperties: true },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['caseId', 'sourceId', 'changed', 'previous', 'current', 'warnings'],
  additionalProperties: false,
}

const DIFF_OUTPUT = {
  type: 'object',
  properties: {
    caseId: { type: 'string' },
    baselineReportId: { type: 'string' },
    sourcesAdded: { type: 'array', items: { type: 'object', additionalProperties: true } },
    sourcesRemoved: { type: 'array', items: { type: 'object', additionalProperties: true } },
    sourcesChanged: { type: 'array', items: { type: 'object', additionalProperties: true } },
    datesAdded: { type: 'array', items: { type: 'object', additionalProperties: true } },
    datesRemoved: { type: 'array', items: { type: 'object', additionalProperties: true } },
    datesChanged: { type: 'array', items: { type: 'object', additionalProperties: true } },
    conflicts: { type: 'array', items: { type: 'object', additionalProperties: true } },
    gaps: { type: 'array', items: { type: 'object', additionalProperties: true } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['caseId', 'baselineReportId', 'sourcesAdded', 'sourcesRemoved', 'sourcesChanged', 'datesAdded', 'datesRemoved', 'datesChanged', 'conflicts', 'gaps', 'warnings'],
  additionalProperties: false,
}

/**
 * @param {import('../core/config.js').SherlockConfig} config
 * @param {any} ctx
 */
export function createSourceTools(config, ctx) {
  return [
    {
      name: 'chrono_feed',
      description: 'Read an RSS/Atom feed, list its entries and dates, and optionally fetch the entry pages into the local case. Returns URLs and metadata, never raw HTML.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          feed_url: { type: 'string' },
          max_entries: { type: 'number', description: '1–20; default 10.' },
          ingest: { type: 'boolean', description: 'Fetch entry pages as evidence snapshots. Default false.' },
        },
        required: ['case_id', 'feed_url'],
        additionalProperties: false,
      },
      output: { schema: SOURCE_TOOL_OUTPUT, render: (args, value) => [{ type: 'text', text: renderSource(value) }] },
      timeoutMs: 120_000,
      async execute(args, exec) {
        const caseId = required(args.case_id, 'case_id')
        await loadCase(config.chronoRoot, caseId)
        const maxEntries = integer(args.max_entries, 10, 1, 20)
        const result = await ingestFeed(config.chronoRoot, caseId, required(args.feed_url, 'feed_url'), {
          config: sourceConfig(config), signal: exec?.signal, maxEntries, ingest: args.ingest === true,
        })
        return { caseId, mode: args.ingest ? 'feed+ingest' : 'feed', jobId: null, feedUrl: result.feedUrl, entries: result.entries, sources: summarizeSources(result.sources), warnings: result.warnings }
      },
    },
    {
      name: 'chrono_gdelt',
      description: 'Query GDELT DOC 2.0 for a news window, list article URLs/titles/dates, and optionally fetch them into the local case. GDELT is a discovery source, not evidence by itself.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          query: { type: 'string' },
          timespan: { type: 'string', description: 'GDELT timespan, e.g. 3m or 1y; default 3m.' },
          max_records: { type: 'number', description: '1–75; default 25.' },
          ingest: { type: 'boolean', description: 'Fetch article URLs as evidence snapshots. Default false.' },
        },
        required: ['case_id', 'query'],
        additionalProperties: false,
      },
      output: { schema: SOURCE_TOOL_OUTPUT, render: (args, value) => [{ type: 'text', text: renderSource(value) }] },
      timeoutMs: 120_000,
      async execute(args, exec) {
        const caseId = required(args.case_id, 'case_id')
        await loadCase(config.chronoRoot, caseId)
        const maxRecords = integer(args.max_records, 25, 1, 75)
        const result = await ingestGdelt(config.chronoRoot, caseId, {
          config: sourceConfig(config), signal: exec?.signal, query: required(args.query, 'query'),
          timespan: optional(args.timespan) ?? '3m', maxRecords, ingest: args.ingest === true,
        })
        return { caseId, mode: args.ingest ? 'gdelt+ingest' : 'gdelt', jobId: null, query: result.query, articles: result.articles, sources: summarizeSources(result.sources), warnings: result.warnings }
      },
    },
    {
      name: 'chrono_archive',
      description: 'Query the Wayback CDX API for capture timestamps of one public URL. This is optional: archive.org is unreachable on some networks, and a failure is reported as a warning, not as absence.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          url: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          limit: { type: 'number', description: '1–50; default 20.' },
        },
        required: ['case_id', 'url'],
        additionalProperties: false,
      },
      output: { schema: SOURCE_TOOL_OUTPUT, render: (args, value) => [{ type: 'text', text: renderSource(value) }] },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const caseId = required(args.case_id, 'case_id')
        const result = await queryArchive(config.chronoRoot, caseId, {
          config: sourceConfig(config), signal: exec?.signal, url: required(args.url, 'url'),
          from: optional(args.from), to: optional(args.to), limit: integer(args.limit, 20, 1, 50),
        })
        await addArchive(config.chronoRoot, caseId, { url: result.url, captures: result.captures, warnings: result.warnings })
        return { caseId, mode: 'archive', jobId: null, url: result.url, captures: result.captures, sources: [], warnings: result.warnings }
      },
    },
    {
      name: 'chrono_collect',
      description: 'Collect up to 50 public URLs into a local case. Runs as a DSH background job when ctx.jobs and tool-jobs are composed; otherwise falls back to a foreground run. Does not host or crawl a network.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          urls: { type: 'array', items: { type: 'string' }, description: 'Up to 50 public URLs.' },
          background: { type: 'boolean', description: 'Prefer a background job. Default true.' },
        },
        required: ['case_id', 'urls'],
        additionalProperties: false,
      },
      output: { schema: SOURCE_TOOL_OUTPUT, render: (args, value) => [{ type: 'text', text: renderSource(value) }] },
      timeoutMs: 300_000,
      async execute(args, exec) {
        const caseId = required(args.case_id, 'case_id')
        await loadCase(config.chronoRoot, caseId)
        if (!Array.isArray(args.urls) || args.urls.length === 0) throw new Error('chrono_collect: urls must be non-empty')
        if (args.urls.length > 50) throw new Error('chrono_collect: at most 50 URLs')
        const urls = args.urls.filter((url) => typeof url === 'string' && url.trim() !== '')
        const jobs = typeof ctx?.get === 'function' ? ctx.get('jobs') : null
        const owner = exec?.agent?.session?.id ?? exec?.agent?.id
        if (args.background === false || !jobs || typeof jobs.start !== 'function' || !owner) {
          const result = await ingestUrls(config.chronoRoot, caseId, urls, sourceConfig(config), exec?.signal)
          return { caseId, mode: 'foreground', jobId: null, sources: summarizeSources(result.sources), warnings: result.warnings }
        }
        let controller = new AbortController()
        try {
          const jobId = jobs.start({
            kind: 'chrono-collect',
            label: `collect ${urls.length} URLs for ${caseId}`,
            owner,
            outputLimitBytes: 8192,
            run: (job) => {
              const done = ingestUrls(config.chronoRoot, caseId, urls, sourceConfig(config), controller.signal, (progress) => job.updateProgress(progress))
                .then((result) => {
                  job.append(`collected ${result.sources.length}/${urls.length}\n`)
                  return { status: controller.signal.aborted ? 'killed' : 'completed', result: JSON.stringify({ caseId, sources: result.sources.length, warnings: result.warnings }) }
                })
                .catch((error) => ({ status: 'failed', detail: error instanceof Error ? error.message : String(error) }))
              return { cancel: () => controller.abort('background job killed'), done }
            },
          })
          return { caseId, mode: 'background', jobId, sources: [], warnings: ['background collection started; use job_output to read progress'] }
        } catch (error) {
          const result = await ingestUrls(config.chronoRoot, caseId, urls, sourceConfig(config), exec?.signal)
          return { caseId, mode: 'foreground', jobId: null, sources: summarizeSources(result.sources), warnings: [`background unavailable: ${error instanceof Error ? error.message : String(error)}`, ...result.warnings] }
        }
      },
    },
    {
      name: 'chrono_verify',
      description: 'Re-fetch a stored source at its final URL, compare SHA-256/status/access/title, and append a local verification record. A changed page is evidence of change; an unreachable page is not evidence of absence.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          source_id: { type: 'string' },
        },
        required: ['case_id', 'source_id'],
        additionalProperties: false,
      },
      output: { schema: VERIFY_OUTPUT, render: (args, value) => [{ type: 'text', text: renderVerify(value) }] },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const caseId = required(args.case_id, 'case_id')
        const sourceId = required(args.source_id, 'source_id')
        const source = (await listSources(config.chronoRoot, caseId)).find((row) => row.sourceId === sourceId)
        if (!source) throw new Error(`chrono_verify: unknown source ${sourceId}`)
        const warnings = []
        try {
          const fetched = await fetchPage(source.finalUrl, { timeoutMs: config.chronoTimeoutMs, maxBytes: config.chronoMaxBytes, userAgent: config.userAgent, signal: exec?.signal })
          const extracted = extractPage(fetched)
          const changed = fetched.sha256 !== source.sha256 || fetched.httpStatus !== source.httpStatus || fetched.access !== source.access || (extracted.title ?? null) !== (source.title ?? null)
          await addVerification(config.chronoRoot, caseId, { sourceId, changed, previousSha256: source.sha256, currentSha256: fetched.sha256, previousStatus: source.httpStatus, currentStatus: fetched.httpStatus, previousAccess: source.access, currentAccess: fetched.access })
          return { caseId, sourceId, changed, previous: { sha256: source.sha256, httpStatus: source.httpStatus, access: source.access, title: source.title }, current: { sha256: fetched.sha256, httpStatus: fetched.httpStatus, access: fetched.access, title: extracted.title ?? null }, warnings }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await addVerification(config.chronoRoot, caseId, { sourceId, changed: false, error: message })
          warnings.push(`verification unavailable: ${message}`)
          return { caseId, sourceId, changed: false, previous: { sha256: source.sha256, httpStatus: source.httpStatus, access: source.access, title: source.title }, current: {}, warnings }
        }
      },
    },
    {
      name: 'chrono_diff',
      description: 'Compare the current local case state with a previous report manifest. Returns added/removed/changed sources and date assertions, plus current conflicts and gaps. This is a deterministic diff, not a truth verdict.',
      parameters: {
        type: 'object',
        properties: {
          case_id: { type: 'string' },
          baseline_report_id: { type: 'string', description: 'Report ID to compare against; defaults to the latest report.' },
        },
        required: ['case_id'],
        additionalProperties: false,
      },
      output: { schema: DIFF_OUTPUT, render: (args, value) => [{ type: 'text', text: renderDiff(value) }] },
      timeoutMs: 30_000,
      async execute(args) {
        const caseId = required(args.case_id, 'case_id')
        await loadCase(config.chronoRoot, caseId)
        const reports = await listReports(config.chronoRoot, caseId)
        if (!reports.length) throw new Error('chrono_diff: no previous report; generate one with chrono_report first')
        const baselineReportId = optional(args.baseline_report_id) ?? reports[0].reportId
        const baseline = await readReportManifest(config.chronoRoot, caseId, baselineReportId)
        const state = baseline.state ?? { sources: [], dates: [] }
        const [sources, dates, analysis] = await Promise.all([
          listSources(config.chronoRoot, caseId),
          listDateAssertions(config.chronoRoot, caseId),
          analyzeCase(config.chronoRoot, caseId),
        ])
        const oldSources = new Map((state.sources ?? []).map((source) => [source.sourceId, source]))
        const newSources = new Map(sources.map((source) => [source.sourceId, { sourceId: source.sourceId, url: source.finalUrl, sha256: source.sha256, access: source.access, fetchedAt: source.fetchedAt }]))
        const oldDates = new Map((state.dates ?? []).map((date) => [date.assertionId, date]))
        const newDates = new Map(dates.map((date) => [date.assertionId, { assertionId: date.assertionId, eventId: date.eventId, rawText: date.rawText, role: date.role, parsed: date.parsed, teg: date.teg ?? 'T4' }]))
        return {
          caseId,
          baselineReportId,
          sourcesAdded: [...newSources].filter(([id]) => !oldSources.has(id)).map(([, value]) => value),
          sourcesRemoved: [...oldSources].filter(([id]) => !newSources.has(id)).map(([, value]) => value),
          sourcesChanged: [...newSources].filter(([id, value]) => oldSources.has(id) && oldSources.get(id).sha256 !== value.sha256).map(([, value]) => value),
          datesAdded: [...newDates].filter(([id]) => !oldDates.has(id)).map(([, value]) => value),
          datesRemoved: [...oldDates].filter(([id]) => !newDates.has(id)).map(([, value]) => value),
          datesChanged: [...newDates].filter(([id, value]) => oldDates.has(id) && JSON.stringify(oldDates.get(id).parsed) !== JSON.stringify(value.parsed)).map(([, value]) => value),
          conflicts: analysis.conflicts,
          gaps: analysis.gaps,
          warnings: [],
        }
      },
    },
    {
      name: 'chrono_watch',
      description: 'Create/list/delete a durable watch for a local case. A watch creates a DSH schedule task that tells the agent to collect and report changes; it does not start a crawler or a hosted monitor. Requires ctx.schedule.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'delete'] },
          case_id: { type: 'string' },
          watch_id: { type: 'string' },
          title: { type: 'string' },
          rrule: { type: 'string', description: 'Full DSH rrule string with DTSTART and RRULE.' },
          urls: { type: 'array', items: { type: 'string' } },
          baseline_report_id: { type: 'string' },
        },
        required: ['action', 'case_id'],
        additionalProperties: false,
      },
      output: { schema: SOURCE_TOOL_OUTPUT, render: (args, value) => [{ type: 'text', text: renderWatch(value) }] },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const caseId = required(args.case_id, 'case_id')
        await loadCase(config.chronoRoot, caseId)
        const watches = await listWatches(config.chronoRoot, caseId)
        if (args.action === 'list') return { caseId, mode: 'watch-list', jobId: null, sources: [], watches, warnings: [] }
        if (args.action === 'delete') {
          const watchId = required(args.watch_id, 'watch_id')
          const watch = watches.find((row) => row.watchId === watchId)
          if (!watch) throw new Error(`chrono_watch: unknown watch ${watchId}`)
          const schedule = typeof ctx?.get === 'function' ? ctx.get('schedule') : null
          if (schedule?.edit && watch.scheduleId) {
            await schedule.edit({ id: watch.scheduleId, action: 'delete' }, exec?.agent?.session?.id, exec?.signal).catch(() => {})
          }
          await saveWatches(config.chronoRoot, caseId, watches.filter((row) => row.watchId !== watchId))
          return { caseId, mode: 'watch-delete', jobId: null, sources: [], watches: watches.filter((row) => row.watchId !== watchId), warnings: [] }
        }
        const schedule = typeof ctx?.get === 'function' ? ctx.get('schedule') : null
        if (!schedule?.create) throw new Error('chrono_watch: schedule service unavailable in this profile')
        const sessionId = exec?.agent?.session?.id ?? exec?.agent?.id
        if (!sessionId) throw new Error('chrono_watch: no active session for the schedule target')
        const rrule = required(args.rrule, 'rrule')
        const urls = Array.isArray(args.urls) ? args.urls.filter((url) => typeof url === 'string').slice(0, 50) : []
        const title = optional(args.title) ?? `Watch ${caseId}`
        const baselineReportId = optional(args.baseline_report_id)
        const prompt = `ChronoWeft watch for ${caseId}. Collect these URLs with chrono_collect: ${urls.join(', ') || '(none; use current sources)'}. Then run chrono_diff${baselineReportId ? ` with baseline ${baselineReportId}` : ''}, chrono_analyze, and chrono_report. Report only changes: new/removed/changed sources, date conflicts, and gaps. Do not issue a true/false verdict.`
        const task = await schedule.create({ title, prompt, timing: { kind: 'rrule', rrule }, target: { kind: 'session', sessionId } }, sessionId, exec?.signal)
        const watch = { watchId: nextId('watch'), scheduleId: task.id, title, rrule, urls, baselineReportId: baselineReportId ?? null, createdAt: new Date().toISOString(), baseline: sha256(`${caseId}:${Date.now()}`).slice(0, 12) }
        await saveWatches(config.chronoRoot, caseId, [...watches, watch])
        return { caseId, mode: 'watch-create', jobId: null, sources: [], watches: [...watches, watch], warnings: [] }
      },
    },
  ]
}

/** @param {any} config */
function sourceConfig(config) {
  return { maxSources: config.chronoMaxSources, maxBytes: config.chronoMaxBytes, timeoutMs: config.chronoTimeoutMs, perHostDelayMs: config.chronoPerHostDelayMs, honorRobots: config.chronoHonorRobots, userAgent: config.userAgent }
}

/** @param {any[]} sources */
function summarizeSources(sources) {
  return sources.map((source) => ({ sourceId: source.sourceId, snapshotId: source.snapshotId, url: source.finalUrl, title: source.title, sourceClass: source.sourceClass, fetchedAt: source.fetchedAt, sha256: source.sha256, access: source.access }))
}

/** @param {unknown} value @param {string} name */
function required(value, name) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`); return value.trim() }
/** @param {unknown} value */
function optional(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function integer(value, fallback, min, max) { const number = Number(value); return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback }

/** @param {any} value */
function renderSource(value) {
  const lines = [`chrono source tool: ${value.mode}${value.jobId ? ` (job ${value.jobId})` : ''}`]
  if (value.feedUrl) lines.push(`feed: ${value.feedUrl}`)
  if (value.query) lines.push(`query: ${value.query}`)
  if (value.url) lines.push(`url: ${value.url}`)
  if (value.entries?.length) lines.push(`entries: ${value.entries.length}`)
  if (value.articles?.length) lines.push(`articles: ${value.articles.length}`)
  if (value.captures?.length) lines.push(`captures: ${value.captures.length}`)
  if (value.sources?.length) lines.push(`sources: ${value.sources.length}`)
  if (value.warnings?.length) lines.push(`warnings: ${value.warnings.join('; ')}`)
  return lines.join('\n')
}

/** @param {any} value */
function renderVerify(value) {
  return `verify ${value.sourceId}: ${value.changed ? 'changed' : 'unchanged'}${value.warnings?.length ? `\nWarnings: ${value.warnings.join('; ')}` : ''}`
}

/** @param {any} value */
function renderDiff(value) {
  const lines = [`diff for ${value.caseId} vs ${value.baselineReportId}`]
  lines.push(`sources: +${value.sourcesAdded.length} -${value.sourcesRemoved.length} ~${value.sourcesChanged.length}`)
  lines.push(`dates: +${value.datesAdded.length} -${value.datesRemoved.length} ~${value.datesChanged.length}`)
  lines.push(`conflicts: ${value.conflicts.length}; gaps: ${value.gaps.length}`)
  return lines.join('\n')
}

/** @param {any} value */
function renderWatch(value) {
  return `${value.mode}: ${value.watches?.length ?? 0} watch task(s) for ${value.caseId}${value.warnings?.length ? `\nWarnings: ${value.warnings.join('; ')}` : ''}`
}
