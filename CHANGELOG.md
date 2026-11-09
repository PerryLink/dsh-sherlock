# Changelog

## 0.5.0 — 2026-11-09

- `chrono_plan`: deterministic subject/alias/event facets, language and yearly windows; `chrono_search` can execute a plan.
- `chrono_index`: local cross-case index and filter; no hosted database.
- Redaction profiles: `internal` / `client` / `public` / `legal`; PII is redacted in labels, claims, titles and query log.
- Fixture tests for RSS/Atom, GDELT JSON, Wayback CDX, and a mock DSH job path.
- `npm run benchmark:temporal` with a local 100-event benchmark.
- 53 tests (with the real DSH schema validator).


## 0.4.0 — 2026-11-09

- Query/coverage ledger: `queries.jsonl`, channel/result/error records, report query section.
- TEG (T1–T4) now travels from source candidates into date assertions and the report.
- Per-host delay, robots.txt gate, and one retry for 429/5xx on URL ingestion.
- `chrono_diff` compares the current case to a prior report manifest.
- `chrono_verify` re-fetches a source and records hash/status drift.
- `chrono_review` records human conflict resolutions; `chrono_claim` records claims.
- Report language lint rejects verdict/identity language in user-authored labels; PII labels are flagged.
- Archive captures are stored in the case ledger.
- 48 tests (with the real DSH schema validator).


## 0.3.0 — 2026-11-09

- Added source adapters: `chrono_feed` (RSS/Atom), `chrono_gdelt` (GDELT DOC 2.0), and
  `chrono_archive` (Wayback CDX, optional/fallback-aware).
- Added `chrono_collect` for up to 50 URLs, using DSH jobs when available and a foreground fallback.
- Added `chrono_watch` for durable local watches through DSH schedule.
- Added the human `/chrono` command and a self-contained `report.html` timeline/conflict board.
- The report now has `report.html`, `report.md`, `timeline.csv`, `sources.csv`, and
  `report.manifest.json`; `presentFiles` recommends four.


## 0.2.0 — 2026-11-09

- Added the temporal evidence workbench: `chrono_case`, `chrono_ingest`, `chrono_assert`,
  `chrono_analyze`, and `chrono_report`; local case files, five clocks, T-S-C-E, conflict/gap/
  coverage analysis, and a four-file report.
- Added the `chrono-investigation` skill. The legacy `sherlock_check`/`sherlock_sites` tools remain
  for compatibility and are now documented as legacy.
- No website, server, crawler network, or identity lookup was added.


## 0.1.5 — 2026-11-09 (deprecated, not the release line)

- Workaround release published while the 0.1.4 tarball was still propagating; the
  registry later served 0.1.4 normally, so 0.1.5 is deprecated on npm.
- Use 0.1.4. No runtime behavior change.

## 0.1.4 — 2026-11-09

- Re-release from the 0.1.3 tree to attach SLSA provenance via npm trusted publishing.
  No runtime behavior change.

## 0.1.3 — 2026-11-09

- Rebuilt the npm tarball from the current `main` so the packaged docs, locale detail metadata, and
  data normalization match the repository. 0.1.2 was published from the earlier staged tarball.
- No runtime behavior change.

## 0.1.2 — 2026-11-08

- Added TypeScript/checkJs and oxlint gates.
- Hardened the runtime header filter and added security/edge tests.
- Made data validation sync-safe and added a data-sync fixture test and monthly workflow.
- Added benchmark tooling, governance docs, release/data runbooks, and Gitee release.

## 0.1.1 — 2026-11-08

- Initial public release (npm staged-publish path).
- `sherlock_check` and `sherlock_sites` tools over a pinned Sherlock manifest.
- Six result states with confidence and evidence.
- Random negative-control verification for claimed results.
- Per-host rate limiting, bounded response bodies, cancellation, and an in-memory cache.
- Optional `sherlock-osint` skill.
- 481-site data snapshot, 45 curated core names (41 effective), 47 exclusions.

## 0.1.0 — 2026-11-08

- Internal packaging iteration; not published to npm.
