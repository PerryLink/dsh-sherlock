/**
 * Local case store for temporal evidence. The files are the authoritative record; no website,
 * server, database, or external account is involved. Case IDs are generated here and never
 * accepted from the model as paths.
 * @module dsh-sherlock/temporal/store
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const CASE_ID_RE = /^case-\d{8}-[0-9a-f]{8}$/

/** @param {string} root */
export function resolveRoot(root) {
  return resolve(root || '.dsh-sherlock/chrono')
}

/** @param {string} prefix */
export function nextId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
}

/** @param {string|Buffer} value */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * @param {string} root
 * @param {{title:string,question:string,purpose?:string,subjectType?:string,subjectName?:string,from?:string|null,to?:string|null,languages?:string[]}} input
 */
export async function createCase(root, input) {
  const base = resolveRoot(root)
  const caseId = `case-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex')}`
  const dir = caseDir(base, caseId)
  await mkdir(join(dir, 'snapshots'), { recursive: true })
  await mkdir(join(dir, 'reports'), { recursive: true })
  const now = new Date().toISOString()
  const record = {
    schemaVersion: 1,
    caseId,
    title: input.title,
    question: input.question,
    purpose: input.purpose ?? 'publish',
    subject: { type: input.subjectType ?? 'event', name: input.subjectName ?? input.title },
    scope: { from: input.from ?? null, to: input.to ?? null, languages: input.languages ?? ['zh', 'en'], sourceClasses: [] },
    distribution: 'local',
    policy: { publicSourcesOnly: true, noPeopleSearch: true, noMassScraping: true, noTruthVerdict: true },
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await writeJson(join(dir, 'case.json'), record)
  for (const file of ['sources.jsonl', 'events.jsonl', 'dates.jsonl', 'claims.jsonl']) {
    await writeFile(join(dir, file), '', 'utf8')
  }
  await writeJson(join(dir, 'conflicts.json'), [])
  await writeJson(join(dir, 'gaps.json'), [])
  await writeJson(join(dir, 'coverage.json'), { queries: [], sourceCount: 0, domains: [], classes: {} })
  return record
}

/** @param {string} root @param {string} caseId */
export async function loadCase(root, caseId) {
  const dir = caseDir(root, caseId)
  return readJson(join(dir, 'case.json'))
}

/** @param {string} root @param {string} caseId @param {object} patch */
export async function updateCase(root, caseId, patch) {
  const dir = caseDir(root, caseId)
  const current = await readJson(join(dir, 'case.json'))
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
  await writeJson(join(dir, 'case.json'), next)
  return next
}

/** @param {string} root */
export async function listCases(root) {
  const base = resolveRoot(root)
  if (!existsSync(base)) return []
  const entries = await readdir(join(base, 'cases'), { withFileTypes: true }).catch(() => [])
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !CASE_ID_RE.test(entry.name)) continue
    try {
      const record = await readJson(join(base, 'cases', entry.name, 'case.json'))
      rows.push({ caseId: record.caseId, title: record.title, question: record.question, status: record.status, createdAt: record.createdAt })
    } catch {
      // Ignore torn case directories; they are not valid cases.
    }
  }
  return rows
}

/**
 * Store a fetched source and its text snapshot. The public source record never contains raw
 * HTML; the snapshot is a local evidence file referenced by id.
 * @param {string} root
 * @param {string} caseId
 * @param {import('./fetch.js').FetchRecord} fetched
 * @param {{title?:string|null,byline?:string|null,canonicalUrl?:string|null,timeCandidates?:object[],sourceClass?:string}} extracted
 */
