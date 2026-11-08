/**
 * Manifest loading and validation. The published data pack is normalized
 * already; this module still fails loudly on malformed or unsafe input.
 * @module dsh-sherlock/core/manifest
 */
import { readFileSync } from 'node:fs'

/** Default data pack shipped with the package. */
export const DEFAULT_MANIFEST = new URL('../../data/sites.json', import.meta.url)

const DETECTORS = new Set(['status_code', 'message', 'response_url'])
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT'])
const TIERS = new Set(['core', 'extended'])
const RELIABILITY = new Set(['high', 'medium', 'low'])

/**
 * @typedef {object} Site
 * @property {string} name
 * @property {string} urlMain
 * @property {string} url
 * @property {string|null} urlProbe
 * @property {string[]} detectors
 * @property {number[]} errorCodes
 * @property {string[]} errorMessages
 * @property {string|null} errorUrl
 * @property {string|null} regexCheck
 * @property {'GET'|'HEAD'|'POST'|'PUT'} method
 * @property {Record<string,string>} headers
 * @property {Record<string,unknown>|null} payload
 * @property {boolean} nsfw
 * @property {string[]} tags
 * @property {'core'|'extended'} tier
 * @property {'high'|'medium'|'low'} reliability
 * @property {boolean} excluded
 * @property {string} hostKey
 * @property {string|null} sampleUsername
 */

/**
 * @typedef {object} Manifest
 * @property {number} schemaVersion
 * @property {{project?: string, upstreamCommit?: string|null, rawSha256?: string|null, fetchedAt?: string|null}} source
 * @property {Site[]} sites
 */

/**
 * @typedef {object} LoadedManifest
 * @property {Manifest} data
 * @property {Map<string, RegExp>} regexes
 */

/**
 * Read and validate the manifest, compiling every `regexCheck` once.
 * @param {string|URL} [manifestPath]
 * @returns {LoadedManifest}
 */
export function loadManifest(manifestPath = DEFAULT_MANIFEST) {
  const text = readFileSync(manifestPath, 'utf8')
  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new Error(`dsh-sherlock: manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  validateManifest(data)
  const regexes = compileRegexMap(data)
  return { data, regexes }
}

/**
 * Validate the normalized manifest shape. Mutates only `regexCheck` to the
 * JavaScript-compatible spelling.
 * @param {unknown} value
 * @returns {asserts value is Manifest}
 */
export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('dsh-sherlock: manifest must be an object')
  }
  const data = /** @type {Record<string, any>} */ (value)
  if (data.schemaVersion !== 1) throw new Error('dsh-sherlock: manifest.schemaVersion must be 1')
  if (!data.source || typeof data.source !== 'object') throw new Error('dsh-sherlock: manifest.source is required')
  if (!Array.isArray(data.sites) || data.sites.length === 0) throw new Error('dsh-sherlock: manifest.sites must be a non-empty array')
  const seen = new Set()
  for (const site of data.sites) {
    if (!site || typeof site !== 'object') throw new Error('dsh-sherlock: every site must be an object')
    if (typeof site.name !== 'string' || site.name.trim() === '') throw new Error('dsh-sherlock: site.name is required')
    if (seen.has(site.name)) throw new Error(`dsh-sherlock: duplicate site "${site.name}"`)
    seen.add(site.name)
    if (typeof site.urlMain !== 'string' || !isHttpUrl(site.urlMain)) throw new Error(`dsh-sherlock: ${site.name}.urlMain is invalid`)
    if (typeof site.url !== 'string' || !isHttpTemplate(site.url)) throw new Error(`dsh-sherlock: ${site.name}.url is invalid`)
    if (site.urlProbe !== null && (typeof site.urlProbe !== 'string' || !isHttpTemplate(site.urlProbe))) {
      throw new Error(`dsh-sherlock: ${site.name}.urlProbe is invalid`)
    }
    if (!Array.isArray(site.detectors) || site.detectors.length === 0 || site.detectors.some((d) => !DETECTORS.has(d))) {
      throw new Error(`dsh-sherlock: ${site.name}.detectors is invalid`)
    }
    if (!Array.isArray(site.errorCodes) || site.errorCodes.some((code) => !Number.isInteger(code))) {
      throw new Error(`dsh-sherlock: ${site.name}.errorCodes is invalid`)
    }
    if (!Array.isArray(site.errorMessages) || site.errorMessages.some((message) => typeof message !== 'string')) {
      throw new Error(`dsh-sherlock: ${site.name}.errorMessages is invalid`)
    }
    if (site.errorUrl !== null && typeof site.errorUrl !== 'string') throw new Error(`dsh-sherlock: ${site.name}.errorUrl is invalid`)
    if (site.regexCheck !== null && typeof site.regexCheck !== 'string') throw new Error(`dsh-sherlock: ${site.name}.regexCheck is invalid`)
    if (site.regexCheck !== null) site.regexCheck = normalizeRegex(site.regexCheck)
    if (!METHODS.has(site.method)) throw new Error(`dsh-sherlock: ${site.name}.method is invalid`)
    if (!site.headers || typeof site.headers !== 'object' || Array.isArray(site.headers)) {
      throw new Error(`dsh-sherlock: ${site.name}.headers is invalid`)
    }
    for (const key of Object.keys(site.headers)) {
      if (!/^(accept|accept-language|content-type|user-agent|referer|origin|sec-fetch-(mode|site|dest))$/i.test(key)) {
        throw new Error(`dsh-sherlock: ${site.name} has a non-allowlisted header "${key}"`)
      }
    }
    if (site.payload !== null && (typeof site.payload !== 'object' || Array.isArray(site.payload))) {
      throw new Error(`dsh-sherlock: ${site.name}.payload must be an object or null`)
    }
    if (typeof site.nsfw !== 'boolean') throw new Error(`dsh-sherlock: ${site.name}.nsfw must be boolean`)
    if (!Array.isArray(site.tags) || site.tags.some((tag) => typeof tag !== 'string')) {
      throw new Error(`dsh-sherlock: ${site.name}.tags is invalid`)
    }
    if (!TIERS.has(site.tier)) throw new Error(`dsh-sherlock: ${site.name}.tier is invalid`)
    if (!RELIABILITY.has(site.reliability)) throw new Error(`dsh-sherlock: ${site.name}.reliability is invalid`)
    if (typeof site.excluded !== 'boolean') throw new Error(`dsh-sherlock: ${site.name}.excluded must be boolean`)
    if (typeof site.hostKey !== 'string' || site.hostKey.trim() === '') throw new Error(`dsh-sherlock: ${site.name}.hostKey is required`)
  }
}

/**
 * Convert Python's `{,n}` quantifier spelling to JavaScript's `{0,n}`.
 * @param {string} pattern
 * @returns {string}
 */
export function normalizeRegex(pattern) {
  return pattern.replace(/(?<!\\)\{,(\d+)\}/g, '{0,$1}')
}

/**
 * @param {Manifest} data
 * @returns {Map<string, RegExp>}
 */
export function compileRegexMap(data) {
  const map = new Map()
  for (const site of data.sites) {
    if (!site.regexCheck) continue
    try {
      map.set(site.name, new RegExp(site.regexCheck, 'u'))
    } catch (error) {
      throw new Error(`dsh-sherlock: ${site.name}.regexCheck does not compile in JavaScript: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return map
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isHttpTemplate(value) {
  return isHttpUrl(value.replaceAll('{}', 'x'))
}
