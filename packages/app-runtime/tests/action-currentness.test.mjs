import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AppActionBroker } from '../src/actions/index.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../../app-sdk/src/index.mjs'

test('an Action result is rejected after its App is disabled', async () => {
  let enabled = true
  let releaseInvocation
  let started
  const invoked = new Promise(resolve => { started = resolve })
  const result = new Promise(resolve => { releaseInvocation = resolve })
  const broker = new AppActionBroker({
    supervisor: {
      maxActionTimeoutMs: 1_000,
      invoke: () => { started(); return result },
    },
    packageResolver: async () => ({ manifest: { backend: { actions: [{ name: 'read' }] } } }),
    authorize: () => {
      if (!enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    },
  })

  const pending = broker.invoke({ key: 'fixture', appId: 'fixture' }, 'read', {}, { timeoutMs: 1_000 })
  await invoked
  enabled = false
  releaseInvocation({ value: 'stale' })
  await assert.rejects(pending, { code: APP_ERROR_CODES.disabled })
})
