/**
 * Fail-closed language and PII checks for user-authored report fields. Templates may say
 * "not a true/false verdict"; user-authored event/claim/source labels may not assert one.
 * @module dsh-sherlock/temporal/lint
 */
const VERDICT_PATTERNS = [
  /已证实/, /确凿/, /真相/, /假消息/, /谣言/, /骗局/, /100\s*%\s*可信/, /全网都查过/,
  /就是本人/, /同一人/, /确认是同一人/, /属于同一人/,
  /\b(same person|identity confirmed|confirmed identity|verified identity|definitely true|definitely false)\b/i,
]
const PII_PATTERNS = [
  { kind: 'email', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { kind: 'phone', re: /(?:\+?86[- ]?)?1[3-9]\d{9}\b/ },
  { kind: 'id-card', re: /\b\d{17}[\dXx]\b/ },
]

/**
 * @param {{eventLabels?:string[],claimTexts?:string[],sourceTitles?:string[],reviewNotes?:string[]}} input
 * @returns {{violations:string[],pii:Array<{kind:string,where:string}>}}
 */
export function lintCaseFields(input) {
  const fields = []
  for (const value of input.eventLabels ?? []) fields.push(['event label', value])
  for (const value of input.claimTexts ?? []) fields.push(['claim', value])
  for (const value of input.sourceTitles ?? []) fields.push(['source title', value])
  for (const value of input.reviewNotes ?? []) fields.push(['review note', value])
  const violations = []
  const pii = []
  for (const [where, value] of fields) {
    const text = String(value ?? '')
    for (const pattern of VERDICT_PATTERNS) {
      if (pattern.test(text)) violations.push(`${where}: verdict/identity phrase matched ${pattern}`)
    }
    for (const pattern of PII_PATTERNS) {
      if (pattern.re.test(text)) pii.push({ kind: pattern.kind, where })
    }
  }
  return { violations: [...new Set(violations)], pii }
}

/** @param {{violations:string[],pii:Array<{kind:string,where:string}>}} lint */
export function assertLint(lint) {
  if (lint.violations.length) throw new Error(`report language lint failed: ${lint.violations.join('; ')}`)
}
