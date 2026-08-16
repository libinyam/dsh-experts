/**
 * Shared test fixtures: temp directories, minimal valid teams, and a resolved
 * config factory. Tests import from here; nothing in src/ depends on this.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../src/config.js'

/** Create a unique temp directory; returns its path. */
export async function tempDir() {
  return mkdtemp(join(tmpdir(), 'dsh-experts-'))
}

/** Recursively remove a temp directory, ignoring failures. */
export async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true })
}

export const CARD_TEXT = '# 测试专家卡片\n\n人设：测试用。\n'

export const BASE_MANIFEST = {
  name: 'demo-team',
  description: '测试用最小团队',
  workflow: 'review',
  experts: [
    { id: 'lead', role: 'coordinator', card: 'experts/lead.md' },
    { id: 'coder', card: 'experts/coder.md' },
  ],
  escalations: [{ from: 'coder', to: 'lead', when: '测试升级', priority: 'P1' }],
}

/**
 * Write a team directory under `root` named `manifest.name` (or override).
 * `overrides` is shallow-merged onto BASE_MANIFEST key by key; `extraFiles`
 * maps team-dir-relative paths to contents written verbatim.
 */
export async function writeTeam(root, overrides = {}, extraFiles = {}) {
  const manifest = { ...BASE_MANIFEST, ...overrides }
  const teamDir = join(root, manifest.name)
  await mkdir(join(teamDir, 'experts'), { recursive: true })
  for (const expert of manifest.experts) {
    await writeFile(join(teamDir, expert.card), CARD_TEXT, 'utf8')
  }
  await writeFile(join(teamDir, 'team.json'), JSON.stringify(manifest, null, 2), 'utf8')
  for (const [rel, content] of Object.entries(extraFiles)) {
    await writeFile(join(teamDir, rel), content, 'utf8')
  }
  return teamDir
}

/** Build a resolved config pointing defaults at temp roots, isolated from the
 *  developer machine's real ~/.dsh and any real project root. */
export function testConfig(overrides = {}) {
  return resolveConfig({
    includeDefaultRoots: false,
    includeBundledTeams: false,
    ...overrides,
  })
}
