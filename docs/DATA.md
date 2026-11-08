# Data pack and sync runbook

`data/sites.json` is a normalized snapshot of the upstream Sherlock manifest. `data/SOURCE.json` records the upstream commit, raw SHA-256, and counts. `data/curation.json` records the curated core set and the low-reliability heuristic list.

## Current snapshot

- Upstream: `sherlock-project/sherlock`
- Upstream commit: see `data/SOURCE.json` (`upstreamCommit`)
- Raw SHA-256: see `data/SOURCE.json`
- 481 exported sites, 47 exclusions, 19 NSFW, 417 effective, 45 core names (41 effective) at the 0.1.1/0.1.2 baseline.
- Counts are expected to change after sync; `scripts/validate-data.mjs` checks internal consistency, not the old absolute counts.

## Manual sync

```bash
node scripts/sync-sherlock.mjs --ref <40-hex-upstream-commit>
npm run check
npm test
```

The script fetches the pinned commit's `data.json` and the exclusions branch, normalizes the manifest, compiles every regex, and writes the four data files. Review the diff and run the tests before committing.

## Automated sync

`.github/workflows/sync-data.yml` runs monthly and on `workflow_dispatch`. It resolves the current upstream `master` SHA unless an explicit 40-hex ref is supplied, syncs, validates, runs tests, and opens a PR. It never auto-merges. A diff that only changes `SOURCE.fetchedAt` is ignored.

## Curation rules

- `core`: curated default set; kept small and biased toward detectors that survive a plain HTTP client.
- `lowReliability`: WAF/login-wall/fragile-detector sites; still queryable, but confidence is capped by results.
- Exclusions and NSFW are filtered at runtime by default.
- Do not add sites to core just because they are popular; verify the detector first.

## License

The upstream data is MIT. `data/SHERLOCK-LICENSE` and `NOTICE` must remain in the package.
