/**
 * Generate a self-contained temporal evidence report. The report is derived only from stored
 * observations; it never adds facts and never issues a true/false verdict.
 * @module dsh-sherlock/temporal/report
 */
import { analyzeCase } from './analyze.js'
import { caseDir, listDateAssertions, listEvents, listSources, loadCase, nextId, reportDir, sha256, writeReportFile } from './store.js'

const RULE_VERSION = 'tem-5t/1'

/**
 * @param {string} root
 * @param {string} caseId
 * @param {{audience?:'editor'|'legal'|'policy'|'internal'}} [options]
 */
export async function generateReport(root, caseId, options = {}) {
  const record = await loadCase(root, caseId)
  const sources = await listSources(root, caseId)
  const events = await listEvents(root, caseId)
  const dates = await listDateAssertions(root, caseId)
  const analysis = await analyzeCase(root, caseId)
  const reportId = nextId('rep')
  const dir = await reportDir(root, caseId, reportId)
  const audience = options.audience ?? 'editor'
  const citationIndex = buildCitationIndex(dates, sources)
  const eventRows = analysis.timeline.map((entry, index) => {
    const eventDates = dates.filter((date) => date.eventId === entry.eventId)
    return {
      row: index + 1,
      ...entry,
      dates: eventDates,
      citations: eventDates.map((date) => citationIndex[date.assertionId]).filter(Boolean),
    }
  })
  const markdown = renderMarkdown(record, reportId, audience, sources, eventRows, analysis)
  const timelineCsv = renderTimelineCsv(eventRows)
  const sourcesCsv = renderSourcesCsv(sources)
  const files = []
  files.push(await writeReportFile(dir, 'report.md', markdown))
  files.push(await writeReportFile(dir, 'timeline.csv', timelineCsv))
  files.push(await writeReportFile(dir, 'sources.csv', sourcesCsv))
  const manifest = {
    schemaVersion: 1,
    caseId,
    reportId,
    audience,
    generatedAt: new Date().toISOString(),
    ruleVersion: RULE_VERSION,
    files: files.map((file) => ({ path: file.name, sha256: file.sha256, bytes: file.bytes })),
    sources: sources.map((source) => ({ sourceId: source.sourceId, snapshotId: source.snapshotId, url: source.finalUrl, sha256: source.sha256, fetchedAt: source.fetchedAt, access: source.access })),
    citationIndex,
    coverage: analysis.coverage,
    conflicts: analysis.conflicts,
    gaps: analysis.gaps,
    limitations: limitations(record, analysis),
    reproduction: { caseId, reportId, ruleVersion: RULE_VERSION, sourceCount: sources.length, eventCount: events.length },
    modelRuns: [],
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  files.push(await writeReportFile(dir, 'report.manifest.json', manifestText))
  return {
    reportId,
    caseId,
    dir: relativeReportDir(root, caseId, reportId),
    files: files.map((file) => ({ path: file.name, sha256: file.sha256, bytes: file.bytes })),
    summary: {
      sources: sources.length,
      events: events.length,
      dates: dates.length,
      conflicts: analysis.conflicts.length,
      gaps: analysis.gaps.length,
      audience,
    },
    warnings: limitations(record, analysis),
  }
}

/** @param {any[]} dates @param {any[]} sources */
function buildCitationIndex(dates, sources) {
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]))
  const index = {}
  dates.forEach((date, i) => {
    const source = sourceById.get(date.sourceId)
    index[date.assertionId] = {
      citationId: `C-${String(i + 1).padStart(4, '0')}`,
      snapshotId: source?.snapshotId ?? null,
      sourceId: date.sourceId,
      url: source?.finalUrl ?? null,
      role: date.role,
      raw: date.rawText,
      observedAt: source?.fetchedAt ?? null,
      quoteSha256: date.quoteSha256 ?? null,
    }
  })
  return index
}

