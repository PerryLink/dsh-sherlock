#!/usr/bin/env node
/**
 * Maintainer sync: fetch a pinned Sherlock manifest, normalize it, and write
 * the data pack. Review the diff before committing; never run this at model
 * call time.
 *
 *   node scripts/sync-sherlock.mjs --ref <40-hex-sha>
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeRegex } from '../lib/core/manifest.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const ref = option('--ref')
if (!/^[0-9a-f]{40}$/i.test(ref ?? '')) throw new Error('usage: node scripts/sync-sherlock.mjs --ref <40-hex-sha> [--data-url URL] [--exclusions-url URL] [--out-dir DIR]')

const BASE = 'https://raw.githubusercontent.com/sherlock-project/sherlock'
const dataUrl = option('--data-url', `${BASE}/${ref}/sherlock_project/resources/data.json`)
const exclusionsUrl = option('--exclusions-url', `${BASE}/refs/heads/exclusions/false_positive_exclusions.txt`)
const outDir = option('--out-dir', 'data')
await mkdir(outDir, { recursive: true })
const ALLOWED_HEADERS = /^(accept|accept-language|content-type|user-agent|referer|origin|sec-fetch-(mode|site|dest))$/i
const LOW_DEFAULT = new Set(['Instagram', 'Facebook', 'Twitter', 'TikTok', 'LinkedIn', 'Threads', 'Discord', 'Reddit', 'YouTube', 'Twitch', 'Medium', 'Dribbble'])

const [rawText, exclusionsText] = await Promise.all([fetchText(dataUrl), fetchText(exclusionsUrl)])
const raw = JSON.parse(rawText)
delete raw.$schema
const exclusions = exclusionsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
const exclusionSet = new Set(exclusions.map((name) => name.toLowerCase()))

const oldCuration = await readOptionalJson(join(outDir, 'curation.json'))
const oldData = await readOptionalJson(join(outDir, 'sites.json'))
const coreSet = new Set((oldCuration?.core ?? []).map((name) => name.toLowerCase()))
const lowList = Array.isArray(oldCuration?.lowReliability) ? oldCuration.lowReliability : [...LOW_DEFAULT]
const lowSet = new Set(lowList.map((name) => name.toLowerCase()))

const sites = []
for (const [name, site] of Object.entries(raw)) {
  const detectors = asArray(site.errorType)
  if (detectors.length === 0) continue
  const url = site.url
  const urlMain = site.urlMain
  const urlProbe = site.urlProbe ?? null
  assertUrl(name, url, 'url')
  assertUrl(name, urlMain, 'urlMain')
  if (urlProbe) assertUrl(name, urlProbe, 'urlProbe')
  const headers = {}
  for (const [key, value] of Object.entries(site.headers ?? {})) {
    if (ALLOWED_HEADERS.test(key) && typeof value === 'string') headers[key.toLowerCase()] = value
  }
  const errorCodes = asArray(site.errorCode).filter((value) => Number.isInteger(value))
  const errorMessages = asArray(site.errorMsg).filter((value) => typeof value === 'string' && value.length > 0)
  const method = site.request_method ?? (detectors.length === 1 && detectors[0] === 'status_code' ? 'HEAD' : 'GET')
  const hasNonUserAgentHeader = Object.keys(headers).length > 0
    && !Object.keys(site.headers ?? {}).some((key) => key.toLowerCase() === 'user-agent')
  const reliability = lowSet.has(name.toLowerCase()) || site.isNSFW ? 'low'
    : (site.urlProbe || detectors.includes('message') || detectors.includes('response_url')
      || (site.request_method !== undefined && site.request_method !== 'GET') || hasNonUserAgentHeader) ? 'medium'
      : 'high'
  sites.push({
    name,
    urlMain,
    url,
    urlProbe,
    detectors,
    errorCodes,
    errorMessages,
    errorUrl: site.errorUrl ?? null,
    regexCheck: site.regexCheck ? normalizeRegex(site.regexCheck) : null,
    method,
    headers,
    payload: site.request_payload ?? null,
    nsfw: site.isNSFW === true,
    tags: asArray(site.tags),
    tier: coreSet.has(name.toLowerCase()) ? 'core' : 'extended',
    reliability,
    excluded: exclusionSet.has(name.toLowerCase()),
    hostKey: hostKey(urlProbe, url, urlMain),
    sampleUsername: site.username_claimed ?? null,
  })
}

for (const site of sites) {
  if (site.regexCheck) {
    try { new RegExp(site.regexCheck, 'u') } catch (error) { throw new Error(`${site.name}: regexCheck does not compile: ${error.message}`) }
  }
}

const effectiveDefault = sites.filter((site) => !site.excluded && !site.nsfw).length
const source = {
  project: 'sherlock-project/sherlock',
  upstreamCommit: ref,
  fetchedAt: new Date().toISOString(),
  rawSha256: createHash('sha256').update(rawText).digest('hex'),
  rawSites: Object.keys(raw).length,
  exportedSites: sites.length,
  excluded: exclusions.length,
  nsfw: sites.filter((site) => site.nsfw).length,
  core: sites.filter((site) => site.tier === 'core').length,
  effectiveDefault,
  license: 'MIT',
  licenseFile: 'data/SHERLOCK-LICENSE',
}
if (oldData?.source?.rawSha256 === source.rawSha256
  && oldData?.source?.upstreamCommit === source.upstreamCommit
  && typeof oldData?.source?.fetchedAt === 'string') {
  source.fetchedAt = oldData.source.fetchedAt
}

const curation = {
  schemaVersion: 1,
  lastReviewed: new Date().toISOString().slice(0, 10),
  core: sites.filter((site) => site.tier === 'core').map((site) => site.name).sort(),
  lowReliability: sites.filter((site) => site.reliability === 'low').map((site) => site.name).sort(),
  notes: oldCuration?.notes ?? {},
}

await writeFile(join(outDir, 'sites.json'), `${JSON.stringify({ schemaVersion: 1, source, sites }, null, 2)}\n`)
await writeFile(join(outDir, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`)
await writeFile(join(outDir, 'exclusions.txt'), `${exclusions.join('\n')}\n`)
await writeFile(join(outDir, 'curation.json'), `${JSON.stringify(curation, null, 2)}\n`)
console.log(`synced ${sites.length} sites (core ${source.core}, effective ${effectiveDefault}) from ${ref}`)

function asArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function assertUrl(name, value, kind) {
  if (typeof value !== 'string') throw new Error(`${name}: missing ${kind}`)
  const url = new URL(value.replaceAll('{}', 'x'))
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name}: ${kind} is not http(s)`)
  if (url.username || url.password) throw new Error(`${name}: ${kind} contains credentials`)
}

function hostKey(urlProbe, url, urlMain) {
  try {
    const parsed = new URL((urlProbe ?? url ?? urlMain).replaceAll('{}', 'x'))
    if (parsed.hostname.startsWith('x.') && urlMain) return new URL(urlMain).hostname.toLowerCase()
    return parsed.hostname.toLowerCase()
  } catch {
    return 'invalid.invalid'
  }
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'dsh-sherlock-sync/0.1' } })
  if (!response.ok) throw new Error(`fetch ${url} failed: HTTP ${response.status}`)
  return await response.text()
}

async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}
