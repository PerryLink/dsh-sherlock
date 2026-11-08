/**
 * Plugin configuration: defaults, validation, and the resolved config object.
 * @module dsh-sherlock/core/config
 */

/**
 * @typedef {object} SherlockConfig
 * @property {'core'|'all'} defaultScope
 * @property {number} maxSites
 * @property {number} concurrency
 * @property {number} perHostDelayMs
 * @property {number} timeoutMs
 * @property {number} toolTimeoutMs
 * @property {number} maxResponseBytes
 * @property {number} maxVerify
 * @property {number} cacheTtlMs
 * @property {number} cacheMaxEntries
 * @property {boolean} includeNsfw
 * @property {boolean} honorExclusions
 * @property {boolean} allowPrivateHosts
 * @property {string} userAgent
 * @property {string|null} manifestPath
 */

/** @type {Readonly<SherlockConfig>} */
export const DEFAULT_CONFIG = Object.freeze({
  defaultScope: 'core',
  maxSites: 120,
  concurrency: 10,
  perHostDelayMs: 350,
  timeoutMs: 10_000,
  toolTimeoutMs: 180_000,
  maxResponseBytes: 512 * 1024,
  maxVerify: 30,
  cacheTtlMs: 10 * 60 * 1000,
  cacheMaxEntries: 2_000,
  includeNsfw: false,
  honorExclusions: true,
  allowPrivateHosts: false,
  userAgent: 'dsh-sherlock/0.1.0 (+https://github.com/PerryLink/dsh-sherlock)',
  manifestPath: null,
})

const ALLOWED_KEYS = new Set(Object.keys(DEFAULT_CONFIG))

/**
 * Merge user config with defaults and fail loudly on invalid values.
 * @param {Record<string, unknown>|undefined|null} raw
 * @returns {SherlockConfig}
 */
export function resolveConfig(raw) {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error('dsh-sherlock: config must be an object')
  }
  const input = /** @type {Record<string, unknown>} */ (raw ?? {})
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`dsh-sherlock: unknown config key "${key}"`)
  }
  const config = { ...DEFAULT_CONFIG, ...input }
  assertEnum('defaultScope', config.defaultScope, ['core', 'all'])
  assertInteger('maxSites', config.maxSites, 1, 120)
  assertInteger('concurrency', config.concurrency, 1, 50)
  assertInteger('perHostDelayMs', config.perHostDelayMs, 0, 60_000)
  assertInteger('timeoutMs', config.timeoutMs, 500, 60_000)
  assertInteger('toolTimeoutMs', config.toolTimeoutMs, 1_000, 600_000)
  assertInteger('maxResponseBytes', config.maxResponseBytes, 1_024, 5 * 1024 * 1024)
  assertInteger('maxVerify', config.maxVerify, 0, 100)
  assertInteger('cacheTtlMs', config.cacheTtlMs, 0, 24 * 60 * 60 * 1000)
  assertInteger('cacheMaxEntries', config.cacheMaxEntries, 0, 10_000)
  assertBoolean('includeNsfw', config.includeNsfw)
  assertBoolean('honorExclusions', config.honorExclusions)
  assertBoolean('allowPrivateHosts', config.allowPrivateHosts)
  if (typeof config.userAgent !== 'string' || config.userAgent.trim() === '') {
    throw new Error('dsh-sherlock: config.userAgent must be a non-empty string')
  }
  if (config.manifestPath !== null && typeof config.manifestPath !== 'string') {
    throw new Error('dsh-sherlock: config.manifestPath must be a string or null')
  }
  return /** @type {SherlockConfig} */ (config)
}

/**
 * @param {string} name
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 */
function assertInteger(name, value, min, max) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < min || /** @type {number} */ (value) > max) {
    throw new Error(`dsh-sherlock: config.${name} must be an integer in [${min}, ${max}]`)
  }
}

/**
 * @param {string} name
 * @param {unknown} value
 * @param {readonly string[]} allowed
 */
function assertEnum(name, value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`dsh-sherlock: config.${name} must be one of ${allowed.join(', ')}`)
  }
}

/**
 * @param {string} name
 * @param {unknown} value
 */
function assertBoolean(name, value) {
  if (typeof value !== 'boolean') throw new Error(`dsh-sherlock: config.${name} must be a boolean`)
}
