# Temporal benchmark (local)

Run:

```bash
npm run benchmark:temporal
```

It uses a temporary local case, 100 events/dates, 50 synthetic sources, and no network. It
measures date parsing, local writes, analysis, and report generation. These are
**implementation measurements**, not claims about real-world source latency.

One run (Node 24, this repository checkout):

```json
{
  "count": 100,
  "parse10kMs": 33.7,
  "add100Ms": 53.1,
  "analyzeMs": 12.8,
  "reportMs": 15.6,
  "timeline": 100,
  "conflicts": 0,
  "gaps": 200,
  "reportFiles": 5
}
```

Real collection latency is dominated by network, robots checks, per-host delay, and retries;
benchmark it separately with a fixed public fixture set. Do not treat these numbers as a
service-level guarantee.
