/**
 * Public-source adapters for temporal cases: user URLs, RSS/Atom, GDELT DOC, and Wayback CDX.
 * All adapters are read-only; none creates or hosts a site. The case store is local.
 * @module dsh-sherlock/temporal/sources
 */
import { addQuery, addSource, listSources, loadCase } from './store.js'
import { classifySource, extractPage } from './extract.js'
import { fetchPage } from './fetch.js'
import { robotsAllowed } from './robots.js'

/**
 * @param {string} root
 * @param {string} caseId
 * @param {string[]} urls
 * @param {{maxSources:number,maxBytes:number,timeoutMs:number,perHostDelayMs?:number,honorRobots?:boolean,userAgent:string}} config
 * @param {AbortSignal|undefined} signal
 * @param {(progress:string)=>void} [progress]
 */
export async function ingestUrls(root, caseId, urls, config, signal, progress) {
  await loadCase(root, caseId)
  const existing = await listSources(root, caseId)
  if (existing.length + urls.length > config.maxSources) throw new Error(`case source limit is ${config.maxSources}`)
  const sources = []
  const warnings = []
  const lastByHost = new Map()
  for (const [index, rawUrl] of urls.entries()) {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') { warnings.push('skipped an empty URL'); continue }
    let host = ''
    try { host = new URL(rawUrl).host } catch { warnings.push(`${rawUrl}: invalid URL`); await addQuery(root, caseId, { channel: 'url', query: rawUrl, resultCount: 0, error: 'invalid URL' }); continue }
    const previous = lastByHost.get(host) ?? 0
    const waitMs = Math.max(0, (config.perHostDelayMs ?? 0) - (Date.now() - previous))
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    if (config.honorRobots !== false) {
      const gate = await robotsAllowed(rawUrl, { timeoutMs: config.timeoutMs, signal, userAgent: config.userAgent })
      if (!gate.allowed) {
        warnings.push(`${rawUrl}: robots_blocked (${gate.reason})`)
        await addQuery(root, caseId, { channel: 'url', query: rawUrl, resultCount: 0, error: `robots_blocked: ${gate.reason}` })
        lastByHost.set(host, Date.now())
        continue
      }
    }
    try {
      let fetched = await fetchPage(rawUrl, { timeoutMs: config.timeoutMs, maxBytes: config.maxBytes, userAgent: config.userAgent, signal })
      if (fetched.httpStatus === 429 || fetched.httpStatus >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 600))
        fetched = await fetchPage(rawUrl, { timeoutMs: config.timeoutMs, maxBytes: config.maxBytes, userAgent: config.userAgent, signal })
      }
      const extracted = extractPage(fetched)
      extracted.sourceClass = classifySource(fetched.domain)
      const source = await addSource(root, caseId, fetched, extracted)
      sources.push(source)
      await addQuery(root, caseId, { channel: 'url', query: rawUrl, resultCount: 1, httpStatus: source.httpStatus, access: source.access, sourceId: source.sourceId })
      if (source.access !== 'open') warnings.push(`${source.finalUrl}: ${source.access} (${source.httpStatus})`)
      progress?.(`${index + 1}/${urls.length} ${source.finalUrl}`)
      lastByHost.set(host, Date.now())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`${rawUrl}: ${message}`)
      await addQuery(root, caseId, { channel: 'url', query: rawUrl, resultCount: 0, error: message })
      lastByHost.set(host, Date.now())
    }
  }
  return { sources, warnings }
}

/**
 * Fetch an RSS/Atom feed, return entries, and optionally ingest the entry URLs.
 * @param {string} root @param {string} caseId @param {string} feedUrl @param {any} options
 */
