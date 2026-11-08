/**
 * DSH-Sherlock detection engine.
 *
 * Dependency-free Node 24 code: fetch, AbortSignal, a per-host gate, and a
 * bounded LRU. No DSH imports, so the same engine can back the plugin, tests,
 * or a future CLI.
 * @module dsh-sherlock/core/engine
 */
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { resolveConfig } from './config.js'
import { compileRegexMap } from './manifest.js'

export const STATUS = Object.freeze({
  CLAIMED: 'claimed',
  AVAILABLE: 'available',
  UNKNOWN: 'unknown',
  BLOCKED: 'blocked',
  ILLEGAL: 'illegal',
  UNRELIABLE: 'unreliable',
})

const WAF_FINGERPRINTS = [
  '<span id="challenge-error-text">',
  'AwsWafIntegration.forceRefreshToken',
  'perimeterxIdentifiers',
  'Just a moment...',
  'Attention Required! | Cloudflare',
  'Enable JavaScript and cookies to continue',
  'challenge-platform',
  'ddos-guard',
  'Please verify you are a human',
]

const PRIVATE_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[?fe80:|\[?fc|\[?fd)/i

/**
 * @param {{data: any, regexes?: Map<string, RegExp>, config?: Record<string, unknown>}} options
 */
export function createEngine({ data, regexes, config = {} }) {
  const merged = resolveConfig(config)
  return {
    data,
    regexes: regexes ?? compileRegexMap(data),
    config: merged,
    cache: new Map(),
    hostGate: new HostGate(merged.perHostDelayMs),
  }
}

class HostGate {
  constructor(delayMs) {
    this.delayMs = delayMs
    this.tails = new Map()
  }

  run(host, task) {
    const key = host || 'unknown.invalid'
    const previous = this.tails.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      if (this.delayMs > 0) await sleep(this.delayMs)
      return task()
    })
    this.tails.set(key, next.catch(() => {}))
    return next
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizeUsername(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'username must be a string' }
  const value = input.normalize('NFC').trim().replace(/^@/, '')
  if (value.length === 0) return { ok: false, reason: 'username must not be empty' }
  if (value.length > 64) return { ok: false, reason: 'username must be at most 64 characters' }
  if (/[\u0000-\u001f\u007f\s/\\?#%]/.test(value)) {
    return { ok: false, reason: 'username contains whitespace, control characters, or URL syntax' }
  }
  if (!/^[\p{L}\p{N}._@+-]+$/u.test(value)) {
    return { ok: false, reason: 'username contains unsupported characters' }
  }
  return { ok: true, value }
}

function encodeUsername(username) {
  return encodeURIComponent(username).replaceAll('%40', '@')
}

function interpolate(value, username) {
  if (typeof value === 'string') return value.replaceAll('{}', username)
  if (Array.isArray(value)) return value.map((item) => interpolate(item, username))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, username)]))
  }
  return value
}

export function resolveSites(engine, { sites, scope = 'core', includeNsfw, maxSites } = {}) {
  const config = engine.config
  let pool = engine.data.sites.filter((site) => {
    if (config.honorExclusions && site.excluded) return false
    if (!(includeNsfw ?? config.includeNsfw) && site.nsfw) return false
    return true
  })

  const unknown = []
  if (Array.isArray(sites) && sites.length > 0) {
    if (sites.length > 50) throw new Error('sites may contain at most 50 names')
    const byName = new Map(pool.map((site) => [site.name.toLowerCase(), site]))
    const selected = []
    const seen = new Set()
    for (const raw of sites) {
      if (typeof raw !== 'string' || raw.trim() === '') throw new Error('sites entries must be non-empty strings')
      const site = byName.get(raw.trim().toLowerCase())
      if (!site) { unknown.push(raw.trim()); continue }
      if (seen.has(site.name)) continue
      seen.add(site.name)
      selected.push(site)
    }
    if (selected.length === 0) throw new Error(`no known sites in request; unknown: ${unknown.join(', ')}`)
    pool = selected
  } else if (scope === 'all') {
    // keep the whole eligible pool
  } else if (scope === 'core') {
    pool = pool.filter((site) => site.tier === 'core')
  } else {
    throw new Error(`scope must be "core" or "all", got ${JSON.stringify(scope)}`)
  }

  pool = [...pool].sort((a, b) => a.name.localeCompare(b.name))
  const limit = Math.max(1, Math.min(Number.isInteger(maxSites) ? maxSites : config.maxSites, config.maxSites))
  const truncated = pool.length > limit
  return { selected: pool.slice(0, limit), unknown, truncated, eligible: pool.length }
}

