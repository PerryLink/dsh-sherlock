# Release runbook

## Preconditions

- Node 24.9+.
- `npm ci` and all gates green:
  ```bash
  npm run gate
  ```
- Working tree clean.
- The version in `package.json` is the intended release.
- You have npm publish permission and 2FA/security-key access.

## npm

npm now uses **staged publishing** for new packages and some accounts:

```bash
npm stage publish --registry=https://registry.npmjs.org/ --access public
# prints a stage id
npm stage list dsh-sherlock --registry=https://registry.npmjs.org/
npm stage approve <stage-id> --registry=https://registry.npmjs.org/
```

`approve` requires 2FA. A non-interactive shell may print a masked one-time URL; run the command in a TTY and complete the browser/security-key flow, or pass `--otp` with a current authenticator code. Never paste an OTP or token into a file, issue, commit, or chat.

After publish:

```bash
npm view dsh-sherlock version dist-tags --registry=https://registry.npmjs.org/
```

If `latest` points at a placeholder, fix only the tag:

```bash
npm dist-tag add dsh-sherlock@<version> latest --registry=https://registry.npmjs.org/
```

Do not republish a version that npm has already accepted; bump the patch version instead.

## GitHub

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
gh release create vX.Y.Z --title "dsh-sherlock vX.Y.Z" --notes-file CHANGELOG.md
```

The `publish.yml` workflow is manual and needs an `NPM_TOKEN` repository secret if you want CI publishing with provenance. Do not make tags auto-publish until that secret/trusted publishing is configured.

## Gitee mirror

The Gitee mirror is a read-only distribution copy. After the GitHub release:

```bash
git push gitee main master --force
git push gitee vX.Y.Z
```

Use the credential helper from the workspace; never put the Gitee token in the remote URL.

## Post-release

- Verify npm install into a throwaway DSH profile:
  ```bash
  dsh plugin --profile release-check add dsh-sherlock@X.Y.Z
  dsh --profile release-check --dump-config
  ```
- Update the plugin index entry (if listed) with the new version.
- Record the data commit and benchmark date in the release notes.
