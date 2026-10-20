import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRefreshAppCatalogForRuntimeEvent } from '../src/apps/app-runtime-refresh-policy.mjs'

test('Backend health reports do not rebuild the App catalog', () => {
  assert.equal(shouldRefreshAppCatalogForRuntimeEvent({ type: 'status', state: 'running', backendStatus: 'ready' }), false)
  assert.equal(shouldRefreshAppCatalogForRuntimeEvent({ type: 'status', state: 'running', backendStatus: 'degraded' }), false)
  assert.equal(shouldRefreshAppCatalogForRuntimeEvent({ type: 'status', state: 'stopped' }), true)
  assert.equal(shouldRefreshAppCatalogForRuntimeEvent({ type: 'installation-changed' }), true)
})
