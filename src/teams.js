/**
 * Team discovery and loading.
 *
 * Roots mirror the dsh skills precedence convention (lower rank wins a
 * duplicate name within one layer):
 *   100 project  <projectRoot>/.dsh/experts   (source 'project-dsh')
 *   300 custom   config.teamDirs, in order    (source 'custom')
 *   400 user     <dshHome>/experts            (source 'user-dsh')
 *   600 bundled  <packageRoot>/teams          (source 'bundled')
 *
 * A missing root is the absence of teams (skipped); an unreadable root and a
 * malformed team both fail loud with the precise path.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pluginError } from './errors.js'
import { bundledTeamsDir, dshHome, findGitRoot, templatesDir } from './paths.js'
import { validateTeam } from './manifest.js'
import { composeTeamSkill, readWorkflowTemplate } from './compose.js'

const PROJECT_RANK = 100
const CUSTOM_RANK = 300
const USER_RANK = 400
const BUNDLED_RANK = 600

async function listWorkflows() {
  try {
    const entries = await readdir(templatesDir(), { withFileTypes: true })
    return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name.slice(0, -3)).sort()
  } catch (cause) {
    throw pluginError(`dsh-experts: workflow templates directory unreadable: ${templatesDir()}`, 'DISCOVERY_FAILED', { cause })
  }
}

async function scanRoot(root, source, rank) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error !== null && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return []
    throw pluginError(`dsh-experts: team root unreadable: ${root}`, 'DISCOVERY_FAILED', { path: root, cause: error })
  }
  const teams = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    let isDir = entry.isDirectory()
    if (!isDir && entry.isSymbolicLink()) {
      // symlinked team dirs are a supported organization form; follow and
      // classify by target type (card containment is enforced separately)
      try {
        isDir = (await stat(join(root, entry.name))).isDirectory()
      } catch {
        isDir = false
      }
    }
    if (isDir) teams.push({ teamDir: resolve(join(root, entry.name)), source, rank })
  }
  return teams
}

/** Cheap name extraction for dedupe; full validation runs on winners only. */
async function readTeamName(teamDir) {
  let raw
  try {
    raw = await readFile(join(teamDir, 'team.json'), 'utf8')
  } catch (cause) {
    throw pluginError(`dsh-experts: team.json not found or unreadable in ${teamDir}`, 'TEAM_READ_FAILED', { teamDir, cause })
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw pluginError(`dsh-experts: ${join(teamDir, 'team.json')}: cannot read team name for dedupe: ${cause.message}`, 'INVALID_TEAM', { teamDir })
  }
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.name !== 'string') {
    throw pluginError(`dsh-experts: ${join(teamDir, 'team.json')}: manifest root must be a JSON object with a string "name"`, 'INVALID_TEAM', { teamDir })
  }
  return parsed.name
}

/**
 * Discover all teams across roots and return skill candidates (or an
 * incomplete observation when `signal` aborted mid-scan).
 */
export async function discoverTeams(resolved, options = {}) {
  const cwd = typeof options.cwd === 'string' ? resolve(options.cwd) : undefined
  const signal = options.signal
  const roots = []
  if (resolved.includeDefaultRoots) {
    const projectRoot = cwd === undefined ? null : await findGitRoot(cwd)
    if (projectRoot !== null) roots.push({ path: join(projectRoot, '.dsh', 'experts'), source: 'project-dsh', rank: PROJECT_RANK })
    roots.push({ path: join(dshHome(resolved.dshHome), 'experts'), source: 'user-dsh', rank: USER_RANK })
  }
  for (const dir of resolved.teamDirs) roots.push({ path: resolve(dir), source: 'custom', rank: CUSTOM_RANK })
  if (resolved.includeBundledTeams) {
    roots.push({ path: bundledTeamsDir(), source: 'bundled', rank: BUNDLED_RANK })
  }

  const availableWorkflows = await listWorkflows()
  const byName = new Map()
  let aborted = false
  scan: for (const root of roots) {
    for (const team of await scanRoot(root.path, root.source, root.rank)) {
      if (signal !== undefined && signal.aborted) {
        aborted = true
        break scan
      }
      const name = await readTeamName(team.teamDir)
      const existing = byName.get(name)
      if (existing === undefined || team.rank < existing.rank) {
        byName.set(name, team)
      }
    }
  }
  const candidates = []
  for (const team of byName.values()) {
    const manifest = await validateTeam(team.teamDir, { availableWorkflows })
    candidates.push(toCandidate(resolved, manifest, team.source, team.rank))
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name))
  return aborted ? { candidates, complete: false } : candidates
}

function toCandidate(resolved, manifest, source, rank) {
  const coordinator = manifest.experts.find((expert) => expert.role === 'coordinator')
  return {
    name: `experts-${manifest.name}`,
    description: manifest.description,
    ...(manifest.whenToUse === undefined ? {} : { whenToUse: manifest.whenToUse }),
    invocation: { modelInvocable: true, userInvocable: true },
    source,
    provider: resolved.providerName,
    resourceBase: { kind: 'directory', path: manifest.teamDir },
    rank,
    locator: { teamDir: manifest.teamDir, source, rank },
    path: join(manifest.teamDir, 'team.json'),
    metadata: {
      team: manifest.name,
      workflow: manifest.workflow,
      coordinator: coordinator.id,
      experts: manifest.experts.map((expert) => expert.id),
      expertRoster: manifest.experts.map((expert) => ({
        id: expert.id,
        role: expert.role,
        card: manifest.cards.get(expert.id),
      })),
    },
  }
}

/**
 * Load one team's full skill definition for a previously listed candidate.
 * The team is re-validated on load so edits between list() and get() surface
 * as loud errors instead of stale content.
 */
export async function loadTeam(resolved, candidate, options = {}) {
  if (candidate === null || typeof candidate !== 'object') {
    throw pluginError('dsh-experts: get() requires a candidate object from list()', 'INVALID_CONFIG')
  }
  if (options.signal !== undefined && options.signal.aborted) return undefined
  const locator = candidate.locator
  if (locator === null || typeof locator !== 'object' || typeof locator.teamDir !== 'string') {
    throw pluginError('dsh-experts: candidate locator is missing teamDir; candidates are borrowed from this provider only', 'INVALID_CONFIG')
  }
  const availableWorkflows = await listWorkflows()
  const manifest = await validateTeam(locator.teamDir, { availableWorkflows })
  const template = await readWorkflowTemplate(manifest.workflow)
  const content = composeTeamSkill(manifest, template)
  return {
    name: `experts-${manifest.name}`,
    description: manifest.description,
    ...(manifest.whenToUse === undefined ? {} : { whenToUse: manifest.whenToUse }),
    invocation: { modelInvocable: true, userInvocable: true },
    source: locator.source,
    provider: resolved.providerName,
    resourceBase: { kind: 'directory', path: manifest.teamDir },
    content,
    path: join(manifest.teamDir, 'team.json'),
    metadata: {
      team: manifest.name,
      workflow: manifest.workflow,
      coordinator: manifest.experts.find((expert) => expert.role === 'coordinator').id,
      experts: manifest.experts.map((expert) => expert.id),
      expertRoster: manifest.experts.map((expert) => ({
        id: expert.id,
        role: expert.role,
        card: manifest.cards.get(expert.id),
      })),
    },
  }
}
