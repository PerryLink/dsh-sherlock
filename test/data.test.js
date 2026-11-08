import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_MANIFEST, loadManifest, normalizeRegex } from '../lib/core/manifest.js'

const { data, regexes } = loadManifest(DEFAULT_MANIFEST)
const source = JSON.parse(readFileSync(new URL('../data/SOURCE.json', import.meta.url), 'utf8'))
const curation = JSON.parse(readFileSync(new URL('../data/curation.json', import.meta.url), 'utf8'))
const exclusions = readFileSync(new URL('../data/exclusions.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

test('data pack is internally consistent', () => {
  assert.ok(data.sites.length > 0)
  assert.ok(exclusions.length > 0)
  assert.equal(source.exportedSites, data.sites.length)
  assert.equal(source.excluded, exclusions.length)
  assert.equal(source.nsfw, data.sites.filter((site) => site.nsfw).length)
  assert.equal(source.effectiveDefault, data.sites.filter((site) => !site.excluded && !site.nsfw).length)
  assert.equal(source.core, data.sites.filter((site) => site.tier === 'core').length)
  assert.ok(source.rawSites >= source.exportedSites)
})

test('every exclusion exists and every site name is unique', () => {
  const names = new Set(data.sites.map((site) => site.name))
  assert.equal(names.size, data.sites.length)
  for (const name of exclusions) assert.ok(names.has(name), `missing exclusion target: ${name}`)
})

test('every regexCheck compiles, including the Python-only quantifier', () => {
  assert.equal(regexes.size, data.sites.filter((site) => site.regexCheck).length)
  assert.equal(normalizeRegex('^[\\w-]{,34}$'), '^[\\w-]{0,34}$')
  for (const site of data.sites) {
    if (!site.regexCheck) continue
    assert.doesNotThrow(() => new RegExp(site.regexCheck, 'u'), site.name)
  }
})

test('headers stay inside the allowlist and URLs stay http(s)', () => {
  for (const site of data.sites) {
    for (const key of Object.keys(site.headers)) {
      assert.match(key, /^(accept|accept-language|content-type|user-agent|referer|origin|sec-fetch-(mode|site|dest))$/i, `${site.name}: ${key}`)
    }
    for (const value of [site.url, site.urlMain, site.urlProbe].filter(Boolean)) {
      const parsed = new URL(value.replaceAll('{}', 'x'))
      assert.ok(parsed.protocol === 'https:' || parsed.protocol === 'http:', `${site.name}: ${value}`)
    }
  }
})

test('curation and SOURCE metadata agree with the site flags', () => {
  assert.equal(curation.core.length, data.sites.filter((site) => site.tier === 'core').length)
  assert.equal(curation.lowReliability.length, data.sites.filter((site) => site.reliability === 'low').length)
  assert.deepEqual(curation.core.slice().sort(), data.sites.filter((site) => site.tier === 'core').map((site) => site.name).sort())
  assert.deepEqual(curation.lowReliability.slice().sort(), data.sites.filter((site) => site.reliability === 'low').map((site) => site.name).sort())
  assert.match(source.upstreamCommit, /^[0-9a-f]{40}$/)
  assert.match(source.rawSha256, /^[0-9a-f]{64}$/)
})
