import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateTeam } from '../src/manifest.js'
import { BASE_MANIFEST, cleanup, tempDir, writeTeam } from './helpers.js'

const WORKFLOWS = { availableWorkflows: ['review'] }

describe('validateTeam (happy paths)', () => {
  let root

  before(async () => {
    root = await tempDir()
  })
  after(async () => {
    await cleanup(root)
  })

  it('accepts the minimal valid team and loads cards + prose', async () => {
    const teamDir = await writeTeam(root, {}, { 'TEAM.md': '# 约定\n\n- 测试\n' })
    const manifest = await validateTeam(teamDir, WORKFLOWS)
    assert.equal(manifest.name, 'demo-team')
    assert.equal(manifest.experts.length, 2)
    assert.equal(manifest.experts.filter((e) => e.role === 'coordinator').length, 1)
    assert.equal(manifest.experts.find((e) => e.id === 'coder').role, 'specialist')
    assert.equal(manifest.cards.get('coder'), BASE_MANIFEST_TEXT)
    assert.ok(manifest.teamProse.includes('测试'))
    assert.equal(manifest.reportLanguage, 'zh')
  })

  it('TEAM.md is optional', async () => {
    const teamDir = await writeTeam(root, { name: 'no-prose' })
    const manifest = await validateTeam(teamDir, WORKFLOWS)
    assert.equal(manifest.teamProse, '')
  })
})

const BASE_MANIFEST_TEXT = '# 测试专家卡片\n\n人设：测试用。\n'

