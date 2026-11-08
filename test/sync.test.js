import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const REF = 'a'.repeat(40)

test('sync script normalizes a fixture manifest and the result passes data validation', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/data.json') {
      const base = `http://127.0.0.1:${server.address().port}`
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        $schema: 'https://example.invalid/schema.json',
        'Site A': { url: `${base}/a/{}`, urlMain: `${base}/`, errorType: 'status_code', username_claimed: 'alice' },
        'Site B': { url: `${base}/b/{}`, urlMain: `${base}/`, errorType: ['message'], errorMsg: 'not found', username_claimed: 'alice' },
        'Site C': { url: `${base}/c/{}`, urlMain: `${base}/`, errorType: 'response_url', errorUrl: `${base}/missing`, isNSFW: true, username_claimed: 'alice' },
      }))
      return
    }
    if (req.url === '/exclusions.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('Site B\n')
      return
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const outDir = await mkdtemp(path.join(tmpdir(), 'dsh-sherlock-sync-'))
  try {
    await writeFile(path.join(outDir, 'curation.json'), JSON.stringify({
      schemaVersion: 1,
      lastReviewed: '2026-11-08',
      core: ['Site A'],
      lowReliability: ['Site B'],
      notes: {},
    }))
    const sync = await run(process.execPath, [
      'scripts/sync-sherlock.mjs',
      '--ref', REF,
      '--data-url', `${base}/data.json`,
      '--exclusions-url', `${base}/exclusions.txt`,
      '--out-dir', outDir,
    ], { cwd: root, timeout: 30000 })
    assert.equal(sync.status, 0, sync.stderr)
    const sites = JSON.parse(await readFile(path.join(outDir, 'sites.json'), 'utf8'))
    const source = JSON.parse(await readFile(path.join(outDir, 'SOURCE.json'), 'utf8'))
    const curation = JSON.parse(await readFile(path.join(outDir, 'curation.json'), 'utf8'))
    assert.equal(sites.sites.length, 3)
    assert.equal(source.exportedSites, 3)
    assert.equal(source.excluded, 1)
    assert.equal(source.nsfw, 1)
    assert.equal(source.effectiveDefault, 1)
    assert.equal(source.core, 1)
    assert.equal(sites.sites.find((site) => site.name === 'Site A').tier, 'core')
    assert.equal(sites.sites.find((site) => site.name === 'Site B').excluded, true)
    assert.equal(sites.sites.find((site) => site.name === 'Site B').reliability, 'low')
    assert.equal(sites.sites.find((site) => site.name === 'Site C').nsfw, true)
    assert.deepEqual(curation.core, ['Site A'])
    assert.deepEqual(curation.lowReliability, ['Site B', 'Site C'])
    const validate = spawnSync(process.execPath, ['scripts/validate-data.mjs', '--data-dir', outDir], { cwd: root, encoding: 'utf8', timeout: 30000 })
    assert.equal(validate.status, 0, validate.stderr)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(outDir, { recursive: true, force: true })
  }
})

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`timed out: ${command} ${args.join(' ')}`))
    }, options.timeout)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }) })
  })
}
