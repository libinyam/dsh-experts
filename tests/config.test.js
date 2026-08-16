import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('applies documented defaults', () => {
    const resolved = resolveConfig({})
    assert.equal(resolved.providerName, 'dsh-experts')
    assert.equal(resolved.includeDefaultRoots, true)
    assert.equal(resolved.dshHome, undefined)
    assert.deepEqual(resolved.teamDirs, [])
    assert.equal(resolved.includeBundledTeams, true)
  })

  it('rejects non-object config', () => {
    for (const bad of [null, 'x', 42, []]) {
      assert.throws(() => resolveConfig(bad), (error) => error.code === 'INVALID_CONFIG')
    }
  })

  it('rejects unknown keys with the allowed list in the message (typo protection)', () => {
    assert.throws(
      () => resolveConfig({ teamDir: ['/x'] }),
      (error) => error.code === 'INVALID_CONFIG' && error.message.includes('teamDir') && error.message.includes('teamDirs'),
    )
  })

  it('rejects wrong types per key', () => {
    assert.throws(() => resolveConfig({ providerName: '' }), (e) => e.code === 'INVALID_CONFIG')
    assert.throws(() => resolveConfig({ providerName: 7 }), (e) => e.code === 'INVALID_CONFIG')
    assert.throws(() => resolveConfig({ includeDefaultRoots: 'yes' }), (e) => e.code === 'INVALID_CONFIG')
    assert.throws(() => resolveConfig({ dshHome: '  ' }), (e) => e.code === 'INVALID_CONFIG')
    assert.throws(() => resolveConfig({ teamDirs: 'not-an-array' }), (e) => e.code === 'INVALID_CONFIG')
    assert.throws(() => resolveConfig({ teamDirs: ['ok', ''] }), (e) => e.code === 'INVALID_CONFIG')
    assert.throws(() => resolveConfig({ includeBundledTeams: 1 }), (e) => e.code === 'INVALID_CONFIG')
  })
})
