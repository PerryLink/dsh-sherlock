#!/usr/bin/env node
/** Offline data-pack gate used by `prepack`, CI, and the data-sync workflow. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeRegex } from '../lib/core/manifest.js'

const argIndex = process.argv.indexOf('--data-dir')
const dataDir = argIndex >= 0 ? resolve(process.argv[argIndex + 1]) : fileURLToPath(new URL('../data/', import.meta.url))
const readJson = (name) => JSON.parse(readFileSync(join(dataDir, name), 'utf8'))
const data = readJson('sites.json')
const source = readJson('SOURCE.json')
const curation = readJson('curation.json')
const exclusions = readFileSync(join(dataDir, 'exclusions.txt'), 'utf8')
  .split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

assert.equal(data.schemaVersion, 1)
assert.ok(Array.isArray(data.sites) && data.sites.length > 0)
assert.equal(new Set(data.sites.map((site) => site.name)).size, data.sites.length)
assert.ok(exclusions.length > 0)
assert.equal(source.exportedSites, data.sites.length)
assert.equal(source.excluded, exclusions.length)
assert.equal(source.nsfw, data.sites.filter((site) => site.nsfw).length)
assert.equal(source.effectiveDefault, data.sites.filter((site) => !site.excluded && !site.nsfw).length)
assert.equal(source.core, data.sites.filter((site) => site.tier === 'core').length)
assert.ok(source.rawSites >= source.exportedSites)
assert.match(source.upstreamCommit, /^[0-9a-f]{40}$/)
assert.match(source.rawSha256, /^[0-9a-f]{64}$/)
for (const name of exclusions) assert.ok(data.sites.some((site) => site.name === name), `missing exclusion: ${name}`)
for (const site of data.sites) {
  assert.ok(Array.isArray(site.detectors) && site.detectors.length > 0, `${site.name}: detectors`)
  for (const detector of site.detectors) assert.ok(['status_code', 'message', 'response_url'].includes(detector), `${site.name}: ${detector}`)
  for (const key of Object.keys(site.headers)) {
    assert.match(key, /^(accept|accept-language|content-type|user-agent|referer|origin|sec-fetch-(mode|site|dest))$/i, `${site.name}: ${key}`)
  }
  if (site.regexCheck) {
    const normalized = normalizeRegex(site.regexCheck)
    assert.doesNotThrow(() => new RegExp(normalized, 'u'), `${site.name}: ${site.regexCheck}`)
  }
  for (const value of [site.url, site.urlMain, site.urlProbe].filter(Boolean)) {
    const url = new URL(value.replaceAll('{}', 'x'))
    assert.ok(url.protocol === 'https:' || url.protocol === 'http:', `${site.name}: ${value}`)
  }
}
assert.equal(curation.core.length, data.sites.filter((site) => site.tier === 'core').length)
assert.equal(curation.lowReliability.length, data.sites.filter((site) => site.reliability === 'low').length)
assert.deepEqual(curation.core.slice().sort(), data.sites.filter((site) => site.tier === 'core').map((site) => site.name).sort())
assert.deepEqual(curation.lowReliability.slice().sort(), data.sites.filter((site) => site.reliability === 'low').map((site) => site.name).sort())
console.log(`data ok: ${data.sites.length} sites, ${exclusions.length} exclusions, ${source.effectiveDefault} effective, ${source.core} core`)
