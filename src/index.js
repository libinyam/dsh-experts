/**
 * dsh-experts — DeepSeek Harness bundle.
 *
 * Registers one skill provider on `ctx.skills`. Every discovered team
 * directory becomes a model-routable skill named `experts-<team>` whose body
 * is composed from the engine workflow template plus the team's roster,
 * persona cards, escalation matrix, and optional TEAM.md prose.
 *
 * Verified harness seams (see CLAUDE.md 接点台账):
 * - `inject = ['skills']` (SkillRegistry service name)
 * - `ctx.skills.registerProvider(create)` with `{signal, invalidate}` control
 */

import { resolveConfig } from './config.js'
import { discoverTeams, loadTeam } from './teams.js'

export const version = '0.1.0'
export const name = 'dsh-experts'
export const inject = ['skills']

/**
 * Plugin entry. Cordis passes the patch-layer `config` object; invalid config
 * fails loud (INVALID_CONFIG) rather than defaulting silently.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  ctx.skills.registerProvider(() => ({
    name: resolved.providerName,
    list: async (options = {}) => discoverTeams(resolved, options),
    get: async (candidate, options = {}) => loadTeam(resolved, candidate, options),
  }))
}
