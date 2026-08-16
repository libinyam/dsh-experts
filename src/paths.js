/**
 * Path helpers mirroring dsh conventions.
 *
 * - dshHome: `$DSH_HOME` or `~/.dsh` (same resolution rule dsh-home-paths
 *   applies for the skills filesystem provider).
 * - findGitRoot: nearest ancestor containing `.git` (the project-root rule the
 *   skills subsystem documents for local discovery).
 */

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Resolve the DeepSeek Harness config root. */
export function dshHome(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** Absolute path of this package root (src/..). */
export function packageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

/** Absolute path of the bundled example teams directory. */
export function bundledTeamsDir() {
  return join(packageRoot(), 'teams')
}

/** Absolute path of the workflow templates directory. */
export function templatesDir() {
  return join(packageRoot(), 'templates')
}

async function pathExists(target) {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (error !== null && typeof error === 'object' && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) {
      return false // unreadable ancestors read as "no .git here"; keep walking up
    }
    throw error
  }
}

/**
 * Walk up from `start` looking for a `.git` entry (file or directory).
 * Returns the directory containing it, or null when none exists.
 */
export async function findGitRoot(start, exists = pathExists) {
  let current = start
  while (true) {
    if (await exists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}
