/**
 * Skill body composition: engine workflow template + team roster + inlined
 * persona cards + escalation matrix + optional team prose.
 *
 * Cards are INLINED (not referenced by path) because user/bundled team
 * directories sit outside the agent workspace and may not be readable by the
 * model's file tools. Fences use four backticks so cards containing triple
 * fences stay intact.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pluginError } from './errors.js'
import { templatesDir } from './paths.js'

/**
 * Findings output schema handed to each specialist's subagent call. Kept to a
 * conservative JSON Schema subset (type/properties/items/required/
 * additionalProperties/enum) that in-process subagent providers accept.
 */
export const FINDINGS_SCHEMA = Object.freeze({
  type: 'object',
  required: ['scores', 'findings', 'blockers'],
  additionalProperties: false,
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        required: ['dimension', 'value', 'evidence'],
        additionalProperties: false,
        properties: {
          dimension: { type: 'string' },
          value: { type: 'number' },
          evidence: { type: 'string' },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'severity', 'title', 'evidence', 'recommendation'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          title: { type: 'string' },
          evidence: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
        },
      },
    },
    blockers: { type: 'array', items: { type: 'string' } },
  },
})

/** Read one workflow template by name from the package templates directory. */
export async function readWorkflowTemplate(workflow) {
  const path = join(templatesDir(), `${workflow}.md`)
  let template
  try {
    template = await readFile(path, 'utf8')
  } catch (cause) {
    throw pluginError(`dsh-experts: workflow template missing: ${path}`, 'TEMPLATE_MISSING', { path, cause })
  }
  return template
}

function renderTemplate(template, vars, templateName) {
  const rendered = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  )
  if (/\{\{[A-Z_]+\}\}/.test(rendered)) {
    throw pluginError(
      `dsh-experts: template ${templateName}.md still contains unresolved placeholders after substitution`,
      'DISCOVERY_FAILED',
    )
  }
  return rendered
}

function rosterTable(manifest) {
  const rows = manifest.experts.map((expert) => {
    const role = expert.role === 'coordinator' ? 'coordinator（不参与评分派遣）' : 'specialist'
    const hint = expert.modelHint === undefined ? '—' : expert.modelHint
    return `| ${expert.id} | ${role} | ${hint} |`
  })
  return ['| 专家 | 角色 | 模型提示 |', '|---|---|---|', ...rows].join('\n')
}

function escalationTable(manifest) {
  if (manifest.escalations.length === 0) return '_本团队未声明升级路由；发现跨域问题由协调者直接记录为发现。_'
  const rows = manifest.escalations.map((esc) => `| ${esc.from} | ${esc.to} | ${esc.when} | ${esc.priority} |`)
  return ['| 发现方 | 升级给 | 触发条件 | 优先级 |', '|---|---|---|---|', ...rows].join('\n')
}

function cardBlocks(manifest) {
  return manifest.experts
    .map((expert) => `### 专家人设卡：${expert.id}\n\n\`\`\`\`markdown\n${manifest.cards.get(expert.id).trim()}\n\`\`\`\``)
    .join('\n\n')
}

/** Compose the full skill body for one validated team manifest. */
export function composeTeamSkill(manifest, template) {
  const coordinator = manifest.experts.find((expert) => expert.role === 'coordinator')
  const workflow = renderTemplate(template, {
    TEAM_NAME: manifest.name,
    COORDINATOR_ID: coordinator.id,
    FINDINGS_SCHEMA: JSON.stringify(FINDINGS_SCHEMA, null, 2),
    REPORT_LANGUAGE: manifest.reportLanguage,
  }, manifest.workflow)

  const sections = [
    `# 专家团：${manifest.name}`,
    '',
    manifest.description,
    '',
    manifest.whenToUse === undefined ? '' : `**何时使用**：${manifest.whenToUse}`,
    '',
    '## 花名册',
    '',
    rosterTable(manifest),
    '',
    '## 专家人设卡（派遣时作为 persona 参数全文传入）',
    '',
    cardBlocks(manifest),
    '',
    '## 升级路由矩阵',
    '',
    escalationTable(manifest),
    '',
    '## 工作流',
    '',
    workflow,
  ]
  if (manifest.teamProse.trim() !== '') {
    sections.push('', '## 团队约定（TEAM.md）', '', manifest.teamProse.trim())
  }
  return sections.join('\n')
}
