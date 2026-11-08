/**
 * Model-facing tool definitions. Raw ToolDefinitions (no `defineTool` import)
 * keep the published bundle zero-dependency and installable from git without a
 * build step.
 * @module dsh-sherlock/dsh/tools
 */
import { checkUsername, listSites } from '../core/engine.js'
import { renderCheckResult, renderSitesResult } from '../core/render.js'

export const STATUS_VALUES = ['claimed', 'available', 'unknown', 'blocked', 'illegal', 'unreliable']
const CONFIDENCE_VALUES = ['high', 'medium', 'low']
const RELIABILITY_VALUES = ['high', 'medium', 'low']
const TIER_VALUES = ['core', 'extended']

const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] }
const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] }

const RESULT = {
  type: 'object',
  properties: {
    siteName: { type: 'string' },
    status: { type: 'string', enum: STATUS_VALUES },
    url: { type: 'string' },
    detector: { type: 'string' },
    httpStatus: nullableNumber,
    elapsedMs: nullableNumber,
    confidence: { type: 'string', enum: CONFIDENCE_VALUES },
    reliability: { type: 'string', enum: RELIABILITY_VALUES },
    nsfw: { type: 'boolean' },
    evidence: { type: 'object', additionalProperties: true },
  },
  required: ['siteName', 'status', 'url', 'detector', 'httpStatus', 'elapsedMs', 'confidence', 'reliability', 'nsfw', 'evidence'],
  additionalProperties: false,
}

const SUMMARY = {
  type: 'object',
  properties: {
    total: { type: 'number' },
    claimed: { type: 'number' },
    available: { type: 'number' },
    unknown: { type: 'number' },
    blocked: { type: 'number' },
    illegal: { type: 'number' },
    unreliable: { type: 'number' },
    durationMs: { type: 'number' },
  },
  required: ['total', 'claimed', 'available', 'unknown', 'blocked', 'illegal', 'unreliable', 'durationMs'],
  additionalProperties: false,
}

const MANIFEST = {
  type: 'object',
  properties: {
    project: { type: 'string' },
    commit: nullableString,
    dataSha256: nullableString,
    fetchedAt: nullableString,
  },
  required: ['project', 'commit', 'dataSha256', 'fetchedAt'],
  additionalProperties: false,
}

const CHECK_PARAMETERS = {
  type: 'object',
  properties: {
    username: {
      type: 'string',
      description: 'Public handle to check. A leading @ is ignored. 1–64 letters, digits, or . _ @ + - characters.',
    },
    scope: {
      type: 'string',
      enum: ['core', 'all'],
      description: 'core = curated reliable set; all = every eligible upstream site up to max_sites (slower, noisier).',
    },
    sites: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional exact site names to check instead of a scope. Case-insensitive; at most 50.',
    },
    include_nsfw: { type: 'boolean', description: 'Include NSFW sites from the manifest. Default false.' },
    include_available: { type: 'boolean', description: 'List sites where the handle appears available. Default false; counts are always returned.' },
    verify: { type: 'boolean', description: 'Run a random negative-control probe for claimed sites to detect soft-404 false positives. Default true.' },
    max_sites: { type: 'number', description: 'Cap the number of sites probed. Default 120, hard maximum 120. scope="all" is still capped by this.' },
  },
  required: ['username'],
  additionalProperties: false,
}

const CHECK_OUTPUT = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'number' },
    toolVersion: { type: 'string' },
    username: { type: 'string' },
    scope: { type: 'string', enum: ['core', 'all', 'explicit'] },
    checkedAt: { type: 'string' },
    durationMs: { type: 'number' },
    manifest: MANIFEST,
    summary: SUMMARY,
    claimed: { type: 'array', items: RESULT },
    needsReview: { type: 'array', items: RESULT },
    available: { type: 'array', items: RESULT },
    results: { type: 'array', items: RESULT },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['schemaVersion', 'toolVersion', 'username', 'scope', 'checkedAt', 'durationMs', 'manifest', 'summary', 'claimed', 'needsReview', 'results', 'warnings'],
  additionalProperties: false,
}

const SITE = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    urlMain: { type: 'string' },
    detectors: { type: 'array', items: { type: 'string' } },
    reliability: { type: 'string', enum: RELIABILITY_VALUES },
    nsfw: { type: 'boolean' },
    tier: { type: 'string', enum: TIER_VALUES },
  },
  required: ['name', 'urlMain', 'detectors', 'reliability', 'nsfw', 'tier'],
  additionalProperties: false,
}

const SITES_PARAMETERS = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Optional case-insensitive substring matched against site name or URL.' },
    scope: { type: 'string', enum: ['core', 'all'], description: 'core (default) or all eligible sites.' },
    include_nsfw: { type: 'boolean', description: 'Include NSFW sites. Default false.' },
    limit: { type: 'number', description: 'Maximum rows to return. Default 50, maximum 200.' },
  },
  additionalProperties: false,
}

const SITES_OUTPUT = {
  type: 'object',
  properties: {
    count: { type: 'number' },
    total: { type: 'number' },
    truncated: { type: 'boolean' },
    sites: { type: 'array', items: SITE },
  },
  required: ['count', 'total', 'truncated', 'sites'],
  additionalProperties: false,
}

