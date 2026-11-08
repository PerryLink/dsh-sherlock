# Contributing

## Setup

Requires Node 24.9+.

```bash
npm ci
npm run gate
```

The gate runs data validation, `tsc --checkJs`, `oxlint`, the Node test suite, and `npm pack --dry-run`.

## Pull requests

- Keep a PR to one concern.
- Add or update tests for behavior changes.
- Do not add runtime dependencies without discussing the zero-dependency design first.
- Do not add a home-grown proxy; DSH installs the process-wide proxy dispatcher.
- Keep site data in `data/`; do not fetch manifests at model-call time.
- Run `npm run gate` and include the result in the PR description.

## Data changes

Use `scripts/sync-sherlock.mjs --ref <40-hex-sha>` and follow `docs/DATA.md`. A data PR must include the upstream commit, a validation run, and a short note on any detector changes.

## Security

Do not report vulnerabilities in public issues. See `SECURITY.md`.
