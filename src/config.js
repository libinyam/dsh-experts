/**
 * Plugin config resolution. Cordis passes the `config:` object from the patch
 * layer; env overrides happen in cordis.patch.yml expressions, so here we only
 * validate what arrives. Unknown keys are rejected (typo protection).
 */

import { pluginError } from './errors.js'

const ALLOWED_KEYS = ['providerName', 'includeDefaultRoots', 'dshHome', 'teamDirs', 'includeBundledTeams']

function nonEmptyString(value, fallback, field) {
  const resolved = value === null ? invalidNull(field) : value ?? fallback
  if (typeof resolved !== 'string' || resolved.trim() === '') {
    throw pluginError(`dsh-experts: ${field} must be a non-empty string`, 'INVALID_CONFIG')
  }
  return resolved.trim()
}

function strictBoolean(value, fallback, field) {
  const resolved = value === null ? invalidNull(field) : value ?? fallback
  if (typeof resolved !== 'boolean') {
    throw pluginError(`dsh-experts: ${field} must be a boolean`, 'INVALID_CONFIG')
  }
  return resolved
}

function stringArray(value, fallback, field) {
  const resolved = value === null ? invalidNull(field) : value ?? fallback
  if (!Array.isArray(resolved) || resolved.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw pluginError(`dsh-experts: ${field} must be an array of non-empty strings`, 'INVALID_CONFIG')
  }
  return resolved.map((item) => item.trim())
}

function invalidNull(field) {
  throw pluginError(`dsh-experts: ${field} must not be null (omit the key to use the default)`, 'INVALID_CONFIG')
}

/** Validate and normalize raw plugin config into a frozen options object. */
export function resolveConfig(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw pluginError('dsh-experts: config must be an object', 'INVALID_CONFIG')
  }
  const unknown = Object.keys(config).filter((key) => !ALLOWED_KEYS.includes(key))
  if (unknown.length > 0) {
    throw pluginError(
      `dsh-experts: unknown config key(s) ${unknown.join(', ')}; allowed: ${ALLOWED_KEYS.join(', ')}`,
      'INVALID_CONFIG',
    )
  }
  if (config.dshHome !== undefined) nonEmptyString(config.dshHome, undefined, 'dshHome') // null is rejected here too
  const dshHome = config.dshHome === undefined ? undefined : config.dshHome.trim()
  return Object.freeze({
    providerName: nonEmptyString(config.providerName, 'dsh-experts', 'providerName'),
    includeDefaultRoots: strictBoolean(config.includeDefaultRoots, true, 'includeDefaultRoots'),
    dshHome,
    teamDirs: stringArray(config.teamDirs, [], 'teamDirs'),
    includeBundledTeams: strictBoolean(config.includeBundledTeams, true, 'includeBundledTeams'),
  })
}
