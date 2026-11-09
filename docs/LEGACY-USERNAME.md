# Legacy username tools

`dsh-sherlock` began as a pinned Sherlock-manifest username checker. The product direction is now
temporal evidence, but `sherlock_check` and `sherlock_sites` remain for existing users.

## What they do

- `sherlock_check` checks one public handle against a pinned snapshot of the Sherlock manifest.
- `sherlock_sites` lists site names, detector types, reliability tiers, and NSFW flags.
- Default scope is the curated core set (41 effective sites); `all` is capped at 120 per call.
- The six result states are `claimed`, `available`, `unknown`, `blocked`, `illegal`, and
  `unreliable`; `blocked`/`unknown` are not evidence of absence.
- Random negative controls detect soft-404 sites; the tool never returns raw HTML.

## Status

These tools are **legacy** and are not the primary product workflow. New work should use
`chrono_case`/`chrono_ingest`/`chrono_assert`/`chrono_analyze`/`chrono_report`.

## Data

`data/sites.json` is a normalized snapshot of the upstream Sherlock manifest. It records the
upstream commit, raw SHA-256, and counts in `data/SOURCE.json`. The data is MIT-licensed; see
`data/SHERLOCK-LICENSE` and `NOTICE`. The plugin code is Apache-2.0.

## Safety

- Public pages only; no login, paywall, CAPTCHA, or WAF bypass.
- Private/loopback destinations are rejected unless a test explicitly enables them.
- Headers are allowlisted; `Cookie`, `Authorization`, and `Host` are dropped.
- Per-host rate limiting, bounded response bodies, and cancellation are on by default.
- No bulk scanning, no identity conclusion, no high-impact decision support.

The legacy behavior is described in more detail in the project history and the `sherlock-osint`
skill. It is retained for compatibility, not recommended for new investigations.
