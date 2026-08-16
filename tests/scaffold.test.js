import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { describe, it, before, after } from 'node:test'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { validateTeam } from '../src/manifest.js'
import { cleanup, tempDir, writeTeam } from './helpers.js'

const execFileAsync = promisify(execFile)
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function dirname(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i === -1 ? '.' : p.slice(0, i)
}

function runNewTeam(args) {
  return execFileAsync(process.execPath, [join(PACKAGE_ROOT, 'scripts', 'new-team.mjs'), ...args], {
    env: { ...process.env },
  })
}

describe('new-team.mjs scaffold', () => {
  let root

  before(async () => {
    root = await tempDir()
  })
  after(async () => {
    await cleanup(root)
  })

  it('creates a valid team from the bundled example', async () => {
    const { stdout } = await runNewTeam(['--name', 'my-team', '--root', root])
    assert.ok(stdout.includes('Created team "my-team"'))
    const manifest = JSON.parse(await readFile(join(root, 'my-team', 'team.json'), 'utf8'))
    assert.equal(manifest.name, 'my-team')
    const validated = await validateTeam(join(root, 'my-team'), { availableWorkflows: ['review'] })
    assert.equal(validated.experts.length, 5)
  })

  it('can copy from an explicit directory path', async () => {
    const sourceRoot = join(root, 'src-teams')
    await writeTeam(sourceRoot)
    await runNewTeam(['--name', 'copied-team', '--from', join(sourceRoot, 'demo-team'), '--root', root])
    const validated = await validateTeam(join(root, 'copied-team'), { availableWorkflows: ['review'] })
    assert.equal(validated.name, 'copied-team')
  })

  it('refuses non-kebab names', async () => {
    await assert.rejects(runNewTeam(['--name', 'Bad Name', '--root', root]), (error) =>
      error.code !== 0 && String(error.stderr).includes('kebab-case'))
  })

  it('refuses to overwrite an existing team', async () => {
    await assert.rejects(runNewTeam(['--name', 'my-team', '--root', root]), (error) =>
      error.code !== 0 && String(error.stderr).includes('already exists'))
  })

  it('rejects unknown source team', async () => {
    await assert.rejects(runNewTeam(['--name', 'x-team', '--from', 'no-such-team', '--root', root]), (error) =>
      error.code !== 0 && String(error.stderr).includes('not found'))
  })
})
