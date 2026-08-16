/**
 * Strict team manifest (team.json) validation.
 *
 * Teams are DATA, never code: the accepted schema is a closed set of fields,
 * unknown keys are rejected as typos, every file reference must resolve inside
 * the team directory, and every cross-reference must name a roster expert.
 * Validation failures throw INVALID_TEAM with the file path and the exact
 * reason — never silently drop a team.
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pluginError } from './errors.js'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PRIORITIES = ['P0', 'P1', 'P2']
const EXPERT_KEYS = ['id', 'role', 'card', 'modelHint']
const ESCALATION_KEYS = ['from', 'to', 'when', 'priority']
const MANIFEST_KEYS = ['name', 'description', 'whenToUse', 'workflow', 'experts', 'escalations', 'reportLanguage']
const MAX_EXPERTS = 8
const MAX_DESCRIPTION = 500
const MAX_CARD_BYTES = 32 * 1024
const MAX_TEAM_PROSE_BYTES = 64 * 1024

function fail(teamDir, message) {
  throw pluginError(`dsh-experts: ${join(teamDir, 'team.json')}: ${message}`, 'INVALID_TEAM', { teamDir })
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Free-text fields that are interpolated into the skill body (tables, headers)
 * must stay single-line and pipe-free, or they could forge markdown structure.
 */
function assertSafeInlineText(teamDir, value, field) {
  if (/[\n\r|]/.test(value)) {
    fail(teamDir, `${field} must be a single line without "|" (would break markdown structure): ${JSON.stringify(value)}`)
  }
}

function rejectUnknownKeys(teamDir, object, allowed, where) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    fail(teamDir, `unknown key(s) ${unknown.join(', ')} in ${where}; allowed: ${allowed.join(', ')}`)
  }
}

/**
 * Verify a card path stays inside the team directory after normalization and
 * symlink resolution. Absolute paths, drive-prefixed paths (`C:foo` is
 * drive-relative on win32 and escapes via resolve), NUL bytes, and `..`
 * escapes are rejected on every platform.
 */
async function assertInsideTeamDir(teamDir, cardPath) {
  if (typeof cardPath !== 'string' || cardPath.trim() === '') {
    fail(teamDir, `expert card must be a non-empty relative path, got ${JSON.stringify(cardPath)}`)
  }
  if (cardPath.includes('\0')) {
    fail(teamDir, `expert card path contains a NUL byte: ${JSON.stringify(cardPath)}`)
  }
  if (isAbsolute(cardPath)) {
    fail(teamDir, `expert card must be relative, got absolute path ${cardPath}`)
  }
  if (/^[A-Za-z]:/.test(cardPath)) {
    fail(teamDir, `expert card must not carry a drive prefix: ${cardPath}`)
  }
  const resolved = resolve(teamDir, cardPath)
  const rel = relative(teamDir, resolved)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    fail(teamDir, `expert card escapes the team directory: ${cardPath}`)
  }
  let realTarget
  let realTeamDir
  try {
    realTarget = await realpath(resolved)
    realTeamDir = await realpath(teamDir)
  } catch {
    return resolved // nonexistent targets are reported by the caller's existence check
  }
  const realRel = relative(realTeamDir, realTarget)
  if (realRel === '' || realRel === '..' || realRel.startsWith('..\\') || realRel.startsWith('../')) {
    fail(teamDir, `expert card escapes the team directory via symlink: ${cardPath}`)
  }
  return resolved
}

