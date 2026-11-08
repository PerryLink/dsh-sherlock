import test from 'node:test'
import assert from 'node:assert/strict'
import { loadManifest } from '../lib/core/manifest.js'
import { createEngine } from '../lib/core/engine.js'
import { resolveConfig } from '../lib/core/config.js'
import { createTools, STATUS_VALUES } from '../lib/dsh/tools.js'

const { data, regexes } = loadManifest()
const config = resolveConfig()
const engine = createEngine({ data, regexes, config })
const tools = createTools(engine, config, '0.1.0')
const check = tools.find((tool) => tool.name === 'sherlock_check')
const sites = tools.find((tool) => tool.name === 'sherlock_sites')

test('both tools expose exact DSH-subset schemas', () => {
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(tool.output.schema.additionalProperties, false)
    assert.equal(typeof tool.output.render, 'function')
    assert.ok(tool.timeoutMs > 0)
    assertSupportedSchema(tool.parameters)
    assertSupportedSchema(tool.output.schema)
  }
  assert.equal(check.output.schema.properties.results.items.properties.status.enum.length, 6)
  assert.deepEqual(check.output.schema.properties.results.items.properties.status.enum, STATUS_VALUES)
  assert.ok(check.output.schema.required.includes('toolVersion'))
  assert.ok(check.parameters.properties.max_sites)
})

test('sherlock_sites lists core and all sets without network', async () => {
  const coreTotal = data.sites.filter((site) => site.tier === 'core' && !site.excluded && !site.nsfw).length
  const allTotal = data.sites.filter((site) => !site.excluded && !site.nsfw).length
  const core = await sites.execute({ scope: 'core' })
  assert.equal(core.total, coreTotal)
  assert.equal(core.count, coreTotal)
  assert.equal(core.truncated, false)
  assert.ok(core.sites.some((site) => site.name === 'GitHub'))

  const all = await sites.execute({ scope: 'all' })
  assert.equal(all.total, allTotal)
  assert.equal(all.count, Math.min(50, allTotal))
  assert.equal(all.truncated, allTotal > 50)

  if (process.env.DSH_TOOLS_PATH) {
    const mod = await import(process.env.DSH_TOOLS_PATH)
    assert.deepEqual(mod.validateJsonSchemaValue(sites.output.schema, core, ''), [])
  }
})

test('sherlock_sites filters by query and limit', async () => {
  const filtered = await sites.execute({ query: 'git', limit: 3 })
  assert.equal(filtered.count, 3)
  assert.ok(filtered.sites.every((site) => `${site.name} ${site.urlMain}`.toLowerCase().includes('git')))
})

test('sherlock_check rejects invalid arguments before any request', async () => {
  await assert.rejects(() => check.execute({}, { signal: new AbortController().signal }), /username must be a string/)
  await assert.rejects(
    () => check.execute({ username: 'alice', max_sites: 121 }, { signal: new AbortController().signal }),
    /max_sites/,
  )
  await assert.rejects(
    () => check.execute({ username: 'alice', sites: ['x'], include_nsfw: 'yes' }, { signal: new AbortController().signal }),
    /include_nsfw/,
  )
})

test('real DSH schema validator accepts both tools when available', { skip: !process.env.DSH_TOOLS_PATH }, async () => {
  const mod = await import(process.env.DSH_TOOLS_PATH)
  for (const tool of tools) {
    mod.assertSupportedJsonSchema(tool.parameters)
    mod.assertSupportedJsonSchema(tool.output.schema)
  }
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
    for (const key of Object.keys(node)) assert.ok(allowed.has(key), `unsupported JSON Schema keyword: ${key}`)
    if (node.required) {
      assert.ok(Array.isArray(node.required))
      for (const key of node.required) assert.ok(Object.hasOwn(node.properties ?? {}, key), `required key not declared: ${key}`)
    }
    if (node.properties) for (const child of Object.values(node.properties)) stack.push(child)
    if (node.items) stack.push(node.items)
    if (node.oneOf) {
      assert.ok(Array.isArray(node.oneOf) && node.oneOf.length >= 2)
      stack.push(...node.oneOf)
    }
  }
}
