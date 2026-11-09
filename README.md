# dsh-sherlock

[![CI](https://github.com/PerryLink/dsh-sherlock/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-sherlock/actions/workflows/ci.yml)

A **temporal evidence workbench** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), with the earlier username-check tools kept as legacy.

It does **not** build or host a website. It does **not** search for people. It takes public URLs (and optional DSH search results), freezes local snapshots, separates the different clocks on a date, reconstructs a reviewable timeline, and reports conflicts, gaps, and coverage. It never issues a true/false verdict.

> The name is retained for continuity. The product direction is temporal evidence, not username enumeration.

## What it does

`chrono_case` → `chrono_ingest` → `chrono_assert` → `chrono_analyze` → `chrono_report`

- **chrono_case** creates/opens a local case.
- **chrono_ingest** fetches 1–10 public URLs, stores text snapshots and SHA-256, and extracts declared dates.
- **chrono_assert** records an event and its raw date assertions with a role (`event`, `announcement`, `effective`, `publication`, `update`, `correction`, `retraction`, `access`, `deadline`, `period`).
- **chrono_analyze** runs deterministic conflict/evidence/timeline/gap/coverage analysis.
- **chrono_report** writes `report.md`, `timeline.csv`, `sources.csv`, and `report.manifest.json`.
- The `chrono-investigation` skill carries the method: five clocks, T-S-C-E, conflict handling, uncertainty language.

### Five clocks (never collapsed into one "date")

| Axis | Meaning |
|---|---|
| **E** Event | when the asserted event happened or took effect |
| **P** Publication | when the assertion was first made public |
| **F** First seen | earliest proof that anyone could have seen it (archive) |
| **O** Observed | when this workbench fetched it |
| **M** Modified | when the source says it was edited/retracted |

The precedence axioms `E ≤ P ≤ F ≤ O`, `P ≤ M`, `E ≤ M` are checked; a violation is a `temporal_anomaly`, not a conclusion.

### T-S-C-E evidence vector

Every event/claim carries:

- **T** time precision/timezone/role,
- **S** source traceability,
- **C** independent corroboration,
- **E** snapshot/span/hash reproducibility.

The report shows the vector and a band (`low`/`medium`/`high`), not a single "credibility percentage". A single source or a syndicated copy can never be `high`.

### Date conflict classes

`hard_time` (same role, comparable precision, disjoint intervals), `role_mismatch`, `precision_mismatch`, `timezone_ambiguity`, `sequence`, `version`, `dependence`. The report says what would resolve a conflict; it does not pick a "true" date.

### Coverage statement

A negative conclusion requires a coverage statement: what was queried, where, in which window/language/domain scope, when, how many results, and what was unreachable. `not checked`, `checked and not found`, `unreachable`, and `insufficient evidence` are distinct.

## Quick start

```bash
dsh plugin --profile <profile> add dsh-sherlock
```

Ask DSH:

```text
Create a temporal case for this question: "When did Acme announce the factory closure, and why do the two sources disagree?"
I have these URLs: ...
Use chrono_case, chrono_ingest, chrono_assert, chrono_analyze, and chrono_report.
Do not decide which source is true; show the date roles, conflicts, gaps, and what would resolve them.
```

Or call the tools directly in PTC:

```js
const c = await tools.chrono_case({
  action: 'create',
  title: 'Acme closure timeline',
  question: 'When did Acme announce the closure?',
  purpose: 'internal',
  subject_type: 'organization',
  subject_name: 'Acme'
})
await tools.chrono_ingest({ case_id: c.caseId, urls: ['https://example.com/notice'] })
// Read the returned source id, then record the raw date text. Do not calculate the date.
await tools.chrono_assert({
  case_id: c.caseId,
  source_id: '<source-id>',
  event_label: 'Acme announced the closure',
  event_category: 'corporate',
  dates: [{ raw_text: '2024年3月15日', role: 'announcement' }]
})
await tools.chrono_analyze({ case_id: c.caseId, action: 'check' })
await tools.chrono_report({ case_id: c.caseId, audience: 'internal' })
```

The report tools write local files. The model should call DSH `present` with those four files; the plugin does not upload them.

## Tools

| Tool | Purpose |
|---|---|
| `chrono_case` | create/open/list a local case |
| `chrono_search` | optional discovery via DSH search; returns URLs, not evidence |
| `chrono_ingest` | freeze public URL snapshots + metadata |
| `chrono_assert` | record events and raw date assertions |
| `chrono_analyze` | conflicts, evidence vectors, timeline, gaps, coverage |
| `chrono_report` | four-file report + manifest hashes |
| `sherlock_check` | **legacy** username check; kept for existing users |
| `sherlock_sites` | **legacy** site list |

The `sherlock-osint` skill is retained for why it is now legacy. The primary workflow is `chrono-investigation`.

## Local case store

Default root: `.dsh-sherlock/chrono` under the host working directory.

```text
cases/<caseId>/
  case.json
  sources.jsonl
  events.jsonl
  dates.jsonl
  snapshots/<snapshotId>.txt
  conflicts.json
  gaps.json
  coverage.json
  reports/<reportId>/
    report.md
    timeline.csv
    sources.csv
    report.manifest.json
```

No website, server, account, or external database is created. Case IDs are generated by the plugin; the model cannot pass a filesystem path.

## Configuration

```yaml
- insert:
    - id: dsh-sherlock
      name: dsh-sherlock
      config:
        chronoRoot: .dsh-sherlock/chrono
        chronoMaxSources: 50
        chronoMaxBytes: 2097152
        chronoTimeoutMs: 15000
        chronoPerHostDelayMs: 250
        # legacy username tools
        defaultScope: core
        maxSites: 120
        concurrency: 10
        perHostDelayMs: 350
        timeoutMs: 10000
        toolTimeoutMs: 180000
        maxResponseBytes: 524288
        maxVerify: 30
        cacheTtlMs: 600000
        includeNsfw: false
        honorExclusions: true
        allowPrivateHosts: false
```

The temporal tools reject private/loopback hosts. `allowPrivateHosts` belongs to the legacy test-only path; do not enable it in a profile.

## Safety and boundaries

- Public sources only; no login, paywall, CAPTCHA, WAF bypass, or credential use.
- No self-hosted site, SaaS, crawler network, or bulk collection.
- No identity/attribution conclusion; no people search, doxxing, or high-impact decisions.
- No raw HTML/full article text in the report; short quotes + links + hashes only.
- A hash is an integrity check, not a trusted timestamp or legal opinion.
- The workbench does not decide whether a claim is true; it reports what the collected evidence supports, what conflicts, and what remains unknown.

## Legacy username tools

`sherlock_check` and `sherlock_sites` still operate on the pinned Sherlock-format manifest in `data/sites.json`, with the original six states (`claimed`, `available`, `unknown`, `blocked`, `illegal`, `unreliable`), random negative controls, and a 120-site cap. They are deprecated as a product direction; see [docs/LEGACY-USERNAME.md](docs/LEGACY-USERNAME.md) for the old behavior and data notice.

The upstream data is MIT-licensed; see `data/SHERLOCK-LICENSE` and `NOTICE`. The plugin code is Apache-2.0.

## Development

Requires Node 24.9+.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run check
npm run gate
```

`npm run gate` runs data validation, TypeScript `checkJs`, oxlint, the Node test suite, and `npm pack --dry-run`. The real DSH schema validator can be used with:

```bash
DSH_TOOLS_PATH=/path/to/dsh-tools/lib/index.js npm test
```

## Documentation

- [Time evidence model](docs/TIME-EVIDENCE-MODEL.md)
- [Legacy username behavior](docs/LEGACY-USERNAME.md)
- [Data pack and sync](docs/DATA.md)
- [Releasing](docs/RELEASING.md)
- [Benchmark notes](docs/BENCHMARK.md)
- [Plugin detail pages](docs/DETAIL.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache-2.0 for the plugin code; MIT for the legacy Sherlock-derived data. See `LICENSE`, `NOTICE`, `data/SHERLOCK-LICENSE`.
