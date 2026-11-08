#!/usr/bin/env node
/**
 * Live benchmark for the core/all site sets. This makes real network requests;
 * run it manually, not in CI.
 *
 *   node scripts/benchmark.mjs --username blue --scope core --verify=false
 */
import { loadManifest } from '../lib/core/manifest.js'
import { createEngine, checkUsername } from '../lib/core/engine.js'
import { resolveConfig } from '../lib/core/config.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const username = option('--username', 'blue')
const scope = option('--scope', 'core')
const verify = option('--verify', 'false') !== 'false'
const timeoutMs = Number(option('--timeout-ms', '8000'))
const concurrency = Number(option('--concurrency', '10'))
const maxSites = Number(option('--max-sites', '120'))
const json = args.includes('--json')
if (scope !== 'core' && scope !== 'all') throw new Error('--scope must be core or all')
if (!Number.isInteger(timeoutMs) || timeoutMs < 500) throw new Error('--timeout-ms must be >= 500')
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) throw new Error('--concurrency must be 1..50')
if (!Number.isInteger(maxSites) || maxSites < 1 || maxSites > 120) throw new Error('--max-sites must be 1..120')

const { data, regexes } = loadManifest()
const engine = createEngine({
  data,
  regexes,
  config: resolveConfig({ concurrency, perHostDelayMs: 350, timeoutMs, cacheTtlMs: 0, maxSites }),
})
const started = performance.now()
const value = await checkUsername(engine, username, { scope, verify, maxSites, includeAvailable: false })
const wallMs = Math.round(performance.now() - started)
const report = { ...value, wallMs }
if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`benchmark ${username} scope=${scope} sites=${value.summary.total} verify=${verify}`)
  console.log(`wall=${wallMs}ms engine=${value.summary.durationMs}ms`)
  console.log(`claimed=${value.summary.claimed} available=${value.summary.available} blocked=${value.summary.blocked} unknown=${value.summary.unknown} unreliable=${value.summary.unreliable} illegal=${value.summary.illegal}`)
  console.log(`warnings=${value.warnings.length}`)
}
