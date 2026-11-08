# dsh-sherlock

Check whether a public username exists on websites, using a pinned snapshot of the Sherlock site manifest. It is built for DeepSeek Harness and returns structured, reviewable results.

## Install

```bash
dsh plugin --profile <profile> add dsh-sherlock
```

## Tools

- `sherlock_check` — check one handle on the core set (default 41 effective sites) or a broader `all` sample (single call capped at 120).
- `sherlock_sites` — list site names, detector types, and reliability tiers.

## Read the result honestly

| State | Meaning |
|---|---|
| `claimed` | Profile-shaped response; a lead, not identity proof |
| `available` | Site's not-found signal; not proof of global absence |
| `unknown` | Timeout/DNS/TLS/5xx/detector mismatch; could not check |
| `blocked` | 401/403/429/999 or WAF; not absence |
| `illegal` | Handle fails the site's format check |
| `unreliable` | The random control handle was also claimed; site rule is broken for this query |

The tool does not return page HTML. Use `web_fetch` separately if you need to verify a public profile page. NSFW sites are excluded by default. Follow applicable law and site terms; do not use this for harassment, doxxing, authentication bypass, or high-impact decisions about a person.

## Data

The bundled snapshot is pinned and includes its upstream commit and SHA-256 in `data/SOURCE.json`. Data is MIT-licensed; see `NOTICE`.