export async function checkUsername(engine, input, options = {}) {
  const parsed = normalizeUsername(input)
  if (!parsed.ok) throw new Error(`invalid username: ${parsed.reason}`)
  const username = parsed.value
  const resolved = resolveSites(engine, options)
  const signal = options.signal
  const startedAt = new Date()
  const started = performance.now()
  const verifyBudget = { remaining: engine.config.maxVerify }
  const includeAvailable = options.includeAvailable === true

  const results = await mapLimit(resolved.selected, engine.config.concurrency, async (site) => {
    throwIfAborted(signal)
    const cacheKey = cacheKeyFor(engine, username, site, options.verify !== false)
    const cached = readCache(engine, cacheKey)
    if (cached) return cached

    let result = await engine.hostGate.run(site.hostKey, () => checkSite(engine, site, username, { signal }))
    if (options.verify !== false && result.status === STATUS.CLAIMED && verifyBudget.remaining > 0) {
      verifyBudget.remaining -= 1
      result = await engine.hostGate.run(site.hostKey, () => verifyClaimed(engine, site, username, result, { signal }))
    }
    writeCache(engine, cacheKey, result)
    return result
  }, signal)

  const sorted = [...results].sort((a, b) => a.siteName.localeCompare(b.siteName))
  const claimed = sorted.filter((result) => result.status === STATUS.CLAIMED)
  const needsReview = sorted.filter((result) => [STATUS.UNKNOWN, STATUS.BLOCKED, STATUS.UNRELIABLE].includes(result.status))
  const available = sorted.filter((result) => result.status === STATUS.AVAILABLE)
  const summary = {
    total: sorted.length,
    claimed: claimed.length,
    available: available.length,
    unknown: sorted.filter((result) => result.status === STATUS.UNKNOWN).length,
    blocked: sorted.filter((result) => result.status === STATUS.BLOCKED).length,
    illegal: sorted.filter((result) => result.status === STATUS.ILLEGAL).length,
    unreliable: sorted.filter((result) => result.status === STATUS.UNRELIABLE).length,
    durationMs: Math.round(performance.now() - started),
  }

  const warnings = []
  if (resolved.unknown.length > 0) warnings.push(`unknown sites ignored: ${resolved.unknown.join(', ')}`)
  if (resolved.truncated) warnings.push(`site list truncated to ${resolved.selected.length} of ${resolved.eligible}`)
  if (summary.total > 0 && summary.claimed === 0 && summary.blocked > 0) {
    warnings.push('no claims found, but some sites blocked the request; this is not evidence of absence')
  }
  if (verifyBudget.remaining === 0 && claimed.length > 0) {
    warnings.push(`negative-control verification budget exhausted after ${engine.config.maxVerify} claimed sites`)
  }

  const value = {
    schemaVersion: 1,
    username,
    scope: options.sites?.length ? 'explicit' : (options.scope ?? 'core'),
    checkedAt: startedAt.toISOString(),
    durationMs: summary.durationMs,
    manifest: {
      project: engine.data.source?.project ?? 'sherlock-project/sherlock',
      commit: engine.data.source?.upstreamCommit ?? null,
      dataSha256: engine.data.source?.rawSha256 ?? null,
      fetchedAt: engine.data.source?.fetchedAt ?? null,
    },
    summary,
    claimed,
    needsReview,
    results: sorted,
    warnings,
  }
  if (includeAvailable) value.available = available
  return value
}

