# Changelog

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
