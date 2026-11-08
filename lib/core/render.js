/**
 * Model-facing renderers. Keep them compact: the canonical value carries the
 * full result set; the model sees a reviewable summary by default.
 */

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 }

export function renderCheckResult(args, value, { maxChars = 16_000 } = {}) {
  const lines = []
  const summary = value.summary
  const scope = value.scope === 'explicit'
    ? `explicit (${summary.total})`
    : `${value.scope} (${summary.total})`
  lines.push(`## Sherlock: \`${value.username}\``)
  lines.push('')
  lines.push(
    `Scope: ${scope} · claimed **${summary.claimed}** · need review ${summary.unknown + summary.blocked + summary.unreliable}`
    + ` · available ${summary.available} · ${(summary.durationMs / 1000).toFixed(1)}s`,
  )
  if (value.manifest?.commit) {
    lines.push(`Manifest: \`${value.manifest.commit.slice(0, 8)}\` · checked ${value.checkedAt}`)
  } else {
    lines.push(`Checked ${value.checkedAt}`)
  }
  lines.push('')

  if (value.claimed.length === 0) {
    lines.push('No claimed profiles found in this scope. **This does not prove the username is unused everywhere.**')
  } else {
    lines.push('### Claimed')
    lines.push('')
    lines.push('| Site | Profile | Confidence |')
    lines.push('|---|---|---|')
    for (const result of sortClaimed(value.claimed)) {
      lines.push(`| ${escapeCell(result.siteName)} | ${link(result.url)} | ${result.confidence} |`)
    }
  }

  if (value.needsReview.length > 0) {
    lines.push('')
    lines.push('### Needs review')
    lines.push('')
    for (const result of value.needsReview.slice(0, 25)) {
      const reason = result.evidence?.reason ?? result.status
      lines.push(`- **${result.siteName}** — ${result.status} (${reason})${result.url ? ` · ${result.url}` : ''}`)
    }
    if (value.needsReview.length > 25) {
      lines.push(`- … ${value.needsReview.length - 25} more; narrow the scope or use PTC for the full array`)
    }
  }

  if (args?.include_available === true && value.available?.length > 0) {
    lines.push('')
    lines.push('### Available')
    lines.push('')
    lines.push(value.available.map((result) => result.siteName).join(', '))
  }

  if (value.warnings.length > 0) {
    lines.push('')
    lines.push('### Warnings')
    for (const warning of value.warnings) lines.push(`- ${warning}`)
  }

  lines.push('')
  lines.push(
    'These are public profile URLs, not proof that the accounts belong to the same person. '
    + 'Blocked or unknown sites are not evidence of absence; verify before reporting.',
  )
  return truncateText(lines.join('\n'), maxChars)
}

export function renderSitesResult(_args, value, { maxChars = 12_000 } = {}) {
  const lines = [
    `## Sherlock sites (${value.count})`,
    '',
    '| Site | Detector | Reliability | NSFW | URL |',
    '|---|---|---|---|---|',
  ]
  for (const site of value.sites) {
    lines.push(
      `| ${escapeCell(site.name)} | ${site.detectors.join('+')} | ${site.reliability} | ${site.nsfw ? 'yes' : 'no'} | ${link(site.urlMain)} |`,
    )
  }
  if (value.truncated) {
    lines.push('')
    lines.push(`Showing ${value.sites.length} of ${value.total}; narrow the query or raise the limit.`)
  }
  return truncateText(lines.join('\n'), maxChars)
}

function sortClaimed(claimed) {
  return [...claimed].sort((a, b) => {
    const order = (CONFIDENCE_ORDER[a.confidence] ?? 9) - (CONFIDENCE_ORDER[b.confidence] ?? 9)
    return order !== 0 ? order : a.siteName.localeCompare(b.siteName)
  })
}

function link(url) {
  if (!url) return ''
  const safe = String(url).replaceAll(')', '%29')
  return `[${safe.replace(/^https?:\/\//, '')}](${safe})`
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 80)}\n\n… output truncated at ${maxChars} characters; use PTC or a narrower scope.`
}
