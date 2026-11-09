import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createEngine, checkUsername, listSites, assertPublicHttpUrl, STATUS } from '../lib/core/engine.js'
import { renderCheckResult } from '../lib/core/render.js'
import { apply } from '../lib/dsh/plugin.js'
import { startFixtureServer } from './fixture-server.js'

const server = await startFixtureServer()
test.after(async () => {
  await server.close()
})

function makeSite(overrides = {}) {
  return {
    name: 'Test',
    urlMain: `${server.base}/`,
    url: `${server.base}/status/user/{}`,
    urlProbe: null,
    detectors: ['status_code'],
    errorCodes: [],
    errorMessages: [],
    errorUrl: null,
    regexCheck: null,
    method: 'HEAD',
    headers: {},
    payload: null,
    nsfw: false,
    tags: [],
    tier: 'core',
    reliability: 'high',
    excluded: false,
    hostKey: '127.0.0.1',
    sampleUsername: 'alice',
    ...overrides,
  }
}

function engineFor(sites, config = {}) {
  return createEngine({
    data: {
      schemaVersion: 1,
      source: { project: 'fixture', upstreamCommit: 'f'.repeat(40), rawSha256: 'test-manifest', fetchedAt: '2026-11-08T00:00:00Z' },
      sites,
    },
    config: {
      allowPrivateHosts: true,
      perHostDelayMs: 0,
      timeoutMs: 1500,
      maxSites: 120,
      cacheTtlMs: 0,
      maxVerify: 10,
      ...config,
    },
  })
}

async function check(site, username = 'alice', options = {}, config = {}) {
  const engine = engineFor([site], config)
  const value = await checkUsername(engine, username, {
    scope: 'core',
    sites: [site.name],
    verify: false,
    ...options,
  })
  return value.results[0]
}

test('status_code: 200 is claimed and 404 is available', async () => {
  assert.equal((await check(makeSite())).status, STATUS.CLAIMED)
  assert.equal((await check(makeSite({ url: `${server.base}/status/available` }))).status, STATUS.AVAILABLE)
})

test('status_code: 403, 429 and 500 are not treated as available', async () => {
  const blocked = await check(makeSite({ url: `${server.base}/status/blocked` }))
  assert.equal(blocked.status, STATUS.BLOCKED)
  assert.equal(blocked.evidence.reason, 'http_403')
  const rate = await check(makeSite({ url: `${server.base}/status/rate` }))
  assert.equal(rate.status, STATUS.BLOCKED)
  const error = await check(makeSite({ url: `${server.base}/status/error` }))
  assert.equal(error.status, STATUS.UNKNOWN)
})

test('status_code: redirects are followed, and HEAD 405 falls back to GET', async () => {
  const redirected = await check(makeSite({ url: `${server.base}/status/redirect/{}` }))
  assert.equal(redirected.status, STATUS.CLAIMED)
  const fallback = await check(makeSite({ url: `${server.base}/status/head405/{}` }))
  assert.equal(fallback.status, STATUS.CLAIMED)
})

test('message: the presence of errorMsg means available, absence means claimed', async () => {
  const site = makeSite({
    url: `${server.base}/message/known/{}`,
    method: 'GET',
    detectors: ['message'],
    errorMessages: ['This account does not exist'],
  })
  assert.equal((await check(site, 'alice')).status, STATUS.CLAIMED)
  assert.equal((await check(site, 'bob')).status, STATUS.AVAILABLE)
})

test('message: a WAF fingerprint is blocked even on HTTP 200', async () => {
  const site = makeSite({
    url: `${server.base}/waf`,
    method: 'GET',
    detectors: ['message'],
    errorMessages: ['This account does not exist'],
  })
  assert.equal((await check(site)).status, STATUS.BLOCKED)
})

test('response_url: a redirect to errorUrl is available; a 200 is claimed', async () => {
  const site = makeSite({
    url: `${server.base}/response/known/{}`,
    method: 'GET',
    detectors: ['response_url'],
    errorUrl: `${server.base}/response/error`,
  })
  assert.equal((await check(site, 'alice')).status, STATUS.CLAIMED)
  assert.equal((await check(site, 'bob')).status, STATUS.AVAILABLE)
})

test('regexCheck: a non-matching username is illegal and makes no request', async () => {
  const site = makeSite({ regexCheck: '^[a-z]+$' })
  const result = await check(site, 'ALICE')
  assert.equal(result.status, STATUS.ILLEGAL)
  assert.equal(result.httpStatus, null)
})

test('negative control: a soft-404 site is downgraded to unreliable', async () => {
  const site = makeSite({
    url: `${server.base}/message/always`,
    method: 'GET',
    detectors: ['message'],
    errorMessages: ['This account does not exist'],
  })
  const engine = engineFor([site])
  const value = await checkUsername(engine, 'alice', { scope: 'core', sites: [site.name], verify: true })
  assert.equal(value.results[0].status, STATUS.UNRELIABLE)
  assert.equal(value.results[0].evidence.control.reason, 'control_username_also_claimed')
})

