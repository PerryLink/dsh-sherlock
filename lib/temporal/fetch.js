/**
 * Evidence-grade HTTP fetch. The DSH web seam is useful for quick reads, but it deliberately
 * omits response headers and has no custom headers; a temporal record needs both. This module
 * keeps the safe subset: public HTTP(S), private-host rejection, bounded redirects/body/time,
 * and a header allowlist that cannot leak cookies or credentials.
 * @module dsh-sherlock/temporal/fetch
 */
import { createHash } from 'node:crypto'
import { assertPublicHttpUrl } from '../core/engine.js'

const MAX_REDIRECTS = 5
const SAFE_REQUEST_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
}

/**
 * @typedef {object} FetchRecord
 * @property {string} requestedUrl
 * @property {string} finalUrl
 * @property {number} httpStatus
 * @property {string} contentType
 * @property {string} charset
 * @property {string} fetchedAt
 * @property {number} byteLength
 * @property {string} sha256
 * @property {string} textSha256
 * @property {string} text
 * @property {Record<string,string>} headers
 * @property {string[]} redirects
 * @property {'open'|'blocked'|'gone'|'unknown'} access
 * @property {string} domain
 */

/**
 * @param {string} rawUrl
 * @param {{timeoutMs?:number,maxBytes?:number,userAgent?:string,signal?:AbortSignal,allowPrivateHosts?:boolean}} [options]
 * @returns {Promise<FetchRecord>}
 */
export async function fetchPage(rawUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  const userAgent = options.userAgent ?? 'dsh-sherlock/0.2.0 (+https://github.com/PerryLink/dsh-sherlock)'
  const allowPrivateHosts = options.allowPrivateHosts ?? false
  let current = assertPublicHttpUrl(rawUrl, { allowPrivateHosts }).toString()
  const requestedUrl = current
  const redirects = []
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { ...SAFE_REQUEST_HEADERS, 'user-agent': userAgent },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return toRecord(requestedUrl, current, response, Buffer.alloc(0), redirects, maxBytes)
      if (hop === MAX_REDIRECTS) throw new Error(`too many redirects for ${requestedUrl}`)
      const next = new URL(location, current).toString()
      assertPublicHttpUrl(next, { allowPrivateHosts })
      redirects.push(next)
      current = next
      await response.body?.cancel?.().catch?.(() => {})
      continue
    }
    const buffer = await readCapped(response, maxBytes, signal)
    return toRecord(requestedUrl, current, response, buffer, redirects, maxBytes)
  }
  throw new Error(`too many redirects for ${requestedUrl}`)
}

/**
 * @param {string} requestedUrl
 * @param {string} finalUrl
 * @param {Response} response
 * @param {Buffer} buffer
 * @param {string[]} redirects
 * @param {number} maxBytes
 * @returns {FetchRecord}
 */
function toRecord(requestedUrl, finalUrl, response, buffer, redirects, maxBytes) {
  const headers = {
    'content-type': response.headers.get('content-type') ?? '',
    'content-language': response.headers.get('content-language') ?? '',
    date: response.headers.get('date') ?? '',
    'last-modified': response.headers.get('last-modified') ?? '',
    etag: response.headers.get('etag') ?? '',
    server: response.headers.get('server') ?? '',
  }
  const contentType = parseContentType(headers['content-type'])
  const charset = contentType.charset || 'utf-8'
  const raw = buffer.subarray(0, maxBytes)
  let text = ''
  try {
    text = decodeText(raw, charset)
  } catch {
    text = raw.toString('utf8')
  }
  const status = response.status
  return {
    requestedUrl,
    finalUrl,
    httpStatus: status,
    contentType: contentType.mime,
    charset,
    fetchedAt: new Date().toISOString(),
    byteLength: raw.byteLength,
    sha256: hash(raw),
    textSha256: hash(Buffer.from(text, 'utf8')),
    text,
    headers,
    redirects,
    access: status === 401 || status === 403 || status === 429 || status === 999 ? 'blocked' : status === 404 || status === 410 ? 'gone' : status >= 200 && status < 400 ? 'open' : 'unknown',
    domain: new URL(finalUrl).hostname.toLowerCase(),
  }
}

/** @param {Response} response @param {number} maxBytes @param {AbortSignal} signal */
async function readCapped(response, maxBytes, signal) {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (total < maxBytes) {
      if (signal.aborted) throw signal.reason ?? new Error('aborted')
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        const remaining = maxBytes - total
        const chunk = Buffer.from(value).subarray(0, remaining)
        chunks.push(chunk)
        total += chunk.byteLength
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks)
}

/** @param {string} value */
function parseContentType(value) {
  const [mimePart, ...params] = value.split(';')
  let charset = ''
  for (const param of params) {
    const match = /^\s*charset\s*=\s*"?([^";]+)"?/i.exec(param)
    if (match) charset = match[1].trim().toLowerCase()
  }
  return { mime: mimePart.trim().toLowerCase() || 'application/octet-stream', charset }
}

/** @param {Buffer} buffer @param {string} charset */
function decodeText(buffer, charset) {
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/** @param {Buffer|string} value */
export function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}
