# Time Evidence Model (TEM-5T)

This is the first-party model behind the temporal investigation tools. It is intentionally
independent of Sherlock's site manifest: no self-hosted sites, no crawler network, no identity
lookup. The workbench reads public sources the user or the DSH search provider supplies.

## 1. Five clocks

Every date assertion must name one clock. They are never collapsed into a single "date":

| Axis | Meaning | Examples |
|---|---|---|
| **E** Event | when the asserted event happened or took effect | "the shutdown began on 15 March" |
| **P** Publication | when the assertion was first made public | JSON-LD `datePublished`, RSS `pubDate` |
| **F** First seen | earliest proof that anyone could have seen it | archive capture, Common Crawl WARC, urlscan |
| **O** Observed | when this workbench fetched it | local UTC clock + snapshot hash |
| **M** Modified | when the source says it was edited/retracted | `dateModified`, edit history, snapshot diff |

The precedence axioms:

```text
E <= P <= F <= O
P <= M
E <= M
```

A violation is a `temporal_anomaly`, not a conclusion. `E > P` may be a forecast; `P > F` may be a
backdated claim, a timezone error, or a stale snapshot; `M < P` usually means a template bug.

## 2. Time evidence grade (TEG)

| Grade | Source of the time value | Examples |
|---|---|---|
| T1 | machine-generated, recomputable | Snowflake/ULID decode, server timestamp, RFC 3161 token, blockchain height |
| T2 | publisher declaration | JSON-LD, OpenGraph, `<time datetime>` |
| T3 | third-party witness | Wayback/CDX capture, Common Crawl WARC, certificate transparency |
| T4 | inferred | "yesterday", "recently", relative-date arithmetic |

`precision` is orthogonal: `year`, `quarter`, `month`, `week`, `day`, `hour`, `minute`, `second`,
`unknown`. A day-precision value is an interval, never `T00:00:00Z` masquerading as a second.

## 3. T-S-C-E evidence vector

Every event/claim in a report carries four scores and a band; there is no single "credibility
percentage":

| Axis | Question | 0 | 1 | 2 | 3 |
|---|---|---|---|---|---|
| T | how precise and role-separated is the time? | none | year/relative unanchored | day/month + timezone/role | primary instant/interval with role |
| S | how traceable is the source? | anonymous/no snapshot | single secondary | named media/official, not primary | primary record, traceable |
| C | how independent is the corroboration? | none | syndication only | 2+ independent secondary | 2+ independent sources incl. primary |
| E | how reproducible is the evidence? | assertion only | snapshot, no span/hash | span + hash + live/archive | primary artifact + span + hash + reproducible fetch |

```text
high   = T>=2 && S>=3 && C>=2 && E==3 && no unresolved blocking conflict
medium = T>=1 && S>=2 && C>=1 && E>=2 && no unresolved blocking conflict
low    = otherwise
```

A single source or a syndicated copy can never be `high`. An unresolved blocking conflict caps the
band at `low`; an unresolved material conflict caps it at `medium`.

## 4. Date roles and conflict classes

Roles: `event`, `announcement`, `effective`, `publication`, `update`, `correction`, `retraction`,
`access`, `deadline`, `period`.

Conflict classes:

| Class | Meaning | Hard? |
|---|---|---|
| `hard_time` | same role, comparable precision, disjoint intervals | yes |
| `role_mismatch` | one is a publication date, one is an event/effective date | no |
| `precision_mismatch` | year-only vs day-level, intervals overlap | no |
| `timezone_ambiguity` | no timezone or conflicting timezone | unresolved |
| `sequence` | before/after relation impossible | maybe |
| `version` | update/correction/retraction | no |
| `dependence` | same publisher/syndicated copy, not independent evidence | no |

The workbench reports what would resolve each conflict (a primary record, a timezone, an earlier
snapshot, etc.). It never picks a "true" date.

## 5. Coverage statement

A negative statement is only allowed with a coverage statement:

- query/URL, channel, time range, language/region, domain scope;
- executed-at timestamp, result count/sampling;
- known blind spots (login walls, deleted pages, unindexed archives).

`not checked`, `checked and not found`, `unreachable`, and `insufficient evidence` are distinct.

## 6. Report contract

Five artifacts; the first four are the recommended `present` set:

```text
report.html            self-contained timeline/conflict board (no server, no external assets)
report.md              human-readable, with limitations and what would change the conclusion
timeline.csv           interval/precision/timezone/role/T-S-C-E/citations
sources.csv            source cards with snapshot hashes and access status
report.manifest.json   files, snapshots, citations, rule versions, model runs, coverage
```

No raw HTML, no full article text, no identity/attribution conclusions, no `true/false` verdict.

## 7. Non-goals

- no self-hosted website/service/site network;
- no identity lookup, people search, doxxing, or high-impact decisions;
- no login/paywall/CAPTCHA/WAF bypass;
- no mass crawling or bulk enumeration;
- no claim that a hash is a trusted timestamp or a legal opinion.
