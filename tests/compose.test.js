import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeTeamSkill, FINDINGS_SCHEMA, readWorkflowTemplate } from '../src/compose.js'
import { validateTeam } from '../src/manifest.js'
import { bundledTeamsDir } from '../src/paths.js'
import { join } from 'node:path'

const WORKFLOWS = { availableWorkflows: ['review'] }

async function bundledWebReviewManifest() {
  return validateTeam(join(bundledTeamsDir(), 'web-review'), WORKFLOWS)
}

describe('FINDINGS_SCHEMA', () => {
  it('uses only the conservative JSON Schema subset', () => {
    const ALLOWED = new Set(['type', 'properties', 'items', 'required', 'additionalProperties', 'enum'])
    function walkSchema(node) {
      for (const [key, value] of Object.entries(node)) {
        assert.ok(ALLOWED.has(key), `unexpected schema keyword "${key}"`)
        if (key === 'properties') {
          for (const child of Object.values(value)) walkSchema(child)
        } else if (key === 'items') {
          walkSchema(value)
        } else if (key === 'required' || key === 'enum') {
          for (const item of value) assert.ok(['string', 'number', 'boolean'].includes(typeof item), `${key} must hold scalars`)
        }
      }
    }
    walkSchema(FINDINGS_SCHEMA)
    assert.equal(FINDINGS_SCHEMA.type, 'object') // object-rooted
  })
})

describe('composeTeamSkill (bundled web-review)', () => {
  it('body contains all five mandatory sections and no unresolved placeholders', async () => {
    const manifest = await bundledWebReviewManifest()
    const template = await readWorkflowTemplate('review')
    const body = composeTeamSkill(manifest, template)
    assert.ok(body.includes('# 专家团：web-review'))
    assert.ok(body.includes('## 花名册'))
    assert.ok(body.includes('## 专家人设卡（派遣时作为 persona 参数全文传入）'))
    assert.ok(body.includes('### 专家人设卡：security'))
    assert.ok(body.includes('## 升级路由矩阵'))
    assert.ok(body.includes('## 工作流'))
    assert.ok(body.includes('## 团队约定（TEAM.md）'))
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(body), 'unresolved placeholders remain')
  })

  it('inlines every persona card inside four-backtick fences', async () => {
    const manifest = await bundledWebReviewManifest()
    const body = composeTeamSkill(manifest, await readWorkflowTemplate('review'))
    for (const expert of manifest.experts) {
      const card = manifest.cards.get(expert.id).trim()
      assert.ok(body.includes(card), `card of ${expert.id} not inlined verbatim`)
    }
    const fences = body.match(/````markdown\n/g) ?? []
    assert.equal(fences.length, manifest.experts.length)
  })

  it('template placeholders are all consumed by the composer', async () => {
    const template = await readWorkflowTemplate('review')
    for (const key of ['{{TEAM_NAME}}', '{{COORDINATOR_ID}}', '{{FINDINGS_SCHEMA}}', '{{REPORT_LANGUAGE}}']) {
      assert.ok(template.includes(key), `template lost placeholder ${key}`)
    }
  })

  it('escalation matrix renders rows for every declared escalation', async () => {
    const manifest = await bundledWebReviewManifest()
    const body = composeTeamSkill(manifest, await readWorkflowTemplate('review'))
    for (const esc of manifest.escalations) {
      assert.ok(body.includes(`| ${esc.from} | ${esc.to} |`))
    }
  })

  it('embeds a JSON-parseable findings schema block', async () => {
    const manifest = await bundledWebReviewManifest()
    const body = composeTeamSkill(manifest, await readWorkflowTemplate('review'))
    const match = body.match(/```json\n(\{[\s\S]*?\n\})\n```/)
    assert.notEqual(match, null)
    const parsed = JSON.parse(match[1])
    assert.deepEqual(parsed, FINDINGS_SCHEMA)
  })
})

describe('readWorkflowTemplate', () => {
  it('fails loud with TEMPLATE_MISSING for an unknown workflow', async () => {
    await assert.rejects(
      () => readWorkflowTemplate('nope'),
      (error) => error.code === 'TEMPLATE_MISSING',
    )
  })
})
