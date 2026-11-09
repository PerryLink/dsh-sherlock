/**
 * Temporal normalization for ChronoWeft. Dates are represented as intervals with an explicit
 * precision and timezone provenance; a missing timezone is never silently replaced with UTC.
 * @module dsh-sherlock/temporal/time
 */

export const PRECISIONS = ['year', 'quarter', 'month', 'week', 'day', 'hour', 'minute', 'second']
export const ROLES = ['event', 'announcement', 'effective', 'publication', 'update', 'correction', 'retraction', 'access', 'deadline', 'period']

const MONTHS = new Map([
  ['jan', 1], ['january', 1], ['feb', 2], ['february', 2], ['mar', 3], ['march', 3],
  ['apr', 4], ['april', 4], ['may', 5], ['jun', 6], ['june', 6], ['jul', 7], ['july', 7],
  ['aug', 8], ['august', 8], ['sep', 9], ['sept', 9], ['september', 9], ['oct', 10], ['october', 10],
  ['nov', 11], ['november', 11], ['dec', 12], ['december', 12],
])

/**
 * @typedef {object} TemporalValue
 * @property {string} raw
 * @property {string} earliest ISO UTC
 * @property {string} latest ISO UTC
 * @property {string} precision
 * @property {string|null} timeZone null when the source did not state one
 * @property {string} calendar
 * @property {string} display
 * @property {boolean} openStart
 * @property {boolean} openEnd
 * @property {boolean} uncertain
 */

/**
 * Parse the date forms that appear in public pages. Ambiguous slash dates are returned as null
 * (with no guess) so the caller can emit an `ambiguous_date` gap.
 * @param {string} raw
 * @param {{anchor?: string|null}} [options]
 * @returns {TemporalValue|null}
 */
export function parseDate(raw, options = {}) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '') return null

  const relative = parseRelative(text, options.anchor ?? null)
  if (relative !== undefined) return relative

  const iso = parseIso(text)
  if (iso) return iso

  const chinese = parseChinese(text)
  if (chinese) return chinese

  const english = parseEnglish(text)
  if (english) return english

  return parseRfc822(text)
}

/** @param {string} text @param {string|null} anchor @returns {TemporalValue|null|undefined} */
function parseRelative(text, anchor) {
  const patterns = [
    { re: /^(\d+)\s*(?:天|日)前$/, unit: 'day', sign: -1, fixed: false },
    { re: /^(\d+)\s*(?:小时|钟头)前$/, unit: 'hour', sign: -1, fixed: false },
    { re: /^(\d+)\s*分钟前$/, unit: 'minute', sign: -1, fixed: false },
    { re: /^昨天(?:\s*(\d{1,2}):(\d{2}))?$/, unit: 'day', sign: -1, fixed: true },
    { re: /^前天(?:\s*(\d{1,2}):(\d{2}))?$/, unit: 'day', sign: -2, fixed: true },
    { re: /^今天(?:\s*(\d{1,2}):(\d{2}))?$/, unit: 'day', sign: 0, fixed: true },
    { re: /^上周(?:\s*(\d{1,2}):(\d{2}))?$/, unit: 'day', sign: -7, fixed: true },
  ]
  let matchedRelative = false
  for (const pattern of patterns) {
    const match = pattern.re.exec(text)
    if (!match) continue
    matchedRelative = true
    if (!anchor) return null
    const anchorValue = parseDate(anchor)
    if (!anchorValue) return null
    const base = new Date(anchorValue.earliest)
    if (pattern.unit === 'day') base.setUTCDate(base.getUTCDate() + (pattern.fixed ? pattern.sign : pattern.sign * Number(match[1] ?? 1)))
    if (pattern.unit === 'hour') base.setUTCHours(base.getUTCHours() + pattern.sign * Number(match[1]))
    if (pattern.unit === 'minute') base.setUTCMinutes(base.getUTCMinutes() + pattern.sign * Number(match[1]))
    const hasClock = pattern.fixed && match[1] !== undefined && match[2] !== undefined
    const parts = {
      year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(),
      hour: hasClock ? Number(match[1]) : 0, minute: hasClock ? Number(match[2]) : 0, second: 0,
    }
    return build(parts, hasClock ? 'minute' : 'day', { raw: text, timeZone: anchorValue.timeZone, tzSource: 'anchor', certainty: 'derived' })
  }
  if (/^(近日|日前|据悉|最近|本周|本月)$/.test(text)) return null
  return matchedRelative ? null : undefined
}

/** @param {string} text */
function parseIso(text) {
  let match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.exec(text)
  if (match) {
    const offset = parseOffset(match[7])
    return build({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0) }, match[6] === undefined ? 'minute' : 'second', { raw: text, timeZone: offset.timeZone, offsetMinutes: offset.minutes, tzSource: 'explicit' })
  }
  match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (match) return build({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0) }, match[6] === undefined ? 'minute' : 'second', { raw: text, timeZone: null, tzSource: 'missing' })
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (match) return build({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }, 'day', { raw: text, timeZone: null, tzSource: 'missing' })
  match = /^(\d{4})-(\d{2})$/.exec(text)
  if (match) return build({ year: Number(match[1]), month: Number(match[2]) }, 'month', { raw: text, timeZone: null, tzSource: 'missing' })
  match = /^(\d{4})$/.exec(text)
  if (match) return build({ year: Number(match[1]) }, 'year', { raw: text, timeZone: null, tzSource: 'missing' })
  return null
}

