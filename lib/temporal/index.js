/**
 * Local cross-case index. It is derived from case files; it is not a hosted database.
 * @module dsh-sherlock/temporal/index
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { caseDir, listDateAssertions, listQueries, listReports, listSources, loadCase } from './store.js'

/** @param {string} root */
export async function buildCaseIndex(root) {
  const base = join(root, 'cases')
  const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
  const cases = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const record = await loadCase(root, entry.name)
      const [sources, dates, reports, queries] = await Promise.all([
        listSources(root, entry.name), listDateAssertions(root, entry.name),
        listReports(root, entry.name), listQueries(root, entry.name),
      ])
      cases.push({
        caseId: record.caseId,
        title: record.title,
        question: record.question,
        subjectType: record.subject?.type ?? null,
        status: record.status,
        sourceCount: sources.length,
        dateCount: dates.length,
        queryCount: queries.length,
        reportCount: reports.length,
        lastReportAt: reports[0]?.generatedAt ?? null,
        updatedAt: record.updatedAt ?? null,
      })
    } catch {
      // A partially written case is skipped, never silently counted.
    }
  }
  return cases.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
}

/** @param {string} root @param {string} query */
export async function searchCaseIndex(root, query) {
  const needle = query.trim().toLowerCase()
  const cases = await buildCaseIndex(root)
  if (!needle) return cases
  return cases.filter((row) => `${row.caseId} ${row.title} ${row.question} ${row.subjectType}`.toLowerCase().includes(needle))
}

export { caseDir }
