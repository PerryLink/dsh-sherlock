# dsh-sherlock

[![CI](https://github.com/PerryLink/dsh-sherlock/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-sherlock/actions/workflows/ci.yml)

Sherlock-compatible public username checks for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

It turns the [Sherlock](https://github.com/sherlock-project/sherlock) site manifest into a DSH-native bundle with two tools and an on-demand skill. It is deliberately **not** a 1:1 port of the Python CLI: blocked, unknown, and unreliable results stay separate from claimed and available ones.

> Not affiliated with or endorsed by the Sherlock project. The name describes compatibility with its site-manifest format.

## What it does

- `sherlock_check` checks one public handle across a pinned snapshot of 481 sites.
- `sherlock_sites` lists site names, detector types, and reliability tiers so the model can choose targets.
- `sherlock-osint` skill explains the six result states, verification, reporting, and boundaries.

Default scope is a curated **core set of 41 effective sites** (45 names minus 4 exclusions). `scope: "all"` broadens the sample, but a single call is capped at **120** sites. NSFW sites are off by default.

## Install

```bash
# npm
dsh plugin --profile <profile> add dsh-sherlock

# GitHub (no build step, no allowBuilds)
dsh plugin --profile <profile> add github:PerryLink/dsh-sherlock#<40-hex-sha>

# local checkout
dsh plugin --profile <profile> add ./dsh-sherlock
```

Verify the layer:

```bash
dsh --profile <profile> --dump-config | grep -A2 dsh-sherlock
```

Then ask DSH:

```text
Check whether the handle "alice" exists on the core sites and summarize the leads.
```

Or call the tool directly in PTC:

```js
await tools.sherlock_check({ username: 'alice', scope: 'core' })
```

## Result states

| State | Meaning | How to treat it |
|---|---|---|
| `claimed` | A profile-shaped response | A lead, not proof of identity |
| `available` | The site's not-found signal | Not proof the handle is unused everywhere |
| `unknown` | Timeout, DNS/TLS, 5xx, detector mismatch | Could not check; do not infer absence |
| `blocked` | 401/403/429/999 or WAF | Blocked; do not infer absence |
| `illegal` | Handle fails the site's `regexCheck` | Site does not allow this format |
| `unreliable` | The random control handle was also "claimed" | Site rule is broken for this query |

`confidence` is `high`, `medium`, or `low`; `evidence` records the HTTP status, detector, redirects, and control result without returning page HTML.

## Configuration

Set config on the plugin row in your profile patch:

```yaml
- insert:
    - id: dsh-sherlock
      name: dsh-sherlock
      config:
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
```

| Key | Default | Notes |
|---|---|---|
| `defaultScope` | `core` | `core` or `all` |
| `maxSites` | `120` | Hard cap |
| `concurrency` | `10` | 1–50 |
| `perHostDelayMs` | `350` | Per-host serialization + delay |
| `timeoutMs` | `10000` | Per request |
| `toolTimeoutMs` | `180000` | Cooperative tool deadline |
| `maxResponseBytes` | `524288` | Body cap; message matching stops at the cap |
| `maxVerify` | `30` | Random negative-control probes for claimed results |
| `cacheTtlMs` | `600000` | Claimed/available; blocked/unknown use at most 60s |
| `includeNsfw` | `false` | Deployment default |
| `honorExclusions` | `true` | Upstream false-positive exclusions |
| `userAgent` | package UA | Transparent by default |
| `manifestPath` | bundled data | Advanced/testing; no model-supplied URL |

Network proxies are handled by DSH: export `HTTPS_PROXY` / `HTTP_PROXY` before launching `dsh`; the plugin uses plain `fetch` and inherits the process-wide dispatcher. Do not pass a proxy from the model.

## Safety

- Public pages only; no login, paywall, captcha bypass, or credential use.
- The tool never returns raw HTML; fetch a profile page separately with `web_fetch` if you need to verify it.
- URL templates are vendored and validated; redirects are checked; private/loopback destinations are rejected unless a test explicitly enables them.
- Header allowlist: `Cookie`, `Authorization`, and `Host` are dropped.
- Per-host rate limiting, a 512 KB body cap, and bounded concurrency are on by default.
- No bulk scanning, WAF evasion, or high-impact decision support.

Use responsibly and follow the target sites' terms and applicable law.

## Data

`data/sites.json` is a normalized snapshot of the Sherlock manifest. It records the upstream commit, raw SHA-256, and counts in `data/SOURCE.json`. The data is MIT-licensed; see `data/SHERLOCK-LICENSE` and `NOTICE`.

The data is pinned so installs are reproducible. Update it with `scripts/sync-sherlock.mjs` (maintainers) and publish a patch release after review. Do not fetch the manifest at model-call time.

## Development

Requires Node 24.9+.

```bash
npm ci
npm run typecheck        # tsc --checkJs, no emit
npm run lint             # oxlint
npm test                 # node --test, fixture server only
npm run check            # data-pack validation
npm run pack:check       # npm pack --dry-run
npm run gate             # all of the above
```

Tests cover status codes, messages, response URLs, WAF, redirects, POST payloads, custom headers, timeouts, body caps, exclusions, negative controls, caching, private-host rejection, abort cancellation, array detectors, tool schemas, and data integrity. The real DSH schema validator can be used with:

```bash
DSH_TOOLS_PATH=/path/to/dsh-tools/lib/index.js npm test
```

Live benchmark (network requests; not part of CI):

```bash
node scripts/benchmark.mjs --username blue --scope core --verify=false
```

## More documentation

- [Data pack and sync runbook](docs/DATA.md)
- [Release runbook](docs/RELEASING.md)
- [Benchmark notes](docs/BENCHMARK.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache-2.0 for the plugin code; MIT for the Sherlock-derived data. See `LICENSE`, `NOTICE`, and `data/SHERLOCK-LICENSE`.