/** @param {string} text */
function parseChinese(text) {
  const match = /^(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?(?:\s*(\d{1,2}):(\d{2}))?(?:\s*(北京时间|UTC|GMT|Z|[+-]\d{2}:?\d{2}))?$/.exec(text)
  if (!match) return null
  const zone = match[6]
  let offset
  if (zone === '北京时间') offset = { timeZone: 'Asia/Shanghai', minutes: 480 }
  else if (zone === 'UTC' || zone === 'GMT' || zone === 'Z') offset = { timeZone: 'UTC', minutes: 0 }
  else if (zone) offset = parseOffset(zone)
  else offset = { timeZone: null, minutes: null }
  const parts = { year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : 1, hour: match[4] ? Number(match[4]) : 0, minute: match[5] ? Number(match[5]) : 0, second: 0 }
  if (!match[3]) return build({ year: parts.year, month: parts.month }, 'month', { raw: text, timeZone: offset.timeZone, offsetMinutes: offset.minutes, tzSource: offset.timeZone ? 'explicit' : 'missing' })
  return build(parts, match[4] ? 'minute' : 'day', { raw: text, timeZone: offset.timeZone, offsetMinutes: offset.minutes, tzSource: offset.timeZone ? 'explicit' : 'missing' })
}

/** @param {string} text */
function parseEnglish(text) {
  let match = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*)?([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(text)
  let monthName
  let day
  let year
  let hourText
  let minuteText
  let secondText
  let ampm
  if (match) {
    monthName = match[1]; day = Number(match[2]); year = Number(match[3]); hourText = match[4]; minuteText = match[5]; secondText = match[6]; ampm = match[7]
  } else {
    match = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*)?(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(text)
    if (!match) return null
    day = Number(match[1]); monthName = match[2]; year = Number(match[3]); hourText = match[4]; minuteText = match[5]; secondText = match[6]; ampm = match[7]
  }
  const month = MONTHS.get(monthName.toLowerCase())
  if (!month) return null
  let hour = hourText ? Number(hourText) : 0
  if (ampm) hour = (hour % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0)
  return build({ year, month, day, hour, minute: minuteText ? Number(minuteText) : 0, second: secondText ? Number(secondText) : 0 }, hourText ? (secondText ? 'second' : 'minute') : 'day', { raw: text, timeZone: null, tzSource: 'missing' })
}

/** @param {string} text */
function parseRfc822(text) {
  const match = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(GMT|UTC|[+-]\d{4})$/i.exec(text)
  if (!match) return null
  const month = MONTHS.get(match[2].toLowerCase())
  if (!month) return null
  const offset = match[7] === 'GMT' || match[7] === 'UTC' ? { timeZone: 'UTC', minutes: 0 } : parseOffset(`${match[7].slice(0, 3)}:${match[7].slice(3)}`)
  return build({ year: Number(match[3]), month, day: Number(match[1]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0) }, 'second', { raw: text, timeZone: offset.timeZone, offsetMinutes: offset.minutes, tzSource: 'explicit' })
}

/** @param {{year:number, month?:number, day?:number, hour?:number, minute?:number, second?:number}} parts @param {string} precision @param {{raw:string, timeZone:string|null, offsetMinutes?:number|null, tzSource:string, certainty?:string}} options @returns {TemporalValue} */
function build(parts, precision, options) {
  const month = parts.month ?? 1
  const day = parts.day ?? 1
  const hour = parts.hour ?? 0
  const minute = parts.minute ?? 0
  const second = parts.second ?? 0
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) throw new Error(`invalid date parts: ${options.raw}`)
  const offsetMinutes = options.offsetMinutes ?? 0
  const start = new Date(Date.UTC(parts.year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000)
  if (Number.isNaN(start.getTime())) throw new Error(`invalid date: ${options.raw}`)
  const end = new Date(start)
  if (precision === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1)
  else if (precision === 'quarter') end.setUTCMonth(end.getUTCMonth() + 3)
  else if (precision === 'month') end.setUTCMonth(end.getUTCMonth() + 1)
  else if (precision === 'week') end.setUTCDate(end.getUTCDate() + 7)
  else if (precision === 'day') end.setUTCDate(end.getUTCDate() + 1)
  else if (precision === 'hour') end.setUTCHours(end.getUTCHours() + 1)
  else if (precision === 'minute') end.setUTCMinutes(end.getUTCMinutes() + 1)
  else if (precision === 'second') end.setUTCSeconds(end.getUTCSeconds() + 1)
  else throw new Error(`unsupported precision: ${precision}`)
  return { raw: options.raw, earliest: start.toISOString(), latest: end.toISOString(), precision, timeZone: options.timeZone ?? null, calendar: 'gregorian', display: options.raw, openStart: false, openEnd: false, uncertain: options.timeZone === null || options.certainty === 'derived' }
}

/** @param {string} value */
function parseOffset(value) {
  if (value === 'Z' || value === 'UTC' || value === 'GMT') return { timeZone: 'UTC', minutes: 0 }
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(value)
  if (!match) return { timeZone: null, minutes: null }
  const minutes = (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
  return { timeZone: `${match[1]}${match[2]}:${match[3]}`, minutes }
}

/** @param {TemporalValue|null} a @param {TemporalValue|null} b */
export function compareIntervals(a, b) {
  if (!a || !b) return 'unknown'
  const aStart = Date.parse(a.earliest); const aEnd = Date.parse(a.latest)
  const bStart = Date.parse(b.earliest); const bEnd = Date.parse(b.latest)
  if (aEnd <= bStart) return 'before'
  if (bEnd <= aStart) return 'after'
  if (aStart === bStart && aEnd === bEnd) return 'same'
  return 'overlaps'
}

/** @param {string} precision */
export function precisionRank(precision) { return PRECISIONS.indexOf(precision) }
