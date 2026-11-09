/**
 * DSH plugin entry: load the pinned manifest, register the tools, and attach
 * the optional skill when the profile composes `ctx.skills`.
 * @module dsh-sherlock/dsh/plugin
 */
import { readFileSync } from 'node:fs'
import { resolveConfig } from '../core/config.js'
import { createEngine } from '../core/engine.js'
import { DEFAULT_MANIFEST, loadManifest } from '../core/manifest.js'
import { createTools } from './tools.js'
import { createTemporalTools } from './temporal-tools.js'
import { createSourceTools } from './source-tools.js'
import { registerCommand } from './command.js'
import { registerSkill } from './skill.js'

export const name = 'dsh-sherlock'
export const inject = ['tools']

const PACKAGE_JSON = new URL('../../package.json', import.meta.url)

/**
 * @param {any} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const manifestPath = resolved.manifestPath ? resolved.manifestPath : DEFAULT_MANIFEST
  const loaded = loadManifest(manifestPath)
  const engine = createEngine({ data: loaded.data, regexes: loaded.regexes, config: resolved })
  const version = readPackageVersion()
  for (const tool of createTools(engine, resolved, version)) ctx.tools.register(tool)
  for (const tool of createTemporalTools(resolved, version, ctx)) ctx.tools.register(tool)
  for (const tool of createSourceTools(resolved, ctx)) ctx.tools.register(tool)
  registerSkill(ctx)
  registerCommand(ctx, resolved)
}

/** @returns {string} */
function readPackageVersion() {
  try {
    const parsed = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// Keep the path importable for diagnostics/tests without exposing internals.
export { DEFAULT_MANIFEST }