test('negative control: a real claim gets high confidence when the control is available', async () => {
  const site = makeSite({
    url: `${server.base}/message/known/{}`,
    method: 'GET',
    detectors: ['message'],
    errorMessages: ['This account does not exist'],
  })
  const engine = engineFor([site])
  const value = await checkUsername(engine, 'alice', { scope: 'core', sites: [site.name], verify: true })
  assert.equal(value.results[0].status, STATUS.CLAIMED)
  assert.equal(value.results[0].confidence, 'high')
  assert.equal(value.results[0].evidence.control.status, STATUS.AVAILABLE)
})

test('POST payload and custom headers reach the site', async () => {
  const post = makeSite({
    url: `${server.base}/post`,
    method: 'POST',
    payload: { username: '{}' },
  })
  assert.equal((await check(post, 'alice')).status, STATUS.CLAIMED)
  assert.equal((await check(post, 'bob')).status, STATUS.AVAILABLE)

  const headers = makeSite({
    name: 'Headers',
    url: `${server.base}/headers/{}`,
    headers: { 'accept-language': 'en-US,en;q=0.9' },
  })
  assert.equal((await check(headers)).status, STATUS.CLAIMED)
})

test('timeout is unknown, not available', async () => {
  const site = makeSite({ url: `${server.base}/slow`, method: 'GET' })
  const result = await check(site, 'alice', {}, { timeoutMs: 500 })
  assert.equal(result.status, STATUS.UNKNOWN)
  assert.equal(result.evidence.reason, 'timeout')
})

test('response body is capped before message matching', async () => {
  const site = makeSite({
    url: `${server.base}/big`,
    method: 'GET',
    detectors: ['message'],
    errorMessages: ['This account does not exist'],
  })
  const result = await check(site, 'alice', {}, { maxResponseBytes: 1024 })
  assert.equal(result.status, STATUS.CLAIMED)
})

test('exclusions and NSFW filtering happen before probing', async () => {
  const excluded = makeSite({ name: 'Excluded', excluded: true })
  const nsfw = makeSite({ name: 'NSFW', nsfw: true })
  const ok = makeSite({ name: 'OK' })
  const engine = engineFor([excluded, nsfw, ok])
  const value = await checkUsername(engine, 'alice', { scope: 'core', verify: false })
  assert.deepEqual(value.results.map((result) => result.siteName), ['OK'])
})

test('listSites reports core/all counts and filters by query', () => {
  const core = makeSite({ name: 'CoreSite' })
  const all = makeSite({ name: 'AllSite', tier: 'extended' })
  const nsfw = makeSite({ name: 'NsfwSite', tier: 'extended', nsfw: true })
  const engine = engineFor([core, all, nsfw])
  assert.equal(listSites(engine, { scope: 'core' }).count, 1)
  assert.equal(listSites(engine, { scope: 'all' }).count, 2)
  assert.equal(listSites(engine, { scope: 'all', query: 'allsite' }).count, 1)
  assert.equal(listSites(engine, { scope: 'all', includeNsfw: true }).count, 3)
})

test('renderer shows claimed URLs, review reasons, and the identity caveat', async () => {
  const site = makeSite()
  const engine = engineFor([site])
  const value = await checkUsername(engine, 'alice', { scope: 'core', sites: [site.name], verify: false })
  const text = renderCheckResult({ include_available: true }, value)
  assert.match(text, /Sherlock: `alice`/)
  assert.match(text, /Claimed/)
  assert.match(text, /Test/)
  assert.match(text, /not proof that the accounts belong to the same person/)
})

test('cache keys separate verify on/off so a soft-404 is not reused as claimed', async () => {
  const site = makeSite({
    url: `${server.base}/message/always`,
    method: 'GET',
    detectors: ['message'],
    errorMessages: ['This account does not exist'],
  })
  const engine = engineFor([site], { cacheTtlMs: 60_000 })
  const first = await checkUsername(engine, 'alice', { scope: 'core', sites: [site.name], verify: false })
  assert.equal(first.results[0].status, STATUS.CLAIMED)
  const second = await checkUsername(engine, 'alice', { scope: 'core', sites: [site.name], verify: true })
  assert.equal(second.results[0].status, STATUS.UNRELIABLE)
})


test('production mode rejects private and metadata hosts before fetching', async () => {
  const site = makeSite({ url: `${server.base}/status/claimed` })
  const result = await check(site, 'alice', {}, { allowPrivateHosts: false })
  assert.equal(result.status, STATUS.UNKNOWN)
  assert.equal(result.evidence.reason, 'config_error')
  assert.match(result.evidence.message, /private host/i)
  for (const url of ['http://10.0.0.1/x', 'http://127.0.0.1/x', 'http://169.254.169.254/latest', 'http://100.64.0.1/x', 'http://[::1]/x']) {
    assert.throws(() => assertPublicHttpUrl(url), /private host/i, url)
  }
})