/** @param {any} record @param {string} reportId @param {string} audience @param {any[]} sources @param {any[]} rows @param {any} analysis */
function renderMarkdown(record, reportId, audience, sources, rows, analysis) {
  const lines = []
  lines.push(`# 时间线报告：${record.title}`)
  lines.push('')
  lines.push(`- Case: \`${record.caseId}\``)
  lines.push(`- Report: \`${reportId}\``)
  lines.push(`- Audience: ${audience}`)
  lines.push(`- Generated: ${new Date().toISOString()}`)
  lines.push(`- Rule version: ${RULE_VERSION}`)
  lines.push('')
  lines.push('> 这是一份证据整理报告，不是真伪裁决、身份认定或法律意见。报告只说明在已收集来源范围内哪些时间/说法被支持、哪些冲突、哪些无法核实。')
  lines.push('')
  lines.push('## 1. 问题与范围')
  lines.push('')
  lines.push(record.question)
  lines.push('')
  lines.push(`- 时间范围：${record.scope?.from ?? '未指定'} → ${record.scope?.to ?? '未指定'}`)
  lines.push(`- 语言：${(record.scope?.languages ?? []).join(', ') || '未指定'}`)
  lines.push(`- 来源数：${sources.length}`)
  lines.push('')
  lines.push('## 2. 摘要')
  lines.push('')
  lines.push(`- 时间线条目：${rows.length}`)
  lines.push(`- 未解决冲突：${analysis.conflicts.length}`)
  lines.push(`- 缺口：${analysis.gaps.length}`)
  lines.push(`- 覆盖：${analysis.coverage.domains.length} 个独立域名`)
  lines.push('')
  if (!rows.length) {
    lines.push('**没有可报告的时间线条目。** 这不是“事件不存在”的证据；请查看缺口。')
    lines.push('')
  } else {
    lines.push('### 时间线')
    lines.push('')
    lines.push('| # | 时间（区间/精度/时区） | 事件 | 角色 | T-S-C-E | 状态 | 引用 |')
    lines.push('|---:|---|---|---|---|---|---|')
    for (const row of rows) {
      const time = row.time ? `${row.time.earliest} → ${row.time.latest} (${row.time.precision}, ${row.time.timeZone ?? 'tz unknown'})` : '无可用时间'
      const roles = [...new Set(row.dates.map((date) => date.role))].join(', ') || '—'
      const citations = row.citations.map((citation) => citation.citationId).join(', ') || '—'
      lines.push(`| ${row.row} | ${escapeCell(time)} | ${escapeCell(row.label)} | ${escapeCell(roles)} | ${row.evidence.T}/${row.evidence.S}/${row.evidence.C}/${row.evidence.E} ${row.evidence.band} | ${row.status} | ${citations} |`)
    }
    lines.push('')
  }
  lines.push('## 3. 日期冲突')
  lines.push('')
  if (!analysis.conflicts.length) {
    lines.push('未检测到日期冲突。')
  } else {
    lines.push('| ID | 类型 | 严重度 | 说明 | 解决需要 |')
    lines.push('|---|---|---|---|---|')
    for (const conflict of analysis.conflicts) {
      lines.push(`| ${conflict.conflictId} | ${conflict.type} | ${conflict.severity} | ${escapeCell(conflict.explanation)} | ${escapeCell(conflict.candidateResolutions.map((item) => item.note).join(' '))} |`)
    }
  }
  lines.push('')
  lines.push('## 4. 缺口与未核实项')
  lines.push('')
  if (!analysis.gaps.length) {
    lines.push('未记录缺口。注意：没有缺口不等于覆盖完整。')
  } else {
    lines.push('| ID | 类型 | 说明 | 为什么重要 |')
    lines.push('|---|---|---|---|')
    for (const gap of analysis.gaps) lines.push(`| ${gap.gapId} | ${gap.type} | ${escapeCell(gap.description)} | ${escapeCell(gap.whyItMatters)} |`)
  }
  lines.push('')
  lines.push('## 5. 来源卡')
  lines.push('')
  lines.push('| 来源 | 域名 | 类型 | URL | 抓取时间 | HTTP | SHA-256 | 访问 |')
  lines.push('|---|---|---|---|---|---:|---|---|')
  for (const source of sources) {
    lines.push(`| ${source.sourceId} | ${source.domain} | ${source.sourceClass} | ${source.finalUrl} | ${source.fetchedAt} | ${source.httpStatus} | ${source.sha256.slice(0, 16)}… | ${source.access} |`)
  }
  lines.push('')
  lines.push('## 6. 引用')
  lines.push('')
  if (!Object.keys(analysis).length) lines.push('—')
  for (const row of rows) {
    for (const citation of row.citations) {
      lines.push(`- \`${citation.citationId}\` — ${citation.url} — role=${citation.role} — raw=\`${citation.raw}\` — observed=${citation.observedAt}`)
    }
  }
  lines.push('')
  lines.push('## 7. 方法与限制')
  lines.push('')
  lines.push('- 五轴时间：event / publication / first-seen / observed / modified；不把抓取时间当发布时间。')
  lines.push('- 日期是区间 + 精度 + 时区，不是一个可以随意相加的精确点。')
  lines.push('- T-S-C-E 是证据向量，不是真伪概率；单一来源/转载不能成为高证据。')
  lines.push('- 覆盖声明：未检查 ≠ 已检查未发现 ≠ 无法访问 ≠ 证据不足。')
  lines.push('- 本报告不包含原始 HTML、完整正文、Cookie/Authorization 或身份结论。')
  lines.push('')
  lines.push('## 8. 什么会改变结论')
  lines.push('')
  const changes = new Set()
  for (const conflict of analysis.conflicts) for (const item of conflict.candidateResolutions) changes.add(item.note)
  for (const gap of analysis.gaps) changes.add(gap.whyItMatters)
  if (!changes.size) lines.push('没有记录具体的反证条件；这本身是一个限制。')
  else for (const item of changes) lines.push(`- ${item}`)
  lines.push('')
  lines.push('## 9. 覆盖声明')
  lines.push('')
  lines.push(`- 已收集来源：${analysis.coverage.sourceCount}；独立域名：${analysis.coverage.domains.length}`)
  lines.push(`- 观测窗口：${analysis.coverage.observedFrom ?? '—'} → ${analysis.coverage.observedTo ?? '—'}`)
  lines.push('- 未覆盖：登录墙、付费墙、已删除且无存档的内容、未被搜索索引的页面、未提供的平台。')
  lines.push('')
  return lines.join('\n')
}

