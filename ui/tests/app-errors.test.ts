import { describe, expect, it } from 'bun:test'
import {
  APP_ERROR_CODES,
  AppBackendClient,
  AppServiceError,
  createEnvelope,
  serializeError,
} from '../../packages/app-sdk/src/index.mjs'

describe('App error transport', () => {
  it('preserves standard errors, codes, details, and string rejections', () => {
    const details = { retryable: true }
    expect(serializeError(new AppServiceError('CUSTOM_ERROR', 'Try again', details)))
      .toEqual({ code: 'CUSTOM_ERROR', message: 'Try again', details })
    expect(serializeError(new Error('Connection refused'), APP_ERROR_CODES.hostUnavailable))
      .toMatchObject({ code: APP_ERROR_CODES.hostUnavailable, message: 'Connection refused' })
    expect(serializeError('Disconnected')).toMatchObject({ message: 'Disconnected' })
  })

  it('retains native SDK diagnostics without serializing arbitrary response data', () => {
    const response = {
      errCode: 10303,
      errMsg: 'unread count has zero',
      operationID: 'operation-1',
      data: { token: 'private-response-token' },
    }
    expect(serializeError(response)).toEqual({
      code: '10303', message: 'unread count has zero',
      details: { errCode: 10303, errMsg: 'unread count has zero', errDlt: undefined, operationID: 'operation-1' },
    })
    expect(JSON.stringify(serializeError(response))).not.toContain('private-response-token')
    expect(serializeError({ ...response, errDlt: 'More specific reason' }).message).toBe('More specific reason')
  })

  it('uses a readable fallback for empty and non-string errors', () => {
    const circular: any = {}
    circular.self = circular
    for (const error of [null, undefined, {}, circular, { message: {} }, { message: ' ' }]) {
      expect(serializeError(error)).toMatchObject({
        code: APP_ERROR_CODES.backendUnavailable, message: 'Unknown App Backend error',
      })
    }
  })

  it('returns an actionable error and continues serving actions after an object rejection', async () => {
    const sent: any[] = []
    const client = new AppBackendClient({ send: (message: any) => sent.push(message) })
    client.registerAction('read', async () => {
      throw { errCode: 10303, errMsg: 'unread count has zero', operationID: 'read-1' }
    })
    client.registerAction('status', async () => ({ connected: true }))
    await client.handleMessage(createEnvelope('service.init', { generation: 1, launchToken: 'launch-1' }))
    await client.handleMessage(createEnvelope('action.invoke', { name: 'read' }, { id: 'request-1' }))
    expect(sent.at(-1)).toMatchObject({
      type: 'action.error',
      payload: { requestId: 'request-1', error: { code: '10303', message: 'unread count has zero', details: { operationID: 'read-1' } } },
    })
    await client.handleMessage(createEnvelope('action.invoke', { name: 'status' }))
    expect(sent.at(-1)).toMatchObject({ type: 'action.result', payload: { result: { connected: true } } })
  })
})
