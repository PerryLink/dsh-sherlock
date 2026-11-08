---
name: sherlock-osint
description: Find public accounts by username with sherlock_check, separate claimed from blocked/unknown, verify before attributing identity, and report findings with links and caveats.
---

# Sherlock OSINT workflow

Use this skill when the user asks whether a username exists on other sites,
wants a cross-platform presence check, or wants a handle-availability sweep.
Do not use it to authenticate, bypass a login or paywall, scrape private data,
or build a profile for harassment, doxxing, or a high-impact decision.

## 1. Scope the request

- Confirm the exact handle. Strip a leading `@`; do not guess spelling variants
  unless the user asks for permutations.
- Ask what the result is for: self-audit, brand/handle availability, or a
  public-figure check. The answer changes how much verification is warranted.
- Default to `scope: "core"`. It is a curated set of sites with usable public
  detectors. Use `scope: "all"` only when the user explicitly wants broad
  coverage; it is still capped by `max_sites` (default 120), so say that the
  result is a broad sample rather than every site.
- NSFW sites are excluded unless the user explicitly asks for them.

## 2. Run the check

Call `sherlock_check` with the handle:

```json
{ "username": "alice", "scope": "core" }
```

Useful arguments:

| Argument | Use |
|---|---|
| `sites` | Exact site names when the user names targets, e.g. `["GitHub", "GitLab"]`. |
| `scope` | `core` (default) or `all`. |
| `include_nsfw` | Only on explicit request. |
| `include_available` | When the user needs the available list, not just counts. |
| `verify` | Default true. Keeps the random negative-control probe that catches soft-404 sites. |
| `max_sites` | Lower the cap for a fast partial sweep. |

Use `sherlock_sites` first only when you need to discover valid site names or
check whether a site is in the manifest.

## 3. Read the result honestly

- `claimed`: the detector saw a profile-shaped response. This is a lead, not
  proof that the account belongs to the person the user has in mind.
- `available`: the detector saw the site's "not found" signal. This is also
  not proof; the site may have changed, blocked the request, or returned a
  generic page.
- `blocked`: bot protection, rate limiting, or an anti-bot status. Never count
  this as "not found".
- `unknown`: timeout, DNS/TLS failure, server error, or a detector mismatch.
  Retry later or narrow the scope; do not infer absence.
- `unreliable`: the random control username was also "claimed", so the site's
  detector is broken for this query. Treat the claimed result as unverified.
- `confidence`: `high` means the detector is direct and the control probe
  behaved; `medium` means the response is plausible but not confirmed; `low`
  means blocked, conflicting, or unverified.

Never turn a list of claimed URLs into a statement that they are the same
person. Different people reuse handles. Say "the handle is present on these
sites" and give the URLs.

## 4. Verify before reporting

For a high-stakes or ambiguous result, verify the strongest leads with
`web_fetch` on the public profile URL:

- Does the page actually render a profile, or is it a soft-404/login wall?
- Does the public bio/name/links plausibly match what the user already knows?
- Is the page current? Note the fetch date.
- Do not fetch private, authenticated, or paywalled content.

If `web_fetch` is unavailable or the page is blocked, report the claim as
unverified instead of filling the gap with inference.

## 5. Report format

Keep the report short and auditable:

```markdown
Checked `alice` on 41 core sites (2026-11-08).

Claimed (3): GitHub, GitLab, Keybase — links below.
Needs review (2): LinkedIn blocked (HTTP 999); Reddit timed out.
Available (35); 1 illegal-format site skipped.

Caveats: public profile URLs only; not identity proof; blocked sites are not
evidence of absence. Verify the GitHub/GitLab pages before relying on them.
```

Include:

- the exact handle and the manifest commit/date if the tool returned it;
- claimed sites with URLs and confidence;
- blocked/unknown counts and why they matter;
- what you did not check;
- the date of the check.

## 6. Boundaries

- Do not run bulk sweeps of many handles, or repeat a scan to "get around"
  rate limits. The engine already rate-limits per host; respect it.
- Do not use proxies, alternate accounts, or browser automation to evade
  blocks. A blocked result is a valid result.
- Do not collect or repeat sensitive personal data from profile pages. Link
  to the public page; do not paste addresses, phone numbers, or private
  content into the conversation.
- If the user is checking themselves, you can be more direct. If the subject
  is a third party, keep the language factual and avoid speculation.
