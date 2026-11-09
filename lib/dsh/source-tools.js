/**
 * Additional temporal source tools: RSS/Atom, GDELT, Wayback CDX, a background collector, and
 * durable watches. All are local-plugin tools; none hosts a site or crawls a network.
 * @module dsh-sherlock/dsh/source-tools
 */
import { ingestFeed, ingestGdelt, ingestUrls, queryArchive } from '../temporal/sources.js'
import { listWatches, loadCase, nextId, saveWatches, sha256 } from '../temporal/store.js'

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
        const prompt = `ChronoWeft watch for ${caseId}. Collect these URLs with chrono_collect: ${urls.join(', ') || '(none; use current sources)'}. Then run chrono_analyze and chrono_report. Report only changes since the previous report: new/removed/changed sources, date conflicts, and gaps. Do not issue a true/false verdict.`
        const task = await schedule.create({ title, prompt, timing: { kind: 'rrule', rrule }, target: { kind: 'session', sessionId } }, sessionId, exec?.signal)
        const watch = { watchId: nextId('watch'), scheduleId: task.id, title, rrule, urls, createdAt: new Date().toISOString(), baseline: sha256(`${caseId}:${Date.now()}`).slice(0, 12) }
        await saveWatches(config.chronoRoot, caseId, [...watches, watch])
        return { caseId, mode: 'watch-create', jobId: null, sources: [], watches: [...watches, watch], warnings: [] }
      },
    },
  ]
}

/** @param {any} config */
function sourceConfig(config) {
  return { maxSources: config.chronoMaxSources, maxBytes: config.chronoMaxBytes, timeoutMs: config.chronoTimeoutMs, userAgent: config.userAgent }
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
function renderWatch(value) {
  return `${value.mode}: ${value.watches?.length ?? 0} watch task(s) for ${value.caseId}${value.warnings?.length ? `\nWarnings: ${value.warnings.join('; ')}` : ''}`
}
