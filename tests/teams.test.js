import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { discoverTeams, loadTeam } from '../src/teams.js'
import { bundledTeamsDir } from '../src/paths.js'
import { cleanup, tempDir, testConfig, writeTeam } from './helpers.js'

describe('discoverTeams', () => {
  let root

  before(async () => {
    root = await tempDir()
  })
  after(async () => {
    await cleanup(root)
  })

  it('empty config with no roots yields no candidates', async () => {
    const candidates = await discoverTeams(testConfig(), {})
    assert.deepEqual(candidates, [])
  })

  it('returns candidates with the registry contract shape', async () => {
    const userRoot = join(root, 'user')
    await writeTeam(userRoot)
    const candidates = await discoverTeams(testConfig({ teamDirs: [userRoot] }), {})
    assert.equal(candidates.length, 1)
    const candidate = candidates[0]
    assert.equal(candidate.name, 'experts-demo-team')
    assert.equal(candidate.description, '测试用最小团队')
    assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
    assert.equal(candidate.source, 'custom')
    assert.equal(candidate.provider, 'dsh-experts')
    assert.equal(candidate.rank, 300)
    assert.equal(typeof candidate.locator.teamDir, 'string')
    assert.deepEqual(candidate.metadata.experts, ['lead', 'coder'])
    assert.equal(candidate.metadata.coordinator, 'lead')
    assert.equal(candidate.metadata.workflow, 'review')
    assert.equal(candidate.resourceBase.kind, 'directory')
  })

  it('lower rank wins a duplicate name (project 100 < custom 300 < user 400)', async () => {
    const projectRoot = join(root, 'proj')
    const customRoot = join(root, 'custom')
    const userRoot = join(root, 'user')
    await mkdir(join(projectRoot, '.git'), { recursive: true })
    await writeTeam(join(projectRoot, '.dsh', 'experts'))
    await writeTeam(customRoot)
    await writeTeam(userRoot)
    const candidates = await discoverTeams(
      testConfig({
        includeDefaultRoots: true,
        dshHome: join(root, 'fake-home'),
        teamDirs: [customRoot],
      }),
      { cwd: projectRoot },
    )
    // user root points at fake-home (empty): project + custom both have demo-team
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].rank, 100)
    assert.equal(candidates[0].source, 'project-dsh')
  })

  it('earlier custom root wins an equal-rank duplicate', async () => {
    const first = join(root, 'custom-a')
    const second = join(root, 'custom-b')
    await writeTeam(first)
    await writeTeam(second)
    const candidates = await discoverTeams(testConfig({ teamDirs: [first, second] }), {})
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].locator.teamDir, join(first, 'demo-team'))
  })

  it('includes the bundled example team at rank 600', async () => {
    const candidates = await discoverTeams(testConfig({ includeBundledTeams: true }), {})
    const bundled = candidates.find((c) => c.name === 'experts-web-review')
    assert.notEqual(bundled, undefined)
    assert.equal(bundled.rank, 600)
    assert.equal(bundled.source, 'bundled')
    assert.equal(bundled.locator.teamDir, join(bundledTeamsDir(), 'web-review'))
  })

  it('a malformed team fails loud with INVALID_TEAM naming the manifest', async () => {
    const badRoot = join(root, 'bad')
    await writeTeam(badRoot, { name: 'broken', experts: [] })
    await assert.rejects(
      () => discoverTeams(testConfig({ teamDirs: [badRoot] }), {}),
      (error) => error.code === 'INVALID_TEAM' && error.message.includes(join(badRoot, 'broken', 'team.json')),
    )
  })

  it('an aborted signal yields an incomplete observation', async () => {
    const userRoot = join(root, 'user2')
    await writeTeam(userRoot)
    const controller = new AbortController()
    controller.abort()
    const result = await discoverTeams(testConfig({ teamDirs: [userRoot] }), { signal: controller.signal })
    assert.equal(result.complete, false)
    assert.deepEqual(result.candidates, [])
  })
})

describe('loadTeam', () => {
  it('composes a full definition for a listed candidate', async () => {
    const userRoot = await tempDir()
    try {
      await writeTeam(userRoot)
      const candidates = await discoverTeams(testConfig({ teamDirs: [userRoot] }), {})
      const definition = await loadTeam(testConfig({ teamDirs: [userRoot] }), candidates[0], {})
      assert.equal(definition.name, 'experts-demo-team')
      assert.equal(typeof definition.content, 'string')
      assert.ok(definition.content.length > 200)
      assert.ok(definition.content.includes('# 专家团：demo-team'))
    } finally {
      await cleanup(userRoot)
    }
  })

  it('rejects a candidate without a provider locator', async () => {
    await assert.rejects(
      () => loadTeam(testConfig(), { name: 'experts-x' }, {}),
      (error) => error.code === 'INVALID_CONFIG',
    )
  })

  it('returns undefined when the caller already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const definition = await loadTeam(testConfig(), { locator: { teamDir: 'whatever' } }, { signal: controller.signal })
    assert.equal(definition, undefined)
  })
})