test('unsafe site headers are dropped at runtime', async () => {
  const site = makeSite({
    url: `${server.base}/headers/secure/{}`,
    headers: { cookie: 'secret', authorization: 'Bearer secret', 'accept-language': 'en-US' },
  })
  assert.equal((await check(site)).status, STATUS.CLAIMED)
})

test('external abort cancels an in-flight check instead of returning a result', async () => {
  const site = makeSite({ url: `${server.base}/slow`, method: 'GET' })
  const engine = engineFor([site], { timeoutMs: 5000 })
  const controller = new AbortController()
  const pending = checkUsername(engine, 'alice', { scope: 'core', sites: [site.name], verify: false, signal: controller.signal })
  setTimeout(() => controller.abort(new Error('client abort')), 50)
  await assert.rejects(pending, /client abort|aborted/i)
})

test('array errorType combines message and status_code outcomes', async () => {
  const site = makeSite({
    url: `${server.base}/message/known/{}`,
    method: 'GET',
    detectors: ['message', 'status_code'],
    errorMessages: ['This account does not exist'],
  })
  assert.equal((await check(site, 'alice')).status, STATUS.CLAIMED)
  assert.equal((await check(site, 'bob')).status, STATUS.AVAILABLE)
})

test('plugin registers two tools and an optional skill, and returns a JSON-safe value', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-plugin-'))
  const manifestPath = path.join(dir, 'sites.json')
  const site = makeSite()
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, source: { project: 'fixture' }, sites: [site] }))

  const tools = new Map()
  const skills = []
  const ctx = {
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
    inject(_deps, callback) {
      callback({ skills: { register(value) { skills.push(value); return () => {} } } })
      return {}
    },
    logger: { warn() {} },
  }
  apply(ctx, { manifestPath, allowPrivateHosts: true, perHostDelayMs: 0, cacheTtlMs: 0 })

  assert.deepEqual([...tools.keys()].sort(), ['chrono_analyze', 'chrono_archive', 'chrono_assert', 'chrono_case', 'chrono_claim', 'chrono_collect', 'chrono_diff', 'chrono_feed', 'chrono_gdelt', 'chrono_ingest', 'chrono_report', 'chrono_review', 'chrono_search', 'chrono_verify', 'chrono_watch', 'sherlock_check', 'sherlock_sites'])
  assert.deepEqual(skills.map((entry) => entry.name).sort(), ['chrono-investigation', 'sherlock-osint'])
  const sherlockSkill = skills.find((entry) => entry.name === 'sherlock-osint')
  assert.match(sherlockSkill.content, /Sherlock OSINT workflow/)

  const exec = { signal: new AbortController().signal }
  const value = await tools.get('sherlock_check').execute({ username: 'alice', scope: 'core', verify: false }, exec)
  assert.equal(value.claimed.length, 1)
  assert.equal(value.claimed[0].siteName, 'Test')
  assert.equal(value.available, undefined)
  assert.doesNotThrow(() => JSON.stringify(value))
  if (process.env.DSH_TOOLS_PATH) {
    const mod = await import(process.env.DSH_TOOLS_PATH)
    assert.deepEqual(mod.validateJsonSchemaValue(tools.get('sherlock_check').output.schema, value, ''), [])
  }

  const withAvailable = await tools.get('sherlock_check').execute({ username: 'alice', scope: 'core', verify: false, include_available: true }, exec)
  assert.ok(Array.isArray(withAvailable.available))
  if (process.env.DSH_TOOLS_PATH) {
    const mod = await import(process.env.DSH_TOOLS_PATH)
    assert.deepEqual(mod.validateJsonSchemaValue(tools.get('sherlock_check').output.schema, withAvailable, ''), [])
  }

  const rendered = tools.get('sherlock_check').output.render({ username: 'alice' }, value)
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /Claimed/)

  const catalog = await tools.get('sherlock_sites').execute({ query: 'test', scope: 'core' }, exec)
  assert.equal(catalog.count, 1)
  assert.equal(catalog.sites[0].name, 'Test')

  for (const definition of tools.values()) assertSupportedSchema(definition.parameters)
  for (const definition of tools.values()) assertSupportedSchema(definition.output.schema)
})

function assertSupportedSchema(schema) {
  const allowed = new Set([
    'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items',
    'enum', 'const', 'description', 'title', 'default', 'examples',
  ])
  const stack = [schema]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    for (const key of Object.keys(node)) {
      assert.ok(allowed.has(key), `unsupported JSON Schema keyword: ${key}`)
    }
    if (node.properties) {
      for (const child of Object.values(node.properties)) stack.push(child)
    }
    if (node.items) stack.push(node.items)
    if (node.oneOf) stack.push(...node.oneOf)
  }
}
