# Security policy

## Supported versions

The latest 0.1.x release receives security fixes. Older versions may not.

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories:
https://github.com/PerryLink/dsh-sherlock/security/advisories/new

Do not open a public issue for a suspected vulnerability, and do not include tokens, cookies, or personal data in a report.

## Scope

Relevant reports include:

- SSRF or private-address bypass in the probe path.
- Header injection or credential leakage beyond the allowlist.
- A way for model-supplied arguments to reach an arbitrary URL or file.
- Denial of service through unbounded response bodies, concurrency, or recursion.
- Supply-chain or package-content issues.

The project intentionally does not bypass authentication, paywalls, CAPTCHAs, or WAFs. Reports asking for evasion features are out of scope.

## Operational guidance

- Run the plugin only in profiles you trust; plugins execute in the DSH host process.
- Use DSH's process-wide proxy variables; do not pass credentials to the model.
- Treat profile HTML as untrusted data and use `web_fetch` separately for verification.
