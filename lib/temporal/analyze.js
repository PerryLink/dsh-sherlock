/**
 * Deterministic temporal analysis: pair-wise date conflicts, evidence vectors, timeline, gaps,
 * and coverage. The model may propose dates/roles; all comparisons and bands are computed here.
 * @module dsh-sherlock/temporal/analyze
 */
import { readFindings, listDateAssertions, listEvents, listSources, saveCoverage, saveFindings, sha256 } from './store.js'
import { compareIntervals, precisionRank } from './time.js'

const SOURCE_SCORE = { official: 3, court: 3, regulator: 3, legislature: 3, academic: 3, primary: 3, media: 2, reference: 2, unknown: 1, social_public: 1 }

/**
 * @param {string} root
 * @param {string} caseId
 */
export async function analyzeCase(root, caseId) {
  const [sources, events, dates] = await Promise.all([listSources(root, caseId), listEvents(root, caseId), listDateAssertions(root, caseId)])
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]))
  const datesByEvent = new Map()
  for (const date of dates) {
    if (!datesByEvent.has(date.eventId)) datesByEvent.set(date.eventId, [])
    datesByEvent.get(date.eventId).push(date)
  }

  const conflicts = []
  const gaps = []
  const timeline = []
  for (const event of events) {
    const eventDates = datesByEvent.get(event.eventId) ?? []
    const eventSources = [...new Set(eventDates.map((date) => date.sourceId))].map((id) => sourceById.get(id)).filter(Boolean)
    const eventConflicts = findConflicts(eventDates, sourceById)
    conflicts.push(...eventConflicts)
    const evidence = computeEvidence(eventDates, eventSources, eventConflicts)
    const status = eventStatus(event, eventDates, evidence, eventConflicts)
    const eventGaps = findGaps(event, eventDates, eventSources, eventConflicts)
    gaps.push(...eventGaps)
    const time = bestTime(eventDates)
    timeline.push({
      eventId: event.eventId,
      label: event.label,
      category: event.category ?? 'other',
      time,
      status,
      evidence,
      citationIds: eventDates.map((date) => date.assertionId),
      conflictIds: eventConflicts.map((conflict) => conflict.conflictId),
      gapIds: eventGaps.map((gap) => gap.gapId),
    })
  }

  timeline.sort((a, b) => {
    const aTime = a.time?.earliest ?? '9999'
    const bTime = b.time?.earliest ?? '9999'
    return aTime.localeCompare(bTime) || a.label.localeCompare(b.label)
  })
  const coverage = buildCoverage(sources, dates, events, timeline, gaps)
  await saveFindings(root, caseId, dedupeConflicts(conflicts), dedupeGaps(gaps))
  await saveCoverage(root, caseId, coverage)
  return { timeline, events, conflicts: dedupeConflicts(conflicts), gaps: dedupeGaps(gaps), coverage }
}

