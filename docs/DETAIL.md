# dsh-sherlock

A temporal evidence workbench for DeepSeek Harness. It turns public URLs into a local, reviewable
timeline: frozen snapshots, separated time roles, date conflicts, gaps, coverage, and a four-file
report. It does not host a website, search for people, or decide whether a claim is true.

## Install

```bash
dsh plugin --profile <profile> add dsh-sherlock
```

## Workflow

1. `chrono_case` — create a local case.
   Optional: `chrono_search` discovers candidate URLs through DSH's configured search provider.
2. `chrono_ingest` — freeze 1–10 public URLs with text snapshots and SHA-256.
3. `chrono_assert` — record an event and raw date assertions with a role.
4. `chrono_analyze` — read conflicts, T-S-C-E evidence, timeline, gaps, and coverage.
5. `chrono_report` — write `report.md`, `timeline.csv`, `sources.csv`, and
   `report.manifest.json`; present them with DSH `present`.

The `chrono-investigation` skill carries the method. The earlier `sherlock_check` / `sherlock_sites`
username tools remain as legacy compatibility.

## Five clocks

Event, publication, first-seen, observed, and modified time are stored separately. A day is an
interval with a precision and timezone, not a fake exact instant. A missing timezone is reported,
not silently replaced with UTC.

## Honest output

- T-S-C-E vector and band, not one credibility percentage.
- `hard_time` / `role_mismatch` / `precision_mismatch` / `timezone_ambiguity` / `dependence`.
- `not checked`, `checked and not found`, `unreachable`, and `insufficient evidence` are distinct.
- No `true/false` verdict, no identity conclusion, no raw HTML, no full article text.

## Boundaries

Public sources only; no login, paywall, CAPTCHA, or WAF bypass. No self-hosted service, crawler
network, bulk collection, people search, doxxing, or high-impact decisions. A report hash is an
integrity check, not a trusted timestamp or legal opinion.