export async function addSource(root, caseId, fetched, extracted = {}) {
  const dir = caseDir(root, caseId)
  const sourceId = nextId('src')
  const snapshotId = nextId('snap')
  const snapshotFile = `snapshots/${snapshotId}.txt`
  await writeFile(join(dir, snapshotFile), fetched.text, 'utf8')
  const source = {
    sourceId,
    snapshotId,
    requestedUrl: fetched.requestedUrl,
    finalUrl: fetched.finalUrl,
    canonicalUrl: extracted.canonicalUrl ?? fetched.finalUrl,
    domain: fetched.domain,
    publisher: fetched.domain,
    title: extracted.title ?? null,
    byline: extracted.byline ?? null,
    sourceClass: extracted.sourceClass ?? 'unknown',
    fetchedAt: fetched.fetchedAt,
    httpStatus: fetched.httpStatus,
    contentType: fetched.contentType,
    charset: fetched.charset,
    byteLength: fetched.byteLength,
    sha256: fetched.sha256,
    textSha256: fetched.textSha256,
    headers: fetched.headers,
    redirects: fetched.redirects,
    access: fetched.access,
    timeCandidates: extracted.timeCandidates ?? [],
    snapshotFile,
  }
  await appendJsonl(join(dir, 'sources.jsonl'), source)
  return source
}

/** @param {string} root @param {string} caseId */
export async function listSources(root, caseId) {
  return readJsonl(join(caseDir(root, caseId), 'sources.jsonl'))
}

/** @param {string} root @param {string} caseId @param {string} sourceId */
export async function readSourceText(root, caseId, sourceId) {
  const source = (await listSources(root, caseId)).find((row) => row.sourceId === sourceId)
  if (!source) throw new Error(`unknown source: ${sourceId}`)
  const text = await readFile(join(caseDir(root, caseId), source.snapshotFile), 'utf8')
  return { source, text }
}

/** @param {string} root @param {string} caseId @param {object} event */
export async function addEvent(root, caseId, event) {
  const record = { eventId: nextId('evt'), createdAt: new Date().toISOString(), ...event }
  await appendJsonl(join(caseDir(root, caseId), 'events.jsonl'), record)
  return record
}

/** @param {string} root @param {string} caseId */
export async function listEvents(root, caseId) {
  return readJsonl(join(caseDir(root, caseId), 'events.jsonl'))
}

/** @param {string} root @param {string} caseId @param {object} assertion */
export async function addDateAssertion(root, caseId, assertion) {
  const record = { assertionId: nextId('date'), createdAt: new Date().toISOString(), ...assertion }
  await appendJsonl(join(caseDir(root, caseId), 'dates.jsonl'), record)
  return record
}

/** @param {string} root @param {string} caseId */
export async function listDateAssertions(root, caseId) {
  return readJsonl(join(caseDir(root, caseId), 'dates.jsonl'))
}

/** @param {string} root @param {string} caseId @param {object[]} conflicts @param {object[]} gaps */
export async function saveFindings(root, caseId, conflicts, gaps) {
  const dir = caseDir(root, caseId)
  await writeJson(join(dir, 'conflicts.json'), conflicts)
  await writeJson(join(dir, 'gaps.json'), gaps)
}

/** @param {string} root @param {string} caseId @param {object} coverage */
export async function saveCoverage(root, caseId, coverage) {
  await writeJson(join(caseDir(root, caseId), 'coverage.json'), coverage)
}

/** @param {string} root @param {string} caseId */
export async function readFindings(root, caseId) {
  const dir = caseDir(root, caseId)
  return {
    conflicts: await readJson(join(dir, 'conflicts.json')),
    gaps: await readJson(join(dir, 'gaps.json')),
    coverage: await readJson(join(dir, 'coverage.json')),
  }
}

/** @param {string} root @param {string} caseId @param {string} reportId */
export async function reportDir(root, caseId, reportId) {
  const dir = join(caseDir(root, caseId), 'reports', reportId)
  await mkdir(dir, { recursive: true })
  return dir
}

/** @param {string} dir @param {string} name @param {string|Buffer} content */
export async function writeReportFile(dir, name, content) {
  const target = join(dir, name)
  await writeFile(target, content)
  return { name, sha256: sha256(content), bytes: Buffer.byteLength(content) }
}

/** @param {string} root @param {string} caseId */
export function caseDir(root, caseId) {
  if (typeof caseId !== 'string' || !CASE_ID_RE.test(caseId)) throw new Error(`invalid case id: ${caseId}`)
  return join(resolveRoot(root), 'cases', caseId)
}

/** @param {string} file */
async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** @param {string} file @param {unknown} value */
async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** @param {string} file @param {unknown} value */
async function appendJsonl(file, value) {
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

/** @param {string} file */
async function readJsonl(file) {
  const text = await readFile(file, 'utf8').catch(() => '')
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}