/** @param {any[]} rows */
function renderTimelineCsv(rows) {
  const header = ['row_id', 'start', 'latest', 'precision', 'timezone', 'role', 'event', 'status', 'T', 'S', 'C', 'E', 'band', 'citation_ids', 'conflict_ids', 'notes']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([
      row.eventId,
      row.time?.earliest ?? '',
      row.time?.latest ?? '',
      row.time?.precision ?? '',
      row.time?.timeZone ?? '',
      [...new Set(row.dates.map((date) => date.role))].join(';'),
      row.label,
      row.status,
      row.evidence.T,
      row.evidence.S,
      row.evidence.C,
      row.evidence.E,
      row.evidence.band,
      row.citations.map((citation) => citation.citationId).join(';'),
      row.conflictIds.join(';'),
      row.time?.uncertain ? 'timezone/precision uncertain' : '',
    ].map(csv).join(','))
  }
  return `${lines.join('\n')}\n`
}

/** @param {any[]} sources */
function renderSourcesCsv(sources) {
  const header = ['source_id', 'publisher', 'domain', 'class', 'url', 'snapshot_id', 'fetched_at', 'http_status', 'sha256', 'access', 'title', 'date_candidates']
  const lines = [header.join(',')]
  for (const source of sources) {
    lines.push([
      source.sourceId,
      source.publisher,
      source.domain,
      source.sourceClass,
      source.finalUrl,
      source.snapshotId,
      source.fetchedAt,
      source.httpStatus,
      source.sha256,
      source.access,
      source.title ?? '',
      (source.timeCandidates ?? []).map((candidate) => `${candidate.field}:${candidate.raw}`).join(';'),
    ].map(csv).join(','))
  }
  return `${lines.join('\n')}\n`
}

/** @param {any} record @param {any} analysis */
function limitations(record, analysis) {
  const items = [
    'Public sources only; no login, paywall, CAPTCHA, or WAF bypass.',
    'A time value is an interval with a stated precision/timezone, not a truth claim.',
    'Absence of a source is not absence of the event; read the coverage statement.',
    'This report is not a legal opinion, not a notarized record, and not an identity finding.',
  ]
  if (record.policy?.noTruthVerdict) items.push('The workbench does not issue a true/false verdict.')
  if (analysis.coverage?.domains?.length < 2) items.push('Fewer than two independent domains: corroboration is weak by construction.')
  return items
}

/** @param {string} root @param {string} caseId @param {string} reportId */
function relativeReportDir(root, caseId, reportId) {
  return `cases/${caseId}/reports/${reportId}`
}

/** @param {unknown} value */
function csv(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** @param {string} value */
function escapeCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

// Re-export for the tools layer, which needs a hash without importing the store twice.
export { sha256, caseDir }
