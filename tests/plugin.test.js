import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { apply } from '../src/index.js'

function fakeContext() {
  const registrations = []
  const ctx = {
    skills: {
      registerProvider(create) {
        const provider = create({ signal: new AbortController().signal, invalidate: () => {} })
        registrations.push(provider)
      },
    },
  }
  return { ctx, registrations }
}

describe('apply (plugin entry)', () => {
  it('registers exactly one provider named by config', () => {
    const { ctx, registrations } = fakeContext()
    apply(ctx, {})
    assert.equal(registrations.length, 1)
    assert.equal(registrations[0].name, 'dsh-experts')
    assert.equal(typeof registrations[0].list, 'function')
    assert.equal(typeof registrations[0].get, 'function')
  })

  it('honors providerName override', () => {
    const { ctx, registrations } = fakeContext()
    apply(ctx, { providerName: 'my-experts' })
    assert.equal(registrations[0].name, 'my-experts')
  })

  it('invalid config fails loud instead of registering', () => {
    const { ctx, registrations } = fakeContext()
    assert.throws(() => apply(ctx, { nope: 1 }), (error) => error.code === 'INVALID_CONFIG')
    assert.equal(registrations.length, 0)
  })

  it('list() surfaces the bundled team end-to-end through the provider closure', async () => {
    const { ctx, registrations } = fakeContext()
    apply(ctx, { includeDefaultRoots: false, includeBundledTeams: true })
    const candidates = await registrations[0].list({ cwd: undefined })
    const bundled = candidates.find((c) => c.name === 'experts-web-review')
    assert.notEqual(bundled, undefined)
    const definition = await registrations[0].get(bundled, {})
    assert.ok(definition.content.includes('# 专家团：web-review'))
    assert.equal(definition.provider, 'dsh-experts')
  })
})
