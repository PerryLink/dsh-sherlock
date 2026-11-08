# Benchmark

Recorded 2026-11-08 on WSL2, Node 24.22.1, no explicit proxy variables, one live run. These are **network observations**, not a site-quality ranking.

Command:

```bash
node scripts/benchmark.mjs --username blue --scope core --verify=false --timeout-ms 8000 --concurrency 10
node scripts/benchmark.mjs --username blue --scope all --max-sites 120 --verify=false --timeout-ms 8000 --concurrency 10
```

| Scope | Sites | Wall time | Claimed | Available | Blocked | Unknown |
|---|---:|---:|---:|---:|---:|---:|
| core | 41 | 22.3 s | 8 | 5 | 7 | 21 |
| all | 120 | 45.5 s | 35 | 23 | 36 | 26 |

Notes:

- `verify=false` keeps the benchmark to one request per site. The default `verify=true` adds at most `maxVerify` (30) control probes for claimed sites.
- `unknown` includes timeouts, DNS/TLS failures, and detector mismatches on this network. It is not evidence that a site is broken.
- `blocked` includes 401/403/429/999 and WAF fingerprints.
- Re-run before quoting numbers; site behaviour and local network path change.
- The default tool cap is 120 sites; full 417 is intentionally not a foreground scan in v1.