async function readCard(teamDir, cardPath) {
  const resolved = await assertInsideTeamDir(teamDir, cardPath)
  let info
  try {
    info = await stat(resolved)
  } catch (cause) {
    throw pluginError(
      `dsh-experts: expert card not found: ${resolved} (referenced by ${join(teamDir, 'team.json')})`,
      'CARD_READ_FAILED',
      { teamDir, path: resolved, cause },
    )
  }
  if (!info.isFile()) {
    throw pluginError(`dsh-experts: expert card is not a regular file: ${resolved}`, 'CARD_READ_FAILED', {
      teamDir,
      path: resolved,
    })
  }
  if (info.size > MAX_CARD_BYTES) {
    fail(teamDir, `expert card exceeds ${MAX_CARD_BYTES} bytes: ${cardPath} (${info.size} bytes)`)
  }
  let content
  try {
    content = await readFile(resolved, 'utf8')
  } catch (cause) {
    throw pluginError(`dsh-experts: expert card unreadable: ${resolved}`, 'CARD_READ_FAILED', {
      teamDir,
      path: resolved,
      cause,
    })
  }
  if (/^\s*`{4,}/m.test(content)) {
    fail(teamDir, `expert card contains a 4+ backtick fence line which would break skill-body fencing: ${cardPath}`)
  }
  return content
}

/**
 * Validate one team directory and return its normalized manifest plus loaded
 * artifacts. Throws INVALID_TEAM / CARD_READ_FAILED on any violation.
 *
 * @param {string} teamDir absolute team directory
 * @param {{availableWorkflows: readonly string[]}} context
 */
export async function validateTeam(teamDir, { availableWorkflows }) {
  if (!isWorkflowList(availableWorkflows)) {
    throw pluginError('dsh-experts: availableWorkflows must be an array of template names', 'INVALID_CONFIG')
  }
  let raw
  try {
    raw = await readFile(join(teamDir, 'team.json'), 'utf8')
  } catch (cause) {
    throw pluginError(`dsh-experts: team.json not found or unreadable in ${teamDir}`, 'TEAM_READ_FAILED', {
      teamDir,
      cause,
    })
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    fail(teamDir, `invalid JSON: ${cause.message}`)
  }
  if (!isPlainObject(parsed)) fail(teamDir, 'manifest root must be a JSON object')
  rejectUnknownKeys(teamDir, parsed, MANIFEST_KEYS, 'manifest root')

  const name = parsed.name
  if (typeof name !== 'string' || !KEBAB.test(name)) fail(teamDir, `name must be kebab-case, got ${JSON.stringify(name)}`)
  const dirName = basename(teamDir)
  if (name !== dirName) fail(teamDir, `name "${name}" must equal the team directory name "${dirName}"`)

  const description = parsed.description
  if (typeof description !== 'string' || description.trim() === '') fail(teamDir, 'description must be a non-empty string')
  if (description.length > MAX_DESCRIPTION) fail(teamDir, `description exceeds ${MAX_DESCRIPTION} characters`)
  assertSafeInlineText(teamDir, description, 'description')

  const whenToUse = parsed.whenToUse
  if (whenToUse !== undefined && (typeof whenToUse !== 'string' || whenToUse.trim() === '')) {
    fail(teamDir, 'whenToUse must be a non-empty string when present')
  }
  if (whenToUse !== undefined) assertSafeInlineText(teamDir, whenToUse, 'whenToUse')

  const workflow = parsed.workflow
  if (typeof workflow !== 'string' || !availableWorkflows.includes(workflow)) {
    fail(teamDir, `workflow must be one of [${availableWorkflows.join(', ')}], got ${JSON.stringify(workflow)}`)
  }

  const experts = parsed.experts
  if (!Array.isArray(experts) || experts.length === 0) fail(teamDir, 'experts must be a non-empty array')
  if (experts.length > MAX_EXPERTS) fail(teamDir, `experts exceeds the maximum of ${MAX_EXPERTS}`)

  const ids = new Set()
  const cards = new Map()
  let coordinators = 0
  for (const [index, expert] of experts.entries()) {
    if (!isPlainObject(expert)) fail(teamDir, `experts[${index}] must be an object`)
    rejectUnknownKeys(teamDir, expert, EXPERT_KEYS, `experts[${index}]`)
    const id = expert.id
    if (typeof id !== 'string' || !KEBAB.test(id)) {
      fail(teamDir, `experts[${index}].id must be kebab-case, got ${JSON.stringify(id)}`)
    }
    if (ids.has(id)) fail(teamDir, `duplicate expert id "${id}"`)
    ids.add(id)
    const role = expert.role === undefined ? 'specialist' : expert.role
    if (role !== 'coordinator' && role !== 'specialist') {
      fail(teamDir, `experts[${index}].role must be "coordinator" or "specialist", got ${JSON.stringify(expert.role)}`)
    }
    if (role === 'coordinator') coordinators += 1
    if (expert.modelHint !== undefined && (typeof expert.modelHint !== 'string' || expert.modelHint.trim() === '')) {
      fail(teamDir, `experts[${index}].modelHint must be a non-empty string when present`)
    }
    if (expert.modelHint !== undefined) assertSafeInlineText(teamDir, expert.modelHint, `experts[${index}].modelHint`)
    cards.set(id, await readCard(teamDir, expert.card))
  }
  if (coordinators !== 1) {
    fail(teamDir, `exactly one expert must have role "coordinator", found ${coordinators}`)
  }

  const escalations = parsed.escalations ?? []
  if (!Array.isArray(escalations)) fail(teamDir, 'escalations must be an array')
  for (const [index, esc] of escalations.entries()) {
    if (!isPlainObject(esc)) fail(teamDir, `escalations[${index}] must be an object`)
    rejectUnknownKeys(teamDir, esc, ESCALATION_KEYS, `escalations[${index}]`)
    if (!ids.has(esc.from)) fail(teamDir, `escalations[${index}].from references unknown expert "${esc.from}"`)
    if (!ids.has(esc.to)) fail(teamDir, `escalations[${index}].to references unknown expert "${esc.to}"`)
    if (esc.from === esc.to) fail(teamDir, `escalations[${index}] cannot target itself (${esc.from})`)
    if (typeof esc.when !== 'string' || esc.when.trim() === '') {
      fail(teamDir, `escalations[${index}].when must be a non-empty string`)
    }
    assertSafeInlineText(teamDir, esc.when, `escalations[${index}].when`)
    if (!PRIORITIES.includes(esc.priority)) {
      fail(teamDir, `escalations[${index}].priority must be one of [${PRIORITIES.join(', ')}], got ${JSON.stringify(esc.priority)}`)
    }
  }

  const reportLanguage = parsed.reportLanguage ?? 'zh'
  if (reportLanguage !== 'zh' && reportLanguage !== 'en') {
    fail(teamDir, `reportLanguage must be "zh" or "en", got ${JSON.stringify(parsed.reportLanguage)}`)
  }

  let teamProse = ''
  const prosePath = join(teamDir, 'TEAM.md')
  let proseStat
  try {
    proseStat = await stat(prosePath)
  } catch (cause) {
    if (cause !== null && typeof cause === 'object' && cause.code === 'ENOENT') {
      proseStat = undefined // TEAM.md is optional prose; absence is fine
    } else {
      throw pluginError(`dsh-experts: TEAM.md unreadable: ${prosePath}`, 'TEAM_READ_FAILED', { teamDir, cause })
    }
  }
  if (proseStat !== undefined && proseStat.isFile()) {
    if (proseStat.size > MAX_TEAM_PROSE_BYTES) {
      fail(teamDir, `TEAM.md exceeds ${MAX_TEAM_PROSE_BYTES} bytes (${proseStat.size})`)
    }
    try {
      teamProse = await readFile(prosePath, 'utf8')
    } catch (cause) {
      throw pluginError(`dsh-experts: TEAM.md unreadable: ${prosePath}`, 'TEAM_READ_FAILED', { teamDir, cause })
    }
  }

  return Object.freeze({
    name,
    description: description.trim(),
    whenToUse: whenToUse === undefined ? undefined : whenToUse.trim(),
    workflow,
    reportLanguage,
    experts: Object.freeze(
      experts.map((expert) => ({
        id: expert.id,
        role: expert.role === undefined ? 'specialist' : expert.role,
        card: expert.card,
        modelHint: expert.modelHint,
      })),
    ),
    escalations: Object.freeze(escalations.map((esc) => ({ ...esc }))),
    teamDir,
    teamProse,
    cards: Object.freeze(cards),
  })
}

function isWorkflowList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '')
}
