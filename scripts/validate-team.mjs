#!/usr/bin/env node
/**
 * Standalone team validator — runs the exact same validation the engine's
 * skill provider runs at discovery, so users can check a team before dropping
 * it into a teams root. Validates every directory, reports each failure with
 * its file and reason, and exits non-zero if any failed.
 *
 * Usage: node scripts/validate-team.mjs <teamDir> [<teamDir> ...]
 */

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTeam } from '../src/manifest.js'

const SCRIPT_DIR = dirnameOf(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..')

function dirnameOf(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i === -1 ? '.' : p.slice(0, i)
}

async function availableWorkflows() {
  const entries = await readdir(join(PACKAGE_ROOT, 'templates'), { withFileTypes: true })
  return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name.slice(0, -3)).sort()
}

async function main() {
  const dirs = process.argv.slice(2)
  if (dirs.length === 0) {
    process.stderr.write('Usage: node scripts/validate-team.mjs <teamDir> [<teamDir> ...]\n')
    process.exit(2)
  }
  const workflows = await availableWorkflows()
  let failures = 0
  for (const dir of dirs) {
    const teamDir = resolve(dir)
    try {
      const manifest = await validateTeam(teamDir, { availableWorkflows: workflows })
      const coordinator = manifest.experts.find((e) => e.role === 'coordinator').id
      process.stdout.write(
        `ok ${manifest.name}: workflow=${manifest.workflow} experts=[${manifest.experts.map((e) => e.id).join(', ')}] coordinator=${coordinator} escalations=${manifest.escalations.length}\n`,
      )
    } catch (error) {
      failures += 1
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
