import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AppRuntimeHost } from '../src/index.mjs'

for (const failing of [[], ['native'], ['subscription'], ['native', 'subscription', 'backend']]) {
  test(`shutdown attempts all cleanup even if components fail: ${failing.join(', ') || 'none'}`, async () => {
    const calls = []
    const failures = failing.map(name => new Error(`${name} failed`))
    const step = name => {
      calls.push(name)
      const index = failing.indexOf(name)
      if (index >= 0) throw failures[index]
    }
    const host = Object.assign(Object.create(AppRuntimeHost.prototype), {
      nativeAdapterHost: { stop: async reason => { assert.equal(reason, 'shutdown'); step('native') } },
      hostRequests: { cancelWhere: match => { assert.equal(match({}), true); step('requests') } },
      uiHostSubscriptions: new Set([
        { onClosed: error => { assert.equal(error.code, 'APP_ACTION_CANCELED'); step('subscription') } },
        { onClosed: () => step('other-subscription') },
      ]),
      supervisor: { shutdown: async () => step('backend') },
    })
    if (failures.length) {
      await assert.rejects(host.shutdown(), error => {
        assert.ok(error instanceof AggregateError)
        assert.deepEqual(error.errors, failures)
        for (const failure of failures) assert.ok(error.message.includes(failure.message))
        return true
      })
    } else await host.shutdown()
    assert.deepEqual(calls, ['native', 'requests', 'subscription', 'other-subscription', 'backend'])
    assert.equal(host.uiHostSubscriptions.size, 0)
  })
}