/** @param {any[]} dates @param {Map<string,any>} sourceById */
function findConflicts(dates, sourceById) {
  const conflicts = []
  for (let i = 0; i < dates.length; i += 1) {
    for (let j = i + 1; j < dates.length; j += 1) {
      const a = dates[i]; const b = dates[j]
      if (!a.parsed || !b.parsed) continue
      const aSource = sourceById.get(a.sourceId); const bSource = sourceById.get(b.sourceId)
      const make = (/** @type {string} */ type, /** @type {string} */ severity, /** @type {string} */ explanation) => {
        const conflictId = `conf-${sha256(`${a.assertionId}|${b.assertionId}|${type}`).slice(0, 12)}`
        conflicts.push({
          conflictId,
          eventId: a.eventId,
          type,
          severity,
          assertionIds: [a.assertionId, b.assertionId],
          sourceIds: [a.sourceId, b.sourceId],
          explanation,
          candidateResolutions: resolutionFor(type),
          resolution: { status: 'unresolved' },
        })
      }
      if (a.sourceId === b.sourceId || (aSource?.domain && aSource.domain === bSource?.domain)) {
        make('dependence', 'minor', 'Both assertions come from the same source/domain; this is not independent corroboration.')
        continue
      }
      if (a.role !== b.role) {
        if (compareIntervals(a.parsed, b.parsed) !== 'overlaps' && compareIntervals(a.parsed, b.parsed) !== 'same') {
          make('role_mismatch', 'minor', `Different date roles (${a.role} vs ${b.role}); the difference may be expected.`)
        }
        continue
      }
      if (a.parsed.timeZone === null || b.parsed.timeZone === null) {
        make('timezone_ambiguity', 'material', 'At least one assertion has no stated timezone; the interval cannot be compared exactly.')
        continue
      }
      const relation = compareIntervals(a.parsed, b.parsed)
      if (relation === 'before' || relation === 'after') {
        if (precisionRank(a.parsed.precision) >= 4 && precisionRank(b.parsed.precision) >= 4) {
          make('hard_time', 'blocking', `Same role and comparable precision, but the intervals are disjoint (${a.parsed.earliest} vs ${b.parsed.earliest}).`)
        } else {
          make('precision_mismatch', 'minor', 'One assertion is coarser than the other; disjointness may be a precision artifact.')
        }
      } else if (relation === 'overlaps' && a.parsed.precision !== b.parsed.precision) {
        make('precision_mismatch', 'minor', 'Different precision; the intervals overlap within the coarser window.')
      }
    }
  }
  return dedupeConflicts(conflicts)
}

/** @param {string} type */
function resolutionFor(type) {
  if (type === 'hard_time') return [{ kind: 'primary_record', note: 'Find a primary record (filing, court document, official announcement) for the event date.' }, { kind: 'timezone', note: 'Verify the timezone and exact timestamp of both statements.' }]
  if (type === 'timezone_ambiguity') return [{ kind: 'timezone', note: 'Find an explicit offset or a source that states the local timezone.' }]
  if (type === 'dependence') return [{ kind: 'independent_source', note: 'Find a source that did not copy the same publisher.' }]
  return [{ kind: 'context', note: 'Read both sources in context; the difference may be a role or precision mismatch.' }]
}

/** @param {any[]} dates @param {any[]} sources @param {any[]} conflicts */
function computeEvidence(dates, sources, conflicts) {
  const parsed = dates.filter((date) => date.parsed)
  let T = 0
  for (const date of parsed) {
    if (date.parsed.timeZone && precisionRank(date.parsed.precision) >= 5) T = Math.max(T, 3)
    else if (date.parsed.timeZone && precisionRank(date.parsed.precision) >= 4) T = Math.max(T, 2)
    else if (precisionRank(date.parsed.precision) >= 4) T = Math.max(T, 1)
    else T = Math.max(T, 1)
  }
  const S = sources.reduce((max, source) => Math.max(max, SOURCE_SCORE[source.sourceClass] ?? 1), 0)
  const domains = new Set(sources.map((source) => source.domain).filter(Boolean))
  const hasPrimary = sources.some((source) => (SOURCE_SCORE[source.sourceClass] ?? 1) >= 3)
  const C = domains.size >= 2 ? (hasPrimary ? 3 : 2) : domains.size === 1 ? 1 : 0
  const hasSnapshotAndQuote = dates.some((date) => date.quoteSha256 && sources.some((source) => source.sourceId === date.sourceId && source.sha256))
  const E = hasSnapshotAndQuote ? 3 : dates.some((date) => sources.some((source) => source.sourceId === date.sourceId && source.sha256)) ? 2 : sources.length ? 1 : 0
  const blocking = conflicts.some((conflict) => conflict.severity === 'blocking')
  const material = conflicts.some((conflict) => conflict.severity === 'material')
  let band = 'low'
  if (!blocking && T >= 2 && S >= 3 && C >= 2 && E === 3) band = 'high'
  else if (!blocking && !material && T >= 1 && S >= 2 && C >= 1 && E >= 2) band = 'medium'
  if (blocking) band = 'low'
  else if (material && band === 'high') band = 'medium'
  return { T, S, C, E, band, contradiction: blocking ? 'unresolved' : material ? 'unresolved' : 'none' }
}

