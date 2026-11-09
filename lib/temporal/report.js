/**
 * Generate a self-contained temporal evidence report. The report is derived only from stored
 * observations; it never adds facts and never issues a true/false verdict.
 * @module dsh-sherlock/temporal/report
 */
import { analyzeCase } from './analyze.js'
import { assertLint, lintCaseFields } from './lint.js'
import { caseDir, listArchives, listClaims, listDateAssertions, listEvents, listReviews, listSources, loadCase, nextId, reportDir, sha256, writeReportFile } from './store.js'

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
  const claims = await listClaims(root, caseId)
  const archives = await listArchives(root, caseId)
  const reviews = await listReviews(root, caseId)
  const analysis = await analyzeCase(root, caseId)
  const lint = lintCaseFields({
    eventLabels: events.map((event) => event.label),
    claimTexts: claims.map((claim) => claim.text),
    sourceTitles: sources.map((source) => source.title),
    reviewNotes: reviews.map((review) => review.note),
  })
  assertLint(lint)
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
  const html = renderHtml(record, reportId, audience, sources, eventRows, analysis)
  const timelineCsv = renderTimelineCsv(eventRows)
  const sourcesCsv = renderSourcesCsv(sources)
  const files = []
  files.push(await writeReportFile(dir, 'report.html', html))
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
    state: {
      sources: sources.map((source) => ({ sourceId: source.sourceId, url: source.finalUrl, sha256: source.sha256, access: source.access, fetchedAt: source.fetchedAt })),
      dates: dates.map((date) => ({ assertionId: date.assertionId, eventId: date.eventId, sourceId: date.sourceId, rawText: date.rawText, role: date.role, parsed: date.parsed, teg: date.teg ?? 'T4' })),
      events: events.map((event) => ({ eventId: event.eventId, label: event.label, category: event.category })),
      claims: claims.map((claim) => ({ claimId: claim.claimId, text: claim.text, status: claim.status })),
      archives: archives.map((archive) => ({ archiveId: archive.archiveId, url: archive.url, captures: archive.captures })),
      reviews: reviews.map((review) => ({ reviewId: review.reviewId, conflictId: review.conflictId, resolution: review.resolution })),
    },
    conflicts: analysis.conflicts,
    gaps: analysis.gaps,
    limitations: [...limitations(record, analysis), ...(lint.pii.length ? [`Possible PII in labels: ${lint.pii.map((item) => `${item.kind}@${item.where}`).join(', ')}`] : [])],
    lint: { verdictViolations: lint.violations, pii: lint.pii },
    reproduction: { caseId, reportId, ruleVersion: RULE_VERSION, sourceCount: sources.length, eventCount: events.length },
    modelRuns: [],
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  files.push(await writeReportFile(dir, 'report.manifest.json', manifestText))
  const fileList = files.map((file) => ({ path: file.name, sha256: file.sha256, bytes: file.bytes }))
  const presentNames = new Set(['report.html', 'report.md', 'timeline.csv', 'report.manifest.json'])
  return {
    reportId,
    caseId,
    dir: relativeReportDir(root, caseId, reportId),
    files: fileList,
    presentFiles: fileList.filter((file) => presentNames.has(file.path)),
    summary: {
      sources: sources.length,
      events: events.length,
      dates: dates.length,
      conflicts: analysis.conflicts.length,
      gaps: analysis.gaps.length,
      audience,
    },
    warnings: [...limitations(record, analysis), ...(lint.pii.length ? [`Possible PII in labels: ${lint.pii.map((item) => `${item.kind}@${item.where}`).join(', ')}`] : [])],
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
    lines.push('| # | 时间（区间/精度/时区/TEG） | 事件 | 角色 | T-S-C-E | 状态 | 引用 |')
    lines.push('|---:|---|---|---|---|---|---|')
    for (const row of rows) {
      const time = row.time ? `${row.time.earliest} → ${row.time.latest} (${row.time.precision}, ${row.time.timeZone ?? 'tz unknown'}, ${row.dates.map((date) => date.teg ?? 'T4').join('/') || 'T4'})` : '无可用时间'
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
  lines.push('## 5. 查询日志')
  lines.push('')
  const queries = analysis.coverage.queries ?? []
  if (!queries.length) lines.push('尚无查询记录。')
  else {
    lines.push('| ID | 通道 | 查询 | 命中 | 错误 | 执行时间 |')
    lines.push('|---|---|---|---:|---|---|')
    for (const query of queries) lines.push(`| ${query.queryId} | ${query.channel} | ${escapeCell(query.query)} | ${query.resultCount} | ${escapeCell(query.error ?? '')} | ${query.executedAt} |`)
  }
  lines.push('')
  lines.push('## 6. 来源卡')
  lines.push('')
  lines.push('| 来源 | 域名 | 类型 | URL | 抓取时间 | HTTP | SHA-256 | 访问 |')
  lines.push('|---|---|---|---|---|---:|---|---|')
  for (const source of sources) {
    lines.push(`| ${source.sourceId} | ${source.domain} | ${source.sourceClass} | ${source.finalUrl} | ${source.fetchedAt} | ${source.httpStatus} | ${source.sha256.slice(0, 16)}… | ${source.access} |`)
  }
  lines.push('')
  lines.push('## 7. 引用')
  lines.push('')
  if (!Object.keys(analysis).length) lines.push('—')
  for (const row of rows) {
    for (const citation of row.citations) {
      lines.push(`- \`${citation.citationId}\` — ${citation.url} — role=${citation.role} — raw=\`${citation.raw}\` — observed=${citation.observedAt}`)
    }
  }
  lines.push('')
  lines.push('## 8. 方法与限制')
  lines.push('')
  lines.push('- 五轴时间：event / publication / first-seen / observed / modified；不把抓取时间当发布时间。')
  lines.push('- 日期是区间 + 精度 + 时区，不是一个可以随意相加的精确点。')
  lines.push('- T-S-C-E 是证据向量，不是真伪概率；单一来源/转载不能成为高证据。')
  lines.push('- 覆盖声明：未检查 ≠ 已检查未发现 ≠ 无法访问 ≠ 证据不足。')
  lines.push('- 本报告不包含原始 HTML、完整正文、Cookie/Authorization 或身份结论。')
  lines.push('')
  lines.push('## 9. 什么会改变结论')
  lines.push('')
  const changes = new Set()
  for (const conflict of analysis.conflicts) for (const item of conflict.candidateResolutions) changes.add(item.note)
  for (const gap of analysis.gaps) changes.add(gap.whyItMatters)
  if (!changes.size) lines.push('没有记录具体的反证条件；这本身是一个限制。')
  else for (const item of changes) lines.push(`- ${item}`)
  lines.push('')
  lines.push('## 10. 覆盖声明')
  lines.push('')
  lines.push(`- 已收集来源：${analysis.coverage.sourceCount}；独立域名：${analysis.coverage.domains.length}`)
  lines.push(`- 观测窗口：${analysis.coverage.observedFrom ?? '—'} → ${analysis.coverage.observedTo ?? '—'}`)
  lines.push('- 未覆盖：登录墙、付费墙、已删除且无存档的内容、未被搜索索引的页面、未提供的平台。')
  lines.push('')
  return lines.join('\n')
}

/** @param {any} record @param {string} reportId @param {string} audience @param {any[]} sources @param {any[]} rows @param {any} analysis */
function renderHtml(record, reportId, audience, sources, rows, analysis) {
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const timelineRows = rows.map((row) => `<tr><td>${row.row}</td><td><code>${esc(row.time?.earliest ?? 'unknown')}</code><br><small>${esc(row.time?.latest ?? '')} · ${esc(row.time?.precision ?? '')} · ${esc(row.time?.timeZone ?? 'tz unknown')}</small></td><td>${esc(row.label)}</td><td>${esc([...new Set(row.dates.map((date) => date.role))].join(', '))}</td><td><span class="vec">${row.evidence.T}/${row.evidence.S}/${row.evidence.C}/${row.evidence.E}</span> <span class="band ${esc(row.evidence.band)}">${esc(row.evidence.band)}</span></td><td>${esc(row.status)}</td><td>${esc(row.citations.map((citation) => citation.citationId).join(', '))}</td></tr>`).join('')
  const conflictRows = analysis.conflicts.map((conflict) => `<tr><td><code>${esc(conflict.conflictId)}</code></td><td>${esc(conflict.type)}</td><td><span class="sev ${esc(conflict.severity)}">${esc(conflict.severity)}</span></td><td>${esc(conflict.explanation)}</td></tr>`).join('')
  const gapRows = analysis.gaps.map((gap) => `<tr><td><code>${esc(gap.gapId)}</code></td><td>${esc(gap.type)}</td><td>${esc(gap.description)}</td><td>${esc(gap.whyItMatters)}</td></tr>`).join('')
  const queryRows = (analysis.coverage.queries ?? []).map((query) => `<tr><td><code>${esc(query.queryId)}</code></td><td>${esc(query.channel)}</td><td>${esc(query.query)}</td><td>${esc(query.resultCount)}</td><td>${esc(query.error ?? '')}</td><td><code>${esc(query.executedAt)}</code></td></tr>`).join('')
  const sourceRows = sources.map((source) => `<tr><td><code>${esc(source.sourceId)}</code></td><td>${esc(source.publisher)}</td><td>${esc(source.sourceClass)}</td><td><a href="${esc(source.finalUrl)}">${esc(source.title ?? source.finalUrl)}</a></td><td><code>${esc(source.fetchedAt)}</code></td><td>${esc(source.access)}</td></tr>`).join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(record.title)} — 时间线报告</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#1b2430;--muted:#637083;--line:#dce2ea;--accent:#2b6cb0;--warn:#b7791f;--bad:#c53030;--good:#276749}
@media(prefers-color-scheme:dark){:root{--bg:#11161d;--card:#18212b;--ink:#e8eef6;--muted:#9aa8b8;--line:#2b3948}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{max-width:1200px;margin:0 auto;padding:28px 18px 60px}
header{border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:20px}h1{font-size:24px;margin:0 0 8px}h2{font-size:17px;margin:26px 0 10px}.meta{color:var(--muted);font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.stat b{display:block;font-size:22px}.stat span{color:var(--muted);font-size:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border-bottom:1px solid var(--line);padding:7px 8px;vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}code{font-size:12px;background:color-mix(in srgb,var(--line) 35%,transparent);padding:1px 4px;border-radius:4px}.vec{font-variant-numeric:tabular-nums;font-weight:600}.band,.sev{display:inline-block;padding:1px 6px;border-radius:999px;font-size:11px;border:1px solid var(--line)}.high,.good{color:var(--good)}.medium{color:var(--warn)}.low,.blocking{color:var(--bad)}.notice{border-left:3px solid var(--warn);padding:10px 12px;background:color-mix(in srgb,var(--warn) 8%,transparent);border-radius:6px;margin:12px 0}.small{color:var(--muted);font-size:12px}a{color:var(--accent)}
</style></head><body><main class="wrap">
<header><h1>${esc(record.title)}</h1><div class="meta">Case <code>${esc(record.caseId)}</code> · Report <code>${esc(reportId)}</code> · ${esc(audience)} · ${esc(new Date().toISOString())}</div></header>
<div class="notice">这是证据整理报告，不是真伪裁决、身份认定或法律意见。日期是区间 + 精度 + 时区；<code>blocked/unknown</code> 不等于不存在。</div>
<section class="grid"><div class="stat"><b>${rows.length}</b><span>时间线条目</span></div><div class="stat"><b>${analysis.conflicts.length}</b><span>日期冲突</span></div><div class="stat"><b>${analysis.gaps.length}</b><span>缺口</span></div><div class="stat"><b>${analysis.coverage.domains.length}</b><span>独立域名</span></div></section>
<h2>问题</h2><div class="card">${esc(record.question)}</div>
<h2>时间线 / Timeline</h2><div class="card"><table><thead><tr><th>#</th><th>时间区间</th><th>事件</th><th>角色</th><th>T-S-C-E</th><th>状态</th><th>引用</th></tr></thead><tbody>${timelineRows || '<tr><td colspan="7">没有可报告的时间线条目。</td></tr>'}</tbody></table></div>
<h2>日期冲突 / Conflicts</h2><div class="card"><table><thead><tr><th>ID</th><th>类型</th><th>严重度</th><th>说明</th></tr></thead><tbody>${conflictRows || '<tr><td colspan="4">未检测到日期冲突。</td></tr>'}</tbody></table></div>
<h2>缺口 / Gaps</h2><div class="card"><table><thead><tr><th>ID</th><th>类型</th><th>说明</th><th>为什么重要</th></tr></thead><tbody>${gapRows || '<tr><td colspan="4">未记录缺口；无缺口不等于覆盖完整。</td></tr>'}</tbody></table></div>
<h2>查询日志 / Query log</h2><div class="card"><table><thead><tr><th>ID</th><th>通道</th><th>查询</th><th>命中</th><th>错误</th><th>执行时间</th></tr></thead><tbody>${queryRows || '<tr><td colspan="6">尚无查询记录。</td></tr>'}</tbody></table></div>
<h2>来源卡 / Sources</h2><div class="card"><table><thead><tr><th>ID</th><th>发布者</th><th>类型</th><th>链接</th><th>抓取时间</th><th>访问</th></tr></thead><tbody>${sourceRows || '<tr><td colspan="6">没有来源。</td></tr>'}</tbody></table></div>
<h2>方法与限制</h2><div class="card small"><p>五轴时间：event / publication / first-seen / observed / modified；日期为区间、精度、时区，不把抓取时间当发布时间。T-S-C-E 是证据向量，不是真伪概率。覆盖声明：未检查 ≠ 已检查未发现 ≠ 无法访问 ≠ 证据不足。</p><p>本文件不包含原始 HTML、完整正文、Cookie/Authorization 或身份结论。哈希是完整性校验，不是可信时间戳或法律意见。</p></div>
</main></body></html>`
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
      row.dates.map((date) => date.teg ?? 'T4').join(';'),
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