/**
 * @param {any} engine
 * @param {{defaultScope: 'core'|'all', toolTimeoutMs: number}} config
 * @param {string} toolVersion
 * @returns {any[]}
 */
export function createTools(engine, config, toolVersion) {
  return [
    {
      name: 'sherlock_check',
      description: [
        'Check whether a public username exists on websites, using a pinned snapshot of the Sherlock site manifest.',
        'Returns claimed profile URLs plus blocked/unknown/unreliable sites; it does not prove identity.',
        'Defaults to a curated core set. Use scope="all" only for broad coverage; it is still capped by max_sites (default 120).',
        'Never use for authentication bypass or harassment.',
      ].join(' '),
      parameters: CHECK_PARAMETERS,
      output: {
        schema: CHECK_OUTPUT,
        render: (args, value) => [{ type: 'text', text: renderCheckResult(args, value) }],
      },
      timeoutMs: config.toolTimeoutMs,
      async execute(args, exec) {
        const parsed = parseCheckArgs(args, config.defaultScope)
        const value = await checkUsername(engine, parsed.username, {
          scope: parsed.scope,
          sites: parsed.sites,
          includeNsfw: parsed.includeNsfw,
          includeAvailable: parsed.includeAvailable,
          verify: parsed.verify,
          maxSites: parsed.maxSites,
          signal: exec?.signal,
        })
        value.toolVersion = toolVersion
        return value
      },
    },
    {
      name: 'sherlock_sites',
      description:
        'List the sites in the pinned Sherlock manifest, with detector type, reliability tier, and NSFW flag. '
        + 'Use it to choose site names before calling sherlock_check.',
      parameters: SITES_PARAMETERS,
      output: {
        schema: SITES_OUTPUT,
        render: (args, value) => [{ type: 'text', text: renderSitesResult(args, value) }],
      },
      timeoutMs: 10_000,
      async execute(args) {
        const parsed = parseSitesArgs(args)
        return listSites(engine, {
          scope: parsed.scope,
          includeNsfw: parsed.includeNsfw,
          query: parsed.query,
          limit: parsed.limit,
        })
      },
    },
  ]
}

/**
 * @param {unknown} args
 * @param {'core'|'all'} defaultScope
 * @returns {{username: string, scope: 'core'|'all', sites?: string[], includeNsfw: boolean, includeAvailable: boolean, verify: boolean, maxSites?: number}}
 */
function parseCheckArgs(args, defaultScope) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object')
  const input = /** @type {Record<string, unknown>} */ (args)
  if (typeof input.username !== 'string') throw new Error('username must be a string')
  const scope = input.scope ?? defaultScope
  if (scope !== 'core' && scope !== 'all') throw new Error('scope must be "core" or "all"')
  const typedScope = /** @type {'core'|'all'} */ (scope)
  let sites
  if (input.sites !== undefined) {
    if (!Array.isArray(input.sites) || input.sites.length > 50) throw new Error('sites must be an array of at most 50 strings')
    if (input.sites.some((site) => typeof site !== 'string' || site.trim() === '')) throw new Error('sites entries must be non-empty strings')
    sites = input.sites.length > 0 ? input.sites : undefined
  }
  for (const key of ['include_nsfw', 'include_available', 'verify']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`${key} must be a boolean`)
  }
  let maxSites
  if (input.max_sites !== undefined) {
    if (!Number.isInteger(input.max_sites) || /** @type {number} */ (input.max_sites) < 1 || /** @type {number} */ (input.max_sites) > 120) {
      throw new Error('max_sites must be an integer in [1, 120]')
    }
    maxSites = /** @type {number} */ (input.max_sites)
  }
  return {
    username: input.username,
    scope: typedScope,
    sites,
    includeNsfw: input.include_nsfw === true,
    includeAvailable: input.include_available === true,
    verify: input.verify !== false,
    maxSites,
  }
}

/**
 * @param {unknown} args
 * @returns {{query?: string, scope: 'core'|'all', includeNsfw: boolean, limit: number}}
 */
function parseSitesArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object')
  const input = /** @type {Record<string, unknown>} */ (args)
  const scope = input.scope ?? 'core'
  if (scope !== 'core' && scope !== 'all') throw new Error('scope must be "core" or "all"')
  const typedScope = /** @type {'core'|'all'} */ (scope)
  if (input.query !== undefined && typeof input.query !== 'string') throw new Error('query must be a string')
  if (input.include_nsfw !== undefined && typeof input.include_nsfw !== 'boolean') throw new Error('include_nsfw must be a boolean')
  let limit = 50
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || /** @type {number} */ (input.limit) < 1 || /** @type {number} */ (input.limit) > 200) {
      throw new Error('limit must be an integer in [1, 200]')
    }
    limit = /** @type {number} */ (input.limit)
  }
  return {
    query: typeof input.query === 'string' ? input.query : undefined,
    scope: typedScope,
    includeNsfw: input.include_nsfw === true,
    limit,
  }
}