export function listSites(engine, { scope = 'core', includeNsfw, query, limit = 50 } = {}) {
  const config = engine.config
  let pool = engine.data.sites.filter((site) => {
    if (config.honorExclusions && site.excluded) return false
    if (!(includeNsfw ?? config.includeNsfw) && site.nsfw) return false
    return true
  })
  if (scope === 'core') pool = pool.filter((site) => site.tier === 'core')
  else if (scope !== 'all') throw new Error(`scope must be "core" or "all", got ${JSON.stringify(scope)}`)
  const q = query?.toLowerCase()
  if (q) pool = pool.filter((site) => site.name.toLowerCase().includes(q) || site.urlMain.toLowerCase().includes(q))
  pool = [...pool].sort((a, b) => a.name.localeCompare(b.name))
  const total = pool.length
  const selected = pool.slice(0, limit)
  return {
    count: selected.length,
    total,
    truncated: total > selected.length,
    sites: selected.map((site) => ({
      name: site.name,
      urlMain: site.urlMain,
      detectors: site.detectors,
      reliability: site.reliability,
      nsfw: site.nsfw,
      tier: site.tier,
    })),
  }
}

function cacheKeyFor(engine, username, site, verify) {
  const version = engine.data.source?.rawSha256 ?? 'local'
  return `${version}|${username}|${site.name}|${verify ? 'verify' : 'noverify'}`
}

function readCache(engine, key) {
  if (engine.config.cacheTtlMs === 0 || engine.config.cacheMaxEntries === 0) return undefined
  const entry = engine.cache.get(key)
  if (!entry) return undefined
  const ttl = entry.status === STATUS.BLOCKED || entry.status === STATUS.UNKNOWN
    ? Math.min(engine.config.cacheTtlMs, 60_000)
    : engine.config.cacheTtlMs
  if (Date.now() - entry.at > ttl) {
    engine.cache.delete(key)
    return undefined
  }
  engine.cache.delete(key)
  engine.cache.set(key, entry)
  return entry.value
}

function writeCache(engine, key, value) {
  if (engine.config.cacheTtlMs === 0 || engine.config.cacheMaxEntries === 0) return
  engine.cache.set(key, { at: Date.now(), status: value.status, value })
  while (engine.cache.size > engine.config.cacheMaxEntries) {
    const oldest = engine.cache.keys().next().value
    if (oldest === undefined) break
    engine.cache.delete(oldest)
  }
}

async function mapLimit(items, limit, task, signal) {
  const results = new Array(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      throwIfAborted(signal)
      const current = index
      index += 1
      if (current >= items.length) return
      results[current] = await task(items[current], current)
    }
  })
  await Promise.all(workers)
  return results
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
}

