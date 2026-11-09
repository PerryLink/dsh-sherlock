/**
 * Human `/chrono` command. It reads local cases and reports; it never sends a model message.
 * @module dsh-sherlock/dsh/command
 */
import { generateReport } from '../temporal/report.js'
import { listCases, loadCase } from '../temporal/store.js'

/**
 * @param {any} ctx
 * @param {import('../core/config.js').SherlockConfig} config
 */
export function registerCommand(ctx, config) {
  if (typeof ctx.inject !== 'function') return
  try {
    ctx.inject(['commands'], (child) => {
      if (!child?.commands || typeof child.commands.register !== 'function') return
      child.commands.register({
        name: 'chrono',
        description: 'Local temporal evidence cases: list, status, or report.',
        input: { hint: 'list | status <caseId> | report <caseId>' },
        handler: async (invocation) => {
          try {
            const raw = String(invocation?.rawInput ?? '').trim()
            const [action = 'help', caseId] = raw.split(/\s+/, 2)
            if (action === 'list') {
              const cases = await listCases(config.chronoRoot)
              return { kind: 'success', text: cases.length ? cases.map((row) => `${row.caseId} ${row.status} ${row.title}`).join('\n') : 'No local cases.' }
            }
            if (action === 'status') {
              if (!caseId) return { kind: 'error', text: 'usage: /chrono status <caseId>' }
              const record = await loadCase(config.chronoRoot, caseId)
              return { kind: 'success', text: `${record.caseId} ${record.status}\n${record.title}\n${record.question}` }
            }
            if (action === 'report') {
              if (!caseId) return { kind: 'error', text: 'usage: /chrono report <caseId>' }
              const report = await generateReport(config.chronoRoot, caseId, { audience: 'internal' })
              return { kind: 'success', text: `report ${report.reportId}\n${report.files.map((file) => `${file.path} ${file.sha256.slice(0, 12)}…`).join('\n')}` }
            }
            return { kind: 'success', text: 'usage: /chrono list | status <caseId> | report <caseId>' }
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
          }
        },
      })
    })
  } catch (error) {
    ctx.logger?.warn?.(`dsh-sherlock: commands service unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}
