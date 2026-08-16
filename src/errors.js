/**
 * Error factory shared by every module.
 *
 * ERROR_CODES is the single source of truth for the stable error-code
 * vocabulary; the guard test asserts every code used by `pluginError` calls
 * across src/ is declared here, and every declared code is actually used.
 *
 * Every error carries an own `failure` data property agreeing with `code`, so
 * harness layers that normalize adapter throws keep the facts (same pattern as
 * dsh-vision-provider).
 */

export const ERROR_CODES = Object.freeze([
  'INVALID_CONFIG', // plugin config failed validation
  'INVALID_TEAM', // team manifest (team.json) failed validation
  'CARD_READ_FAILED', // an expert card referenced by the manifest is unreadable
  'TEMPLATE_MISSING', // the workflow named by a team has no template file
  'TEAM_READ_FAILED', // team directory, team.json, or TEAM.md could not be read
  'DISCOVERY_FAILED', // scanning a team root or rendering a template failed
])

export function pluginError(message, code, details = {}) {
  const error = new Error(message, details.cause === undefined ? undefined : { cause: details.cause })
  error.code = code
  error.failure = Object.freeze({
    message,
    code,
    ...(details.teamDir === undefined ? {} : { teamDir: details.teamDir }),
    ...(details.path === undefined ? {} : { path: details.path }),
  })
  if (details.teamDir !== undefined) error.teamDir = details.teamDir
  if (details.path !== undefined) error.path = details.path
  return error
}