async function checkSite(engine, site, username, { signal } = {}) {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  const validation = validateForSite(engine, site, username)
  const profileUrl = interpolate(site.url, encodeUsername(username))
  if (!validation.ok) {
    return makeResult(site, STATUS.ILLEGAL, profileUrl, {
      elapsedMs: elapsed(),
      confidence: 'high',
      detector: site.detectors.join('+'),
      evidence: { reason: validation.reason },
    })
  }

  let request
  try {
    request = buildRequest(engine, site, username)
  } catch (error) {
    return makeResult(site, STATUS.UNKNOWN, profileUrl, {
      elapsedMs: elapsed(),
      confidence: 'low',
      detector: site.detectors.join('+'),
      evidence: { reason: 'config_error', message: safeMessage(error) },
    })
  }

  const timeoutSignal = AbortSignal.timeout(engine.config.timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  try {
    let fetched = await fetchWithRedirects(request, {
      signal: combined,
      allowPrivateHosts: engine.config.allowPrivateHosts,
    })
    if (request.method === 'HEAD' && [405, 501].includes(fetched.res.status)) {
      fetched = await fetchWithRedirects({ ...request, method: 'GET', body: undefined }, {
        signal: combined,
        allowPrivateHosts: engine.config.allowPrivateHosts,
      })
    }
    const text = await readCapped(fetched.res, engine.config.maxResponseBytes)
    return classify(engine, site, username, fetched, text, profileUrl, elapsed())
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    return makeResult(site, STATUS.UNKNOWN, profileUrl, {
      elapsedMs: elapsed(),
      confidence: 'low',
      detector: site.detectors.join('+'),
      evidence: { reason: classifyFetchError(error, timeoutSignal), message: safeMessage(error) },
    })
  }
}

function validateForSite(engine, site, username) {
  const pattern = engine.regexes.get(site.name)
  if (!pattern) return { ok: true }
  return pattern.test(username)
    ? { ok: true }
    : { ok: false, reason: 'username does not match the site regexCheck' }
}

function buildRequest(engine, site, username) {
  const encoded = encodeUsername(username)
  const url = interpolate(site.urlProbe ?? site.url, encoded)
  assertPublicHttpUrl(url, engine.config)
  const payload = site.payload === null || site.payload === undefined
    ? undefined
    : interpolate(site.payload, username)
  const headers = {
    accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': engine.config.userAgent,
    ...interpolate(site.headers ?? {}, username),
  }
  let body
  if (payload !== undefined && !['GET', 'HEAD'].includes(site.method)) {
    body = JSON.stringify(payload)
    headers['content-type'] ??= 'application/json'
  }
  return { url, method: site.method ?? 'GET', headers, body, site, username }
}

function assertPublicHttpUrl(raw, config = {}) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`invalid URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`unsupported URL scheme: ${url.protocol}`)
  if (url.username || url.password) throw new Error('URL must not contain credentials')
  if (!config.allowPrivateHosts
    && (PRIVATE_HOST_RE.test(url.hostname) || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal'))) {
    throw new Error(`URL points at a private host: ${url.hostname}`)
  }
  return url
}

async function fetchWithRedirects(request, { signal, maxRedirects = 5, allowPrivateHosts = false } = {}) {
  let url = request.url
  let method = request.method
  let body = request.body
  let headers = { ...request.headers }
  const chain = []
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const res = await fetch(url, { method, headers, body, redirect: 'manual', signal })
    const location = res.headers.get('location')
    const next = location ? new URL(location, url).toString() : null
    chain.push({ url, status: res.status, location, nextUrl: next })
    if (![301, 302, 303, 307, 308].includes(res.status) || !next) {
      return { res, url, chain }
    }
    assertPublicHttpUrl(next, { allowPrivateHosts })
    if ((res.status === 303 && method !== 'HEAD') || ((res.status === 301 || res.status === 302) && method !== 'GET' && method !== 'HEAD')) {
      method = 'GET'
      body = undefined
      headers = { ...headers }
      delete headers['content-type']
    }
    url = next
  }
  throw new Error(`too many redirects (more than ${maxRedirects})`)
}

async function readCapped(res, maxBytes) {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (total + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total))
      total = maxBytes
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
    total += value.length
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  return decodeBody(buffer, res.headers.get('content-type'))
}

function decodeBody(buffer, contentType) {
  const charset = /charset\s*=\s*"?([^";]+)/i.exec(contentType ?? '')?.[1]?.trim() ?? 'utf-8'
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  }
}

function classify(engine, site, username, fetched, text, profileUrl, elapsedMs) {
  const waf = WAF_FINGERPRINTS.find((fingerprint) => text.includes(fingerprint))
  if (waf) {
    return makeResult(site, STATUS.BLOCKED, profileUrl, {
      elapsedMs,
      confidence: 'high',
      detector: 'waf',
      httpStatus: fetched.res.status,
      evidence: { reason: 'waf_fingerprint', fingerprint: waf, finalUrl: fetched.url },
    })
  }

  const outcomes = []
  if (site.detectors.includes('message')) outcomes.push(classifyMessage(site, fetched, text))
  if (site.detectors.includes('status_code')) outcomes.push(classifyStatusCode(site, fetched))
  if (site.detectors.includes('response_url')) outcomes.push(classifyResponseUrl(site, username, fetched))
  if (outcomes.length === 0) {
    return makeResult(site, STATUS.UNKNOWN, profileUrl, {
      elapsedMs,
      confidence: 'low',
      detector: 'none',
      httpStatus: fetched.res.status,
      evidence: { reason: 'no_supported_detector' },
    })
  }
  const combined = combineOutcomes(outcomes)
  return makeResult(site, combined.status, profileUrl, {
    elapsedMs,
    confidence: combined.confidence,
    detector: outcomes.map((outcome) => outcome.detector).join('+'),
    httpStatus: fetched.res.status,
    evidence: {
      reason: combined.reason,
      matched: combined.matched ?? null,
      conflict: combined.conflict === true,
      finalUrl: fetched.url,
      redirects: fetched.chain.length - 1,
      detectors: outcomes.map((outcome) => ({ detector: outcome.detector, status: outcome.status, reason: outcome.reason })),
    },
  })
}

function classifyMessage(site, fetched, text) {
  const status = fetched.res.status
  if ([401, 403, 429, 999].includes(status)) {
    return { detector: 'message', status: STATUS.BLOCKED, reason: `http_${status}`, confidence: 'high' }
  }
  if (status >= 500) {
    return { detector: 'message', status: STATUS.UNKNOWN, reason: `http_${status}`, confidence: 'low' }
  }
  if (status === 404 || status === 410) {
    return { detector: 'message', status: STATUS.AVAILABLE, reason: `http_${status}`, confidence: 'high' }
  }
  const matched = site.errorMessages.filter(Boolean).find((message) => text.includes(message))
  if (matched) {
    return {
      detector: 'message',
      status: STATUS.AVAILABLE,
      reason: 'error_message_present',
      matched: truncate(matched, 120),
      confidence: 'high',
    }
  }
  if (status >= 200 && status < 300) {
    return { detector: 'message', status: STATUS.CLAIMED, reason: 'no_error_message', confidence: 'medium' }
  }
  return { detector: 'message', status: STATUS.UNKNOWN, reason: `http_${status}`, confidence: 'low' }
}

function classifyStatusCode(site, fetched) {
  const status = fetched.res.status
  if (site.errorCodes.includes(status)) {
    return {
      detector: 'status_code',
      status: STATUS.AVAILABLE,
      reason: 'error_code_match',
      matched: String(status),
      confidence: 'high',
    }
  }
  if (status >= 200 && status < 300) {
    return { detector: 'status_code', status: STATUS.CLAIMED, reason: `http_${status}`, confidence: 'high' }
  }
  if (status === 404 || status === 410) {
    return { detector: 'status_code', status: STATUS.AVAILABLE, reason: `http_${status}`, confidence: 'high' }
  }
  if ([401, 403, 429, 999].includes(status)) {
    return { detector: 'status_code', status: STATUS.BLOCKED, reason: `http_${status}`, confidence: 'high' }
  }
  if (status >= 500) {
    return { detector: 'status_code', status: STATUS.UNKNOWN, reason: `http_${status}`, confidence: 'low' }
  }
  return { detector: 'status_code', status: STATUS.UNKNOWN, reason: `http_${status}`, confidence: 'low' }
}

function classifyResponseUrl(site, username, fetched) {
  const errorUrl = site.errorUrl ? interpolate(site.errorUrl, encodeUsername(username)) : null
  if (errorUrl && fetched.chain.some((hop) => hop.nextUrl && urlsMatch(hop.nextUrl, hop.url, errorUrl))) {
    return { detector: 'response_url', status: STATUS.AVAILABLE, reason: 'redirect_to_error_url', confidence: 'high' }
  }
  if (errorUrl && urlsMatch(fetched.url, fetched.url, errorUrl)) {
    return { detector: 'response_url', status: STATUS.AVAILABLE, reason: 'final_url_is_error_url', confidence: 'high' }
  }
  const status = fetched.res.status
  if (status >= 200 && status < 300) {
    return { detector: 'response_url', status: STATUS.CLAIMED, reason: `http_${status}`, confidence: 'medium' }
  }
  if (status === 404 || status === 410) {
    return { detector: 'response_url', status: STATUS.AVAILABLE, reason: `http_${status}`, confidence: 'high' }
  }
  if ([401, 403, 429, 999].includes(status)) {
    return { detector: 'response_url', status: STATUS.BLOCKED, reason: `http_${status}`, confidence: 'high' }
  }
  return { detector: 'response_url', status: STATUS.UNKNOWN, reason: `http_${status}`, confidence: 'low' }
}

function urlsMatch(candidate, finalUrl, errorUrl) {
  try {
    const a = new URL(candidate, finalUrl)
    const b = new URL(errorUrl, finalUrl)
    normalizeUrl(a)
    normalizeUrl(b)
    return a.toString() === b.toString()
  } catch {
    return false
  }
}

function normalizeUrl(url) {
  url.hash = ''
  if (url.pathname.endsWith('/') && url.pathname !== '/') url.pathname = url.pathname.slice(0, -1)
  return url
}

function combineOutcomes(outcomes) {
  const byStatus = (status) => outcomes.find((outcome) => outcome.status === status)
  const available = byStatus(STATUS.AVAILABLE)
  const claimed = byStatus(STATUS.CLAIMED)
  const blocked = byStatus(STATUS.BLOCKED)
  const unknown = byStatus(STATUS.UNKNOWN)
  if (available && claimed) {
    return { status: STATUS.AVAILABLE, confidence: 'low', reason: 'conflicting_detectors', conflict: true }
  }
  if (available) return available
  if (claimed) return claimed
  if (blocked) return blocked
  if (unknown) return unknown
  return { status: STATUS.UNKNOWN, reason: 'no_outcome', confidence: 'low' }
}

async function verifyClaimed(engine, site, username, result, { signal } = {}) {
  const control = controlUsername(site)
  if (!control) {
    return { ...result, confidence: 'medium', evidence: { ...result.evidence, control: { skipped: 'regexCheck' } } }
  }
  let controlResult
  try {
    controlResult = await checkSite(engine, site, control, { signal })
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    return { ...result, confidence: 'medium', evidence: { ...result.evidence, control: { error: safeMessage(error) } } }
  }
  if (controlResult.status === STATUS.CLAIMED) {
    return {
      ...result,
      status: STATUS.UNRELIABLE,
      confidence: 'low',
      evidence: {
        ...result.evidence,
        control: {
          username: control,
          status: controlResult.status,
          reason: 'control_username_also_claimed',
        },
      },
    }
  }
  const confidence = controlResult.status === STATUS.AVAILABLE ? 'high' : 'medium'
  return {
    ...result,
    confidence,
    evidence: {
      ...result.evidence,
      control: { username: control, status: controlResult.status },
    },
  }
}

function controlUsername(site) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `zz${randomBytes(8).toString('hex')}`
    if (!site.regexCheck) return candidate
    try {
      if (new RegExp(site.regexCheck, 'u').test(candidate)) return candidate
    } catch {
      return null
    }
  }
  return null
}

function makeResult(site, status, url, extra = {}) {
  return {
    siteName: site.name,
    status,
    url,
    detector: extra.detector ?? site.detectors.join('+'),
    httpStatus: extra.httpStatus ?? null,
    elapsedMs: extra.elapsedMs ?? null,
    confidence: extra.confidence ?? 'low',
    reliability: site.reliability ?? 'medium',
    nsfw: site.nsfw === true,
    evidence: extra.evidence ?? {},
  }
}

function classifyFetchError(error, timeoutSignal) {
  if (timeoutSignal.aborted) return 'timeout'
  if (error?.name === 'TimeoutError') return 'timeout'
  if (error?.name === 'AbortError') return 'aborted'
  if (error?.cause?.code === 'ENOTFOUND') return 'dns'
  if (error?.cause?.code === 'ECONNREFUSED') return 'connection_refused'
  if (error?.cause?.code === 'ECONNRESET') return 'connection_reset'
  if (error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') return 'connect_timeout'
  if (error?.cause?.code === 'CERT_HAS_EXPIRED' || error?.cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return 'tls'
  return 'network'
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error)
  return truncate(message.replaceAll(/\s+/g, ' '), 240)
}

function truncate(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
