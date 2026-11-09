#!/usr/bin/env node
/**
 * Local temporal-workbench benchmark. No network, no external services.
 * Measures date parsing, case analysis, and report generation with synthetic local files.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { analyzeCase } from '../lib/temporal/analyze.js'
import { generateReport } from '../lib/temporal/report.js'
import { addDateAssertion, addEvent, addSource, createCase } from '../lib/temporal/store.js'
import { parseDate } from '../lib/temporal/time.js'

const COUNT = Number(process.env.CHRONO_BENCH_COUNT ?? 100)
const root = await mkdtemp(join(tmpdir(), 'dsh-sherlock-benchmark-'))
try {
  const parseStart = performance.now()
  for (let index = 0; index < 10_000; index++) parseDate(`2024-03-${String((index % 28) + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00+08:00`)
  const parseMs = performance.now() - parseStart
  const record = await createCase(root, { title: 'Benchmark case', question: 'How fast is the local path?' })
  const sourceIds = []
  for (let index = 0; index < Math.min(COUNT, 50); index++) {
    const source = await addSource(root, record.caseId, {
      requestedUrl: `https://example.com/${index}`, finalUrl: `https://example.com/${index}`, httpStatus: 200,
      contentType: 'text/html', charset: 'utf-8', fetchedAt: '2024-03-02T00:00:00.000Z', byteLength: 100,
      sha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), text: `The event happened on 2024-03-${String((index % 28) + 1).padStart(2, '0')}.`,
      headers: {}, redirects: [], access: 'open', domain: 'example.com',
    }, { title: `Source ${index}`, sourceClass: 'media', timeCandidates: [] })
    sourceIds.push(source.sourceId)
  }
  const analysisStart = performance.now()
  for (let index = 0; index < COUNT; index++) {
    const day = String((index % 28) + 1).padStart(2, '0')
    const event = await addEvent(root, record.caseId, { label: `Event ${index}`, category: 'other', sourceIds: [sourceIds[index % sourceIds.length]] })
    await addDateAssertion(root, record.caseId, { eventId: event.eventId, sourceId: sourceIds[index % sourceIds.length], rawText: `2024-03-${day}`, role: 'event', parsed: parseDate(`2024-03-${day}`), span: null, quoteSha256: 'c'.repeat(64), teg: 'T2' })
  }
  const addMs = performance.now() - analysisStart
  const analyzeStart = performance.now()
  const analysis = await analyzeCase(root, record.caseId)
  const analyzeMs = performance.now() - analyzeStart
  const reportStart = performance.now()
  const report = await generateReport(root, record.caseId, { audience: 'internal', redaction: 'internal' })
  const reportMs = performance.now() - reportStart
  console.log(JSON.stringify({
    count: COUNT,
    parse10kMs: Number(parseMs.toFixed(1)),
    add100Ms: Number(addMs.toFixed(1)),
    analyzeMs: Number(analyzeMs.toFixed(1)),
    reportMs: Number(reportMs.toFixed(1)),
    timeline: analysis.timeline.length,
    conflicts: analysis.conflicts.length,
    gaps: analysis.gaps.length,
    reportFiles: report.files.length,
  }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