describe('validateTeam (fail-loud violations)', () => {
  let root

  before(async () => {
    root = await tempDir()
  })
  after(async () => {
    await cleanup(root)
  })

  async function expectInvalid(overrides, matcher) {
    const teamDir = await writeTeam(root, overrides)
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes(join(teamDir, 'team.json')) && (!matcher || matcher(error.message)),
    )
  }

  it('unknown top-level key', async () => {
    await expectInvalid({ name: 't-unknown-top', expert: [] }, (m) => m.includes('unknown key'))
  })
  it('unknown expert key', async () => {
    await expectInvalid({ name: 't-unknown-expert', escalations: [], experts: [{ id: 'lead', role: 'coordinator', card: 'experts/lead.md',cards:'x' }] }, (m) => m.includes('experts[0]'))
  })
  it('non-kebab name', () => expectInvalid({ name: 'Bad_Name' }, (m) => m.includes('kebab-case')))
  it('name must equal directory name', async () => {
    const teamDir = join(root, 't-mismatch')
    await mkdir(join(teamDir, 'experts'), { recursive: true })
    await writeFile(join(teamDir, 'experts', 'lead.md'), '# 卡\n', 'utf8')
    await writeFile(
      join(teamDir, 'team.json'),
      JSON.stringify({ name: 'different-name', description: 'x', workflow: 'review', escalations: [], experts: [{ id: 'lead', role: 'coordinator', card: 'experts/lead.md' }] }),
      'utf8',
    )
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes('directory name'),
    )
  })
  it('empty description', () => expectInvalid({ name: 't-desc', description: '  ' }, (m) => m.includes('description')))
  it('overlong description', () => expectInvalid({ name: 't-desc2', description: 'x'.repeat(501) }, (m) => m.includes('500')))
  it('unknown workflow', () => expectInvalid({ name: 't-wf', workflow: 'develop' }, (m) => m.includes('workflow')))
  it('empty experts array', () => expectInvalid({ name: 't-empty', experts: [] }, (m) => m.includes('non-empty array')))
  it('duplicate expert ids', () =>
    expectInvalid(
      { name: 't-dup', experts: [{ id: 'lead', role: 'coordinator', card: 'experts/lead.md' }, { id: 'lead', card: 'experts/lead.md' }] },
      (m) => m.includes('duplicate expert id'),
    ))
  it('zero coordinators', () =>
    expectInvalid(
      { name: 't-nocoord', escalations: [], experts: [{ id: 'lead', card: 'experts/lead.md' }] },
      (m) => m.includes('exactly one'),
    ))
  it('two coordinators', () =>
    expectInvalid(
      { name: 't-twocoord', escalations: [], experts: [{ id: 'a', role: 'coordinator', card: 'experts/lead.md' }, { id: 'b', role: 'coordinator', card: 'experts/lead.md' }] },
      (m) => m.includes('exactly one'),
    ))
  it('bad role value', () =>
    expectInvalid(
      { name: 't-role', escalations: [], experts: [{ id: 'lead', role: 'boss', card: 'experts/lead.md' }] },
      (m) => m.includes('coordinator'),
    ))
  it('missing card file fails as CARD_READ_FAILED with path', async () => {
    const teamDir = join(root, 't-card404')
    await mkdir(join(teamDir, 'experts'), { recursive: true })
    await writeFile(
      join(teamDir, 'team.json'),
      JSON.stringify({ name: 't-card404', description: 'x', workflow: 'review', escalations: [], experts: [{ id: 'lead', role: 'coordinator', card: 'experts/ghost.md' }] }),
      'utf8',
    )
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'CARD_READ_FAILED' && error.message.includes('ghost.md'),
    )
  })
  it('absolute card path rejected', async () => {
    const teamDir = join(root, 't-abs')
    await mkdir(join(teamDir, 'experts'), { recursive: true })
    const absoluteCard = process.platform === 'win32' ? 'C:/etc/passwd' : '/etc/passwd'
    await writeFile(
      join(teamDir, 'team.json'),
      JSON.stringify({ name: 't-abs', description: 'x', workflow: 'review', escalations: [], experts: [{ id: 'lead', role: 'coordinator', card: absoluteCard }] }),
      'utf8',
    )
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes('absolute'),
    )
  })
  it('card path escaping via .. rejected', async () => {
    const teamDir = await writeTeam(root, { name: 't-escape', experts: [{ id: 'lead', role: 'coordinator', card: 'experts/../../outside.md' }] })
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes('escapes'),
    )
  })
  it('card path escaping via symlink rejected', { skip: process.platform === 'win32' && 'symlink creation needs privileges on Windows' }, async () => {
    const outside = join(root, 'outside.md')
    await writeFile(outside, 'x', 'utf8')
    const teamDir = await writeTeam(root, { name: 't-symlink' })
    await rm(join(teamDir, 'experts', 'lead.md')) // POSIX symlink() refuses to replace an existing file
    await symlink(outside, join(teamDir, 'experts', 'lead.md'))
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes('escapes'),
    )
  })
  it('escalation referencing unknown expert', () =>
    expectInvalid({ name: 't-esc404', escalations: [{ from: 'ghost', to: 'lead', when: 'x', priority: 'P1' }] }, (m) => m.includes('unknown expert')))
  it('self-escalation rejected', () =>
    expectInvalid({ name: 't-selfesc', escalations: [{ from: 'lead', to: 'lead', when: 'x', priority: 'P1' }] }, (m) => m.includes('itself')))
  it('bad priority rejected', () =>
    expectInvalid({ name: 't-prio', escalations: [{ from: 'coder', to: 'lead', when: 'x', priority: 'P9' }] }, (m) => m.includes('priority')))
  it('unknown escalation key rejected', () =>
    expectInvalid({ name: 't-esckey', escalations: [{ from: 'coder', to: 'lead', when: 'x', priority: 'P1', ttl: 5 }] }, (m) => m.includes('unknown key')))
  it('bad reportLanguage rejected', () => expectInvalid({ name: 't-lang', reportLanguage: 'fr' }, (m) => m.includes('reportLanguage')))
  it('oversized card rejected', async () => {
    const teamDir = await writeTeam(root, { name: 't-bigcard' })
    await writeFile(join(teamDir, 'experts', 'lead.md'), 'x'.repeat(32 * 1024 + 1), 'utf8')
    await assert.rejects(() => validateTeam(teamDir, WORKFLOWS), (e) => e.code === 'INVALID_TEAM' && e.message.includes('bytes'))
  })
  it('invalid JSON fails with parse context', async () => {
    const teamDir = join(root, 't-badjson')
    await mkdir(join(teamDir, 'experts'), { recursive: true })
    await writeFile(join(teamDir, 'team.json'), '{not json', 'utf8')
    await assert.rejects(() => validateTeam(teamDir, WORKFLOWS), (e) => e.code === 'INVALID_TEAM' && e.message.includes('invalid JSON'))
  })
  it('missing team.json fails as TEAM_READ_FAILED', async () => {
    const teamDir = join(root, 't-nojson')
    await mkdir(teamDir, { recursive: true })
    await assert.rejects(() => validateTeam(teamDir, WORKFLOWS), (e) => e.code === 'TEAM_READ_FAILED')
  })

  // ---- adversarial-review regressions ----
  it('drive-prefixed card path rejected on every platform (win32 drive-relative escape)', async () => {
    const teamDir = join(root, 't-drive')
    await mkdir(join(teamDir, 'experts'), { recursive: true })
    await writeFile(
      join(teamDir, 'team.json'),
      JSON.stringify({ name: 't-drive', description: 'x', workflow: 'review', escalations: [], experts: [{ id: 'lead', role: 'coordinator', card: 'C:Windows/win.ini' }] }),
      'utf8',
    )
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes('drive prefix'),
    )
  })
  it('NUL byte in card path rejected', async () => {
    const teamDir = join(root, 't-nul')
    await mkdir(join(teamDir, 'experts'), { recursive: true })
    await writeFile(
      join(teamDir, 'team.json'),
      JSON.stringify({ name: 't-nul', description: 'x', workflow: 'review', escalations: [], experts: [{ id: 'lead', role: 'coordinator', card: 'experts/lea\0d.md' }] }),
      'utf8',
    )
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes('NUL'),
    )
  })
  it('oversized TEAM.md fails loud instead of being silently dropped', async () => {
    const teamDir = await writeTeam(root, { name: 't-bigprose' }, { 'TEAM.md': 'x'.repeat(64 * 1024 + 1) })
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes('TEAM.md exceeds'),
    )
  })
  for (const [field, build] of [
    ['description', (v) => ({ description: v })],
    ['whenToUse', (v) => ({ whenToUse: v })],
  ]) {
    it(`${field} with newline or pipe rejected (markdown injection)`, async () => {
      for (const bad of ['line1\nline2 ## forged', 'before | after']) {
        const teamDir = await writeTeam(root, { name: `t-inj-${field}`, ...build(bad) })
        await assert.rejects(
          () => validateTeam(teamDir, WORKFLOWS),
          (error) => error.code === 'INVALID_TEAM' && error.message.includes(field),
        )
      }
    })
  }
  it('escalation when with pipe rejected (table injection)', () =>
    expectInvalid({ name: 't-escpipe', escalations: [{ from: 'coder', to: 'lead', when: 'SQL | NoSQL', priority: 'P1' }] }, (m) => m.includes('escalations[0].when')))
  it('modelHint with newline rejected (roster injection)', () =>
    expectInvalid(
      { name: 't-hintnl', experts: [{ id: 'lead', role: 'coordinator', card: 'experts/lead.md', modelHint: 'flash\n| forged | row |' }] },
      (m) => m.includes('modelHint'),
    ))
  it('card containing a 4+ backtick fence line rejected (skill-body fence break)', async () => {
    const teamDir = await writeTeam(root, { name: 't-fence' }, { 'experts/lead.md': 'ok\n````\nbroken\n' })
    // writeTeam writes BASE cards first; overwrite lead's card with the fence content
    await writeFile(join(teamDir, 'experts', 'lead.md'), 'ok\n````markdown\nbroken\n', 'utf8')
    await assert.rejects(
      () => validateTeam(teamDir, WORKFLOWS),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes('backtick'),
    )
  })
})
