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

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
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
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
    teams.push({ teamDir: join(root, entry.name), source, rank })
  }
  return teams
}

/**
 * Discover all teams across roots and return skill candidates (or an
 * incomplete observation when `signal` aborted mid-scan).
 */
export async function discoverTeams(resolved, options = {}) {
  const cwd = typeof options.cwd === 'string' ? options.cwd : undefined
  const signal = options.signal
  const roots = []
  if (resolved.includeDefaultRoots) {
    const projectRoot = cwd === undefined ? null : await findGitRoot(cwd)
    if (projectRoot !== null) roots.push({ path: join(projectRoot, '.dsh', 'experts'), source: 'project-dsh', rank: PROJECT_RANK })
    roots.push({ path: join(dshHome(resolved.dshHome), 'experts'), source: 'user-dsh', rank: USER_RANK })
  }
  for (const dir of resolved.teamDirs) roots.push({ path: dir, source: 'custom', rank: CUSTOM_RANK })
  if (resolved.includeBundledTeams) {
    roots.push({ path: bundledTeamsDir(), source: 'bundled', rank: BUNDLED_RANK })
  }

  const availableWorkflows = await listWorkflows()
  const byName = new Map()
  let aborted = false
  scan: for (const root of roots) {
    for (const { teamDir, source, rank } of await scanRoot(root.path, root.source, root.rank)) {
      if (signal !== undefined && signal.aborted) {
        aborted = true
        break scan
      }
      const manifest = await validateTeam(teamDir, { availableWorkflows })
      const existing = byName.get(manifest.name)
      if (existing === undefined || rank < existing.rank) {
        byName.set(manifest.name, { manifest, source, rank })
      }
    }
  }
  const candidates = [...byName.values()]
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
    .map(({ manifest, source, rank }) => toCandidate(resolved, manifest, source, rank))
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
    ...(manifest.teamDir === undefined ? {} : { resourceBase: { kind: 'directory', path: manifest.teamDir } }),
    content,
    path: join(manifest.teamDir, 'team.json'),
    metadata: {
      team: manifest.name,
      workflow: manifest.workflow,
      coordinator: manifest.experts.find((expert) => expert.role === 'coordinator').id,
      experts: manifest.experts.map((expert) => expert.id),
    },
  }
}
