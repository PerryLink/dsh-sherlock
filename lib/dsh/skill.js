/**
 * Optional progressive-disclosure skill. The tools still work when a profile
 * does not compose `ctx.skills`; the child fiber waits for the service.
 * @module dsh-sherlock/dsh/skill
 */
import { readFileSync } from 'node:fs'

export const SKILL_NAME = 'sherlock-osint'
export const SKILL_PATH = new URL('../../skills/sherlock-osint/SKILL.md', import.meta.url)
export const CHRONO_SKILL_NAME = 'chrono-investigation'
export const CHRONO_SKILL_PATH = new URL('../../skills/chrono-investigation/SKILL.md', import.meta.url)

const DESCRIPTION = 'Use sherlock_check to find public accounts by username, interpret claimed vs blocked results, '
  + 'verify before attributing identity, and report findings with links and caveats.'
const CHRONO_DESCRIPTION = 'Reconstruct a temporal evidence timeline from public sources, separate date roles, '
  + 'surface conflicts and gaps, and produce a reviewable report without a true/false verdict.'

/**
 * @param {any} ctx
 */
export function registerSkill(ctx) {
  if (typeof ctx.inject !== 'function') return
  try {
    ctx.inject(['skills'], (child) => {
      try {
        if (!child?.skills || typeof child.skills.register !== 'function') return
        child.skills.register({
          name: SKILL_NAME,
          description: DESCRIPTION,
          content: stripFrontmatter(readFileSync(SKILL_PATH, 'utf8')),
          invocation: { modelInvocable: true, userInvocable: true },
        })
        child.skills.register({
          name: CHRONO_SKILL_NAME,
          description: CHRONO_DESCRIPTION,
          content: stripFrontmatter(readFileSync(CHRONO_SKILL_PATH, 'utf8')),
          invocation: { modelInvocable: true, userInvocable: true },
        })
      } catch (error) {
        ctx.logger?.warn?.(`dsh-sherlock: skill not registered: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  } catch (error) {
    ctx.logger?.warn?.(`dsh-sherlock: skills service unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end === -1) return text
  return text.slice(end + 4).replace(/^\s*\n/, '')
}
