/**
 * Minimal robots.txt gate for page fetches. The parser intentionally supports the common
 * `User-agent` / `Allow` / `Disallow` subset; on an unreachable robots file it fails open so a
 * network problem cannot turn into a false "disallowed" claim.
 * @module dsh-sherlock/temporal/robots
 */
const cache = new Map()
const MAX_BYTES = 128 * 1024

/**
 * @param {string} rawUrl
 * @param {{timeoutMs?:number,signal?:AbortSignal,userAgent?:string}} [options]
 * @returns {Promise<{allowed:boolean, reason:string, source:string}>}
 */
export async function robotsAllowed(rawUrl, options = {}) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { allowed: false, reason: 'unsupported scheme', source: 'local' }
  const key = `${url.protocol}//${url.host}`
  let entry = cache.get(key)
  if (!entry) {
    entry = await loadRobots(url, options)
    cache.set(key, entry)
  }
  if (entry.rules.length === 0) return { allowed: true, reason: 'no matching disallow', source: key }
  const path = `${url.pathname}${url.search}`
  for (const rule of entry.rules) {
    if (rule.allow) continue
    if (path.startsWith(rule.path)) {
      const allowedByLonger = entry.rules.some((candidate) => candidate.allow && path.startsWith(candidate.path) && candidate.path.length >= rule.path.length)
      if (!allowedByLonger) return { allowed: false, reason: `Disallow: ${rule.path}`, source: key }
    }
  }
  return { allowed: true, reason: 'allowed', source: key }
}

/** @param {URL} url @param {any} options */
async function loadRobots(url, options) {
  const target = `${url.protocol}//${url.host}/robots.txt`
  try {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 5000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const response = await fetch(target, { redirect: 'follow', signal, headers: { 'user-agent': options.userAgent ?? 'dsh-sherlock/0.3.0' } })
    if (!response.ok) return { rules: [], source: target }
    const text = (await response.text()).slice(0, MAX_BYTES)
    return { rules: parseRobots(text), source: target }
  } catch {
    return { rules: [], source: target, unavailable: true }
  }
}

/** @param {string} text */
function parseRobots(text) {
  const groups = []
  let current = null
  let applies = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim()
    if (!line) continue
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const field = match[1].toLowerCase()
    const value = match[2].trim()
    if (field === 'user-agent') {
      if (!current || current.done) { current = { agents: [], rules: [], done: false }; groups.push(current) }
      current.agents.push(value.toLowerCase())
      applies = value === '*' || value.toLowerCase().includes('dsh-sherlock')
    } else if ((field === 'allow' || field === 'disallow') && current && applies) {
      current.rules.push({ allow: field === 'allow', path: value || '/' })
      current.done = true
    }
  }
  return groups.filter((group) => group.agents.some((agent) => agent === '*' || agent.includes('dsh-sherlock'))).flatMap((group) => group.rules)
}

/** Test hook. */
export function clearRobotsCache() { cache.clear() }