export async function ingestFeed(root, caseId, feedUrl, options) {
  const config = options.config
  const fetched = await fetchPage(feedUrl, { timeoutMs: config.timeoutMs, maxBytes: config.maxBytes, userAgent: config.userAgent, signal: options.signal })
  const extracted = extractPage(fetched)
  const entries = (extracted.feedEntries ?? []).slice(0, options.maxEntries ?? 10)
  await addQuery(root, caseId, { channel: 'feed', query: feedUrl, resultCount: entries.length, httpStatus: fetched.httpStatus })
  if (!entries.length) return { feedUrl: fetched.finalUrl, entries: [], sources: [], warnings: ['no RSS/Atom entries found'] }
  if (!options.ingest) return { feedUrl: fetched.finalUrl, entries, sources: [], warnings: [] }
  const result = await ingestUrls(root, caseId, entries.map((entry) => entry.url), config, options.signal, options.progress)
  return { feedUrl: fetched.finalUrl, entries, sources: result.sources, warnings: result.warnings }
}

/**
 * Query GDELT DOC 2.0 and optionally ingest the returned article URLs.
 * @param {string} root @param {string} caseId @param {any} options
 */
export async function ingestGdelt(root, caseId, options) {
  const config = options.config
  const params = new URLSearchParams({ query: options.query, mode: 'artlist', format: 'json', maxrecords: String(options.maxRecords ?? 25) })
  if (options.timespan) params.set('timespan', options.timespan)
  if (options.start) params.set('startdatetime', options.start.replaceAll('-', ''))
  if (options.end) params.set('enddatetime', options.end.replaceAll('-', ''))
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`
  const fetched = await fetchPage(url, { timeoutMs: config.timeoutMs, maxBytes: config.maxBytes, userAgent: config.userAgent, signal: options.signal })
  let parsed
  try { parsed = JSON.parse(fetched.text) } catch { return { query: options.query, articles: [], sources: [], warnings: ['GDELT returned non-JSON or an empty result'] } }
  const articles = (parsed.articles ?? []).slice(0, options.maxRecords ?? 25).map((article) => ({
    url: article.url ?? null,
    title: article.title ?? null,
    seenDate: article.seendate ?? null,
    domain: article.domain ?? null,
    language: article.language ?? null,
  })).filter((article) => article.url)
  await addQuery(root, caseId, { channel: 'gdelt', query: options.query, resultCount: articles.length, httpStatus: fetched.httpStatus })
  if (!options.ingest) return { query: options.query, articles, sources: [], warnings: [] }
  const result = await ingestUrls(root, caseId, articles.map((article) => article.url), config, options.signal, options.progress)
  return { query: options.query, articles, sources: result.sources, warnings: result.warnings }
}

/**
 * Query the Wayback CDX API. This is optional infrastructure: archive.org is not reachable from
 * every network, so a failure is returned as a warning and never treated as absence.
 * @param {string} root @param {string} caseId @param {any} options
 */
export async function queryArchive(root, caseId, options) {
  await loadCase(root, caseId)
  const params = new URLSearchParams({ url: options.url, output: 'json', fl: 'timestamp,original,statuscode,digest', limit: String(options.limit ?? 20) })
  if (options.from) params.set('from', options.from.replaceAll('-', ''))
  if (options.to) params.set('to', options.to.replaceAll('-', ''))
  const endpoint = `https://web.archive.org/cdx/search/cdx?${params.toString()}`
  const config = options.config
  try {
    const fetched = await fetchPage(endpoint, { timeoutMs: config.timeoutMs, maxBytes: config.maxBytes, userAgent: config.userAgent, signal: options.signal })
    let rows
    try { rows = JSON.parse(fetched.text) } catch { return { url: options.url, captures: [], warnings: ['archive returned non-JSON'] } }
    if (!Array.isArray(rows) || rows.length === 0) return { url: options.url, captures: [], warnings: [] }
    const header = rows[0]
    const captures = rows.slice(1).map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])))
    await addQuery(root, caseId, { channel: 'archive', query: options.url, resultCount: captures.length, httpStatus: fetched.httpStatus })
    return { url: options.url, captures, warnings: [] }
  } catch (error) {
    const message = `archive unavailable: ${error instanceof Error ? error.message : String(error)}`
    await addQuery(root, caseId, { channel: 'archive', query: options.url, resultCount: 0, error: message })
    return { url: options.url, captures: [], warnings: [message] }
  }
}
