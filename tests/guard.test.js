/**
 * Guard tests — machine-enforced conventions from CLAUDE.md.
 * Each test maps to a row in the constitution's 技术硬约定 table.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateTeam } from '../src/manifest.js'
import { ERROR_CODES } from '../src/errors.js'
import { bundledTeamsDir, templatesDir } from '../src/paths.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function dirname(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i === -1 ? '.' : p.slice(0, i)
}

async function listFiles(dir, filter = () => true, accumulator = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') await listFiles(full, filter, accumulator)
    else if (filter(full)) accumulator.push(full)
  }
  return accumulator
}

/** Files belonging to this package (excludes anything under a nested node_modules). */
function ownsPackage(file) {
  return !relative(PACKAGE_ROOT, file).split(sep).includes('node_modules')
}

describe('guard: package manifest', () => {
  it('zero runtime and dev dependencies (Node stdlib only)', async () => {
    const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    assert.deepEqual(pkg.dependencies ?? {}, {}, 'dependencies must be empty')
    assert.deepEqual(pkg.devDependencies ?? {}, {}, 'devDependencies must be empty')
  })

  it('files/ covers every runtime path the patch layer references', async () => {
    const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    for (const required of ['src', 'teams', 'templates', 'scripts', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
      assert.ok(pkg.files.includes(required), `files[] missing ${required}`)
    }
    assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
    assert.equal(pkg.exports['.'], './src/index.js')
    assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml')
  })

  it('cordis.patch.yml registers this plugin via insert with env-overridable config', async () => {
    const patch = await readFile(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
    assert.ok(patch.includes('- insert:'), 'patch must be an insert list')
    assert.ok(patch.includes('id: dsh-experts'))
    assert.ok(patch.includes('name: dsh-experts'))
  })

  it('declares Node >=18 engine', async () => {
    const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    assert.ok(/^>=18/.test(pkg.engines.node))
  })
})

describe('guard: source conventions', () => {
  it('src/ has no console output and no bare `throw new Error(`', async () => {
    const files = await listFiles(join(PACKAGE_ROOT, 'src'), (f) => f.endsWith('.js'))
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      assert.ok(!text.includes('console.'), `${file} uses console`)
      assert.ok(!text.includes('throw new Error('), `${file} must use pluginError (errors.js)`)
    }
  })

  it('every src module imports cleanly (syntax smoke)', async () => {
    const files = await listFiles(join(PACKAGE_ROOT, 'src'), (f) => f.endsWith('.js'))
    for (const file of files) {
      await import(pathToFileURL(file).href)
    }
  })

  it('src/ stays plain JavaScript: no .ts files, no tsconfig, no build step', async () => {
    const files = await listFiles(join(PACKAGE_ROOT, 'src'))
    assert.ok(files.length > 0, 'src/ scan found nothing — the guard would be a no-op')
    for (const file of files) assert.ok(!file.endsWith('.ts'), `${file} must be .js (plain ESM, no build step)`)
    await assert.rejects(stat(join(PACKAGE_ROOT, 'tsconfig.json')), (e) => e.code === 'ENOENT')
  })

  it('error codes used across src/ stay in sync with the declared vocabulary', async () => {
    const declared = new Set(ERROR_CODES)
    // Shape-filtered so fs codes compared inline ('ENOENT', 'EACCES', ...) are
    // not mistaken for plugin error codes; every plugin code matches one shape.
    const CODE_SHAPE = /^(INVALID_[A-Z_]+|[A-Z_]+_FAILED|TEMPLATE_MISSING|DISCOVERY_FAILED)$/
    const used = new Set()
    const files = await listFiles(join(PACKAGE_ROOT, 'src'), (f) => f.endsWith('.js') && !f.endsWith('errors.js'))
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      for (const match of text.matchAll(/,\s*'([A-Z][A-Z_]{3,})'/g)) {
        if (CODE_SHAPE.test(match[1])) used.add(match[1])
      }
    }
    for (const code of used) assert.ok(declared.has(code), `code ${code} is used in src but missing from ERROR_CODES (errors.js)`)
    for (const code of declared) assert.ok(used.has(code), `code ${code} is declared in ERROR_CODES but never used`)
  })

  it('text files carry no UTF-8 BOM', async () => {
    const files = await listFiles(PACKAGE_ROOT, (f) => /\.(js|mjs|json|md|yml)$/.test(f) && ownsPackage(f))
    assert.ok(files.length > 10, 'BOM scan found suspiciously few files — the guard would be a no-op')
    for (const file of files) {
      const buf = await readFile(file)
      assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), `${file} starts with a BOM`)
    }
  })
})

describe('guard: bundled teams', () => {
  it('every bundled team validates and ships TEAM.md', async () => {
    const workflows = (await readdir(templatesDir(), { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name.slice(0, -3))
    for (const entry of await readdir(bundledTeamsDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const teamDir = join(bundledTeamsDir(), entry.name)
      const manifest = await validateTeam(teamDir, { availableWorkflows: workflows })
      assert.equal(manifest.name, entry.name)
      const prose = await stat(join(teamDir, 'TEAM.md'))
      assert.ok(prose.isFile(), `${entry.name} must ship TEAM.md`)
      for (const expert of manifest.experts) {
        const card = manifest.cards.get(expert.id)
        assert.ok(!card.includes('````'), `${entry.name}/${expert.id} card contains a four-backtick fence`)
      }
    }
  })

  it('workflow templates declare all engine placeholders', async () => {
    const templates = (await readdir(templatesDir(), { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
    assert.ok(templates.length > 0, 'no workflow templates shipped')
    for (const name of templates) {
      const text = await readFile(join(templatesDir(), name), 'utf8')
      for (const placeholder of ['{{TEAM_NAME}}', '{{COORDINATOR_ID}}', '{{FINDINGS_SCHEMA}}', '{{REPORT_LANGUAGE}}']) {
        assert.ok(text.includes(placeholder), `${name} lost ${placeholder}`)
      }
    }
  })

  it('constitution and delivery docs exist', async () => {
    for (const doc of ['CLAUDE.md', 'README.md', 'SECURITY.md', 'CHANGELOG.md', 'LICENSE']) {
      await stat(join(PACKAGE_ROOT, doc))
    }
  })
})
