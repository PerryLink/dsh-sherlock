#!/usr/bin/env node
/** Offline data-pack gate used by `prepack` and CI. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeRegex } from '../lib/core/manifest.js'

const root = new URL('..', import.meta.url)
const data = JSON.parse(readFileSync(new URL('data/sites.json', root), 'utf8'))
const source = JSON.parse(readFileSync(new URL('data/SOURCE.json', root), 'utf8'))
const curation = JSON.parse(readFileSync(new URL('data/curation.json', root), 'utf8'))
const exclusions = readFileSync(new URL('data/exclusions.txt', root), 'utf8')
  .split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

assert.equal(data.schemaVersion, 1)
assert.equal(data.sites.length, 481)
assert.equal(source.exportedSites, 481)
assert.equal(source.excluded, 47)
assert.equal(source.nsfw, 19)
assert.equal(source.effectiveDefault, 417)
assert.equal(new Set(data.sites.map((site) => site.name)).size, data.sites.length)
assert.equal(data.sites.filter((site) => site.tier === 'core').length, 45)
assert.equal(data.sites.filter((site) => site.reliability === 'low').length, 30)
assert.equal(data.sites.filter((site) => !site.excluded && !site.nsfw).length, 417)
assert.match(source.upstreamCommit, /^[0-9a-f]{40}$/)
assert.match(source.rawSha256, /^[0-9a-f]{64}$/)
for (const name of exclusions) assert.ok(data.sites.some((site) => site.name === name), `missing exclusion: ${name}`)
for (const site of data.sites) {
  assert.ok(site.detectors.length > 0)
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
assert.equal(curation.core.length, 45)
assert.equal(curation.lowReliability.length, 30)
console.log(`data ok: ${data.sites.length} sites, ${exclusions.length} exclusions, ${source.effectiveDefault} effective, ${curation.core.length} core`)
