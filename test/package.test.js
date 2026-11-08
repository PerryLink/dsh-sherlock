import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

test('package manifest is installable as a DSH bundle', () => {
  assert.equal(pkg.name, 'dsh-sherlock')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.main, 'index.js')
  assert.ok(pkg.files.includes('data'))
  assert.ok(pkg.files.includes('skills'))
  assert.ok(pkg.files.includes('locale'))
  assert.ok(pkg.files.includes('docs'))
  assert.ok(pkg.engines?.dsh && pkg.engines?.node)
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.peerDependencies, undefined)
})

test('bundle patch, entry point, and declared files exist', () => {
  const patch = readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: dsh-sherlock/)
  assert.match(patch, /name: dsh-sherlock/)
  assert.ok(existsSync(path.join(root, 'index.js')))
  for (const file of pkg.files) {
    assert.ok(existsSync(path.join(root, file)), `missing published file: ${file}`)
  }
})

test('plugin display metadata points at packaged detail documents', () => {
  for (const [locale, detail] of [['en', 'docs/DETAIL.md'], ['zh', 'docs/DETAIL.zh.md']]) {
    const meta = JSON.parse(readFileSync(path.join(root, 'locale', `${locale}.json`), 'utf8')).meta
    assert.equal(meta.detail, detail)
    assert.ok(existsSync(path.join(root, detail)), `${detail} missing`)
    assert.ok(meta.title && meta.description)
  }
  const icon = statSync(path.join(root, 'icon.svg'))
  assert.ok(icon.size > 0 && icon.size < 256 * 1024)
})

test('skill is present and has the expected frontmatter name', () => {
  const skill = readFileSync(path.join(root, 'skills/sherlock-osint/SKILL.md'), 'utf8')
  assert.match(skill, /^---\nname: sherlock-osint\n/)
  assert.match(skill, /description:/)
})

test('published text does not contain obvious credential patterns', () => {
  for (const file of pkg.files) {
    const full = path.join(root, file)
    if (!statSync(full).isFile()) continue
    if (!/\.(md|json|js|mjs|yml|yaml|svg|txt|LICENSE|NOTICE)$/i.test(file)) continue
    const text = readFileSync(full, 'utf8')
    assert.doesNotMatch(text, /ghp_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|glm_[A-Za-z0-9]{20,}/, file)
  }
})
