#!/usr/bin/env node
/**
 * Scaffold a new expert team from an existing one (default: the bundled
 * web-review example). Writes into a teams root (default: <dshHome>/experts).
 *
 * Usage:
 *   node scripts/new-team.mjs --name my-team [--from web-review] [--root <dir>]
 */

import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..')

function dirname(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i === -1 ? '.' : p.slice(0, i)
}

function usage(code = 1) {
  process.stdout.write(
    'Usage: node scripts/new-team.mjs --name <kebab-team-name> [--from <source-team>] [--root <teams-root-dir>]\n' +
      '  --name  new team name (kebab-case, required)\n' +
      '  --from  team to copy (default: web-review; bundled teams or a team dir path)\n' +
      '  --root  destination teams root (default: <dshHome>/experts, i.e. $DSH_HOME or ~/.dsh)\n',
  )
  process.exit(code)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') usage(0)
    const take = (flag) => {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) {
        process.stderr.write(`${flag} requires a value\n`)
        usage(2)
      }
      return value
    }
    if (arg === '--name') out.name = take('--name')
    else if (arg === '--from') out.from = take('--from')
    else if (arg === '--root') out.root = take('--root')
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`)
      usage(2)
    }
  }
  return out
}

function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return join(homedir(), '.dsh')
}

async function resolveSourceTeam(from) {
  if (from === undefined) return join(PACKAGE_ROOT, 'teams', 'web-review')
  if (existsSync(from)) return resolve(from)
  const bundled = join(PACKAGE_ROOT, 'teams', from)
  if (existsSync(bundled)) return bundled
  process.stderr.write(`Source team not found: ${from} (not a path, not a bundled team)\nBundled teams: `)
  const bundledTeams = (await readdir(join(PACKAGE_ROOT, 'teams'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .join(', ')
  process.stderr.write(`${bundledTeams}\n`)
  process.exit(2)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.name === undefined) {
    process.stderr.write('--name is required\n')
    usage(2)
  }
  if (!KEBAB.test(args.name)) {
    process.stderr.write(`Team name must be kebab-case (a-z, 0-9, hyphen), got: ${args.name}\n`)
    process.exit(2)
  }
  const sourceDir = await resolveSourceTeam(args.from)
  const root = args.root !== undefined ? resolve(args.root) : join(dshHome(), 'experts')
  const target = join(root, args.name)

  if (existsSync(target)) {
    process.stderr.write(`Target already exists: ${target}\n`)
    process.exit(2)
  }
  const sourceStat = await stat(sourceDir)
  if (!sourceStat.isDirectory()) {
    process.stderr.write(`Source is not a directory: ${sourceDir}\n`)
    process.exit(2)
  }

  await mkdir(root, { recursive: true })
  await cp(sourceDir, target, { recursive: true })

  const manifestPath = join(target, 'team.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.name = args.name
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  process.stdout.write(`Created team "${args.name}" at ${target}\n`)
  process.stdout.write(`Copied from: ${sourceDir}\n\n`)
  process.stdout.write('Next steps:\n')
  process.stdout.write(`  1. Edit ${manifestPath} (description, experts, escalations)\n`)
  process.stdout.write(`  2. Edit the persona cards under ${join(target, 'experts')}\n`)
  process.stdout.write(`  3. Validate: node ${join(PACKAGE_ROOT, 'scripts', 'validate-team.mjs')} ${target}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