/** @param {any} event @param {any[]} dates @param {any} evidence @param {any[]} conflicts */
function eventStatus(event, dates, evidence, conflicts) {
  if (!dates.length) return 'insufficient'
  if (conflicts.some((conflict) => conflict.severity === 'blocking')) return 'contested'
  if (evidence.S >= 3 && evidence.C >= 2) return 'primary'
  return 'reported'
}

/** @param {any[]} dates */
function bestTime(dates) {
  const parsed = dates.map((date) => date.parsed).filter(Boolean).sort((a, b) => precisionRank(b.precision) - precisionRank(a.precision) || a.earliest.localeCompare(b.earliest))
  if (!parsed.length) return null
  return { earliest: parsed[0].earliest, latest: parsed[0].latest, precision: parsed[0].precision, timeZone: parsed[0].timeZone, display: parsed[0].display, uncertain: parsed[0].uncertain }
}

/** @param {any} event @param {any[]} dates @param {any[]} sources @param {any[]} conflicts */
function findGaps(event, dates, sources, conflicts) {
  const gaps = []
  const add = (/** @type {string} */ type, /** @type {string} */ description, /** @type {string} */ whyItMatters) => {
    gaps.push({ gapId: `gap-${sha256(`${event.eventId}|${type}|${description}`).slice(0, 12)}`, eventId: event.eventId, type, description, whyItMatters, status: 'open' })
  }
  if (!sources.length) add('source', 'No source has been attached to this event.', 'A timeline entry without a source is only a lead.')
  if (!dates.length) add('date', 'No date assertion has been recorded.', 'The event cannot be placed on the timeline.')
  if (dates.some((date) => !date.parsed)) add('date', 'At least one date expression could not be normalized.', 'The raw text is retained; a human must resolve the ambiguity.')
  if (dates.some((date) => date.parsed && date.parsed.timeZone === null)) add('date', 'At least one date has no stated timezone.', 'The interval may be off by up to a day; do not compare as an exact instant.')
  if (sources.some((source) => source.access === 'blocked')) add('access', 'At least one source is blocked (401/403/429/999).', 'Blocked is not evidence of absence.')
  if (new Set(sources.map((source) => source.domain)).size < 2) add('corroboration', 'Only one independent domain supports this event.', 'Add an independent source before treating the event as corroborated.')
  if (conflicts.some((conflict) => conflict.severity === 'blocking')) add('corroboration', 'Unresolved blocking date conflict.', 'The timeline cannot choose a date; report the conflict and what would resolve it.')
  return gaps
}

/** @param {any[]} sources @param {any[]} dates @param {any[]} events @param {any[]} timeline @param {any[]} gaps */
function buildCoverage(sources, dates, events, timeline, gaps) {
  const domains = [...new Set(sources.map((source) => source.domain))].sort()
  const classes = {}
  for (const source of sources) classes[source.sourceClass] = (classes[source.sourceClass] ?? 0) + 1
  return {
    sourceCount: sources.length,
    domains,
    classes,
    dateCount: dates.length,
    eventCount: events.length,
    timelineCount: timeline.length,
    gapCount: gaps.length,
    observedFrom: sources.map((source) => source.fetchedAt).sort()[0] ?? null,
    observedTo: sources.map((source) => source.fetchedAt).sort().at(-1) ?? null,
    generatedAt: new Date().toISOString(),
    negativeStatementRule: 'A negative statement requires a coverage statement; absence of a source is not absence of the event.',
  }
}

/** @param {any[]} conflicts */
function dedupeConflicts(conflicts) {
  return [...new Map(conflicts.map((conflict) => [conflict.conflictId, conflict])).values()]
}

/** @param {any[]} gaps */
function dedupeGaps(gaps) {
  return [...new Map(gaps.map((gap) => [gap.gapId, gap])).values()]
}

/** @param {string} root @param {string} caseId */
export async function readAnalysis(root, caseId) {
  return readFindings(root, caseId)
}
