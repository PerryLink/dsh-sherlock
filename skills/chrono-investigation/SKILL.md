---
name: chrono-investigation
description: Reconstruct a temporal evidence timeline from public sources with chrono_case, chrono_ingest, chrono_assert, chrono_analyze, and chrono_report. Separate event/publication/first-seen/observed/modified time, preserve uncertainty and conflicts, and never issue a true/false verdict or identity conclusion.
---

# Temporal evidence workflow

Use this skill when the user asks **when something happened**, why dates conflict, what changed over
time, or wants a reviewable timeline/report. The workbench runs locally; it does not build or host a
website, use login walls, or search for people.

## 1. Scope the question

- Define the event/claim/policy/company and the time window.
- Ask for **URLs the user already has**; search is a supplement, not the evidence.
- Reject identity/people-search, doxxing, high-impact decisions, and requests to bypass a login,
  paywall, CAPTCHA, or WAF.
- Say explicitly: this is evidence organization, not truth adjudication.

## 2. Create a case

`chrono_case({action:"create", title, question, purpose, subject_type, subject_name, from, to})`

## 3. Collect sources

`chrono_plan({case_id, subject, aliases, event, from, to})` builds a reviewable query plan; `chrono_search({case_id, plan_id})` executes it. Search results are not evidence.
`chrono_ingest({case_id, urls:[...]})` freezes a text snapshot and SHA-256. It returns source ids.
The source record contains declared dates and observed time, but **not** a conclusion.

## 4. Record dates, one event at a time

`chrono_assert({case_id, source_id, event_label, event_category, dates:[{raw_text, role}]})`

- Copy the raw date exactly; do not calculate or rewrite it.
- Choose the role: `event`, `announcement`, `effective`, `publication`, `update`, `correction`,
  `retraction`, `access`, `deadline`, `period`.
- If the date cannot be parsed, leave it; the report will mark a gap.
- A day/month is an interval, not a precise instant. Do not add precision.

## 5. Analyze

`chrono_analyze({case_id, action:"check"})` then `action:"timeline"`.

Read:
- **hard_time**: same role, comparable precision, disjoint intervals; blocking.
- **role_mismatch**: announcement vs publication vs effective; usually not a factual contradiction.
- **precision_mismatch**: year-only vs day-level; not a hard conflict.
- **timezone_ambiguity**: missing offset; report the candidate windows.
- **dependence**: same publisher/syndication; not independent corroboration.
- **gaps**: unparsed date, no timezone, blocked access, single domain.

Do not "fix" a conflict by choosing a date. Explain what would resolve it.

## 6. Report

`chrono_report({case_id, audience:"editor"|"legal"|"policy"|"internal"})`

The tool writes `report.md`, `timeline.csv`, `sources.csv`, `report.manifest.json` under the local
case. Present these files with DSH `present`; do not return raw HTML or full article text.

## 7. Language

Allowed: "在本案已收集证据范围内", "未发现反证", "存在未解决冲突", "证据不足", "单源，未独立佐证".
Forbidden: "已证实", "确凿", "真相", "假消息", "谣言", "骗局", "100% 可信", "全网都查过",
"就是本人", "同一人".
