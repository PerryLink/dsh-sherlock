/**
 * Deterministic query planning for a temporal case. The plan is a reviewable set of search
 * queries and time windows; it is not evidence and does not call a model.
 * @module dsh-sherlock/temporal/plan
 */
import { createHash } from 'node:crypto'

/**
 * @param {{subject:string,aliases?:string[],event?:string,from?:string|null,to?:string|null,languages?:string[],channels?:string[],maxQueries?:number}} input
 */
export function buildQueryPlan(input) {
  const subject = input.subject.trim()
  if (!subject) throw new Error('plan: subject is required')
  const aliases = unique([subject, ...(input.aliases ?? [])]).slice(0, 6)
  const event = input.event?.trim() || ''
  const languages = input.languages?.length ? input.languages : ['zh', 'en']
  const windows = timeWindows(input.from ?? null, input.to ?? null)
  const queries = []
  const add = (text, facet, channel = 'search', window = null) => {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized) return
    if (queries.some((query) => query.text === normalized)) return
    queries.push({ queryId: `q-${queries.length + 1}`, text: normalized, facet, channel, window })
  }
  for (const window of windows) {
    for (const alias of aliases) {
      add(`"${alias}"${event ? ` "${event}"` : ''}`, 'identity+event', 'search', window)
      if (event) add(`"${alias}" ${event} (公告 OR 声明 OR 通知 OR 发布)`, 'official', 'search', window)
      if (event) add(`"${alias}" ${event} (调查 OR 处罚 OR 裁定 OR 诉讼)`, 'legal', 'search', window)
    }
  }
  for (const language of languages) add(`"${subject}"${event ? ` "${event}"` : ''} lang:${language}`, 'language', 'search', windows[0])
  if (input.channels?.includes('gdelt')) add(`"${subject}"${event ? ` ${event}` : ''}`, 'gdelt', 'gdelt', windows[0])
  const max = input.maxQueries ?? 24
  const limited = queries.slice(0, max)
  const planId = `plan-${createHash('sha256').update(JSON.stringify({ subject, aliases, event, from: input.from ?? null, to: input.to ?? null, languages, limited })).digest('hex').slice(0, 12)}`
  return {
    schemaVersion: 1,
    planId,
    subject,
    aliases,
    event,
    period: { from: input.from ?? null, to: input.to ?? null },
    languages,
    facets: ['identity+event', 'official', 'legal', 'language', ...(input.channels?.includes('gdelt') ? ['gdelt'] : [])],
    queries: limited,
    truncated: queries.length > limited.length,
    note: 'Queries are a discovery aid. A query result is not evidence until a source is ingested and asserted.',
  }
}

/** @param {string[]} values */
function unique(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    out.push(text)
  }
  return out
}

/** @param {string|null} from @param {string|null} to */
function timeWindows(from, to) {
  if (!from || !to) return [{ from: from ?? null, to: to ?? null }]
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return [{ from, to }]
  const windows = []
  let cursor = new Date(start)
  while (cursor.getTime() < end && windows.length < 8) {
    const next = new Date(cursor)
    next.setUTCFullYear(next.getUTCFullYear() + 1)
    const windowTo = new Date(Math.min(next.getTime(), end))
    windows.push({ from: cursor.toISOString().slice(0, 10), to: windowTo.toISOString().slice(0, 10) })
    cursor = windowTo
  }
  return windows.length ? windows : [{ from, to }]
}
