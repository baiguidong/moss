import { describe, expect, test } from 'bun:test'
import { readBackendSystemSettings } from '../sessionRunnerCli.js'

describe('container runner image settings', () => {
  test('preserves the server image provider through manifest serialization', () => {
    const image = { provider: 'openai', url: 'https://images.test/v1', apiKey: 'server-image-key', model: 'image-model' }
    const manifest = JSON.parse(JSON.stringify({ model: 'text-model', image }))
    const settings = readBackendSystemSettings(manifest)
    expect(settings?.image).toEqual(image)
    expect(settings?.model).toBe('text-model')
  })

  test('legacy or malformed image configuration does not invent credentials', () => {
    expect(readBackendSystemSettings({ model: 'text-model' })?.image).toBeUndefined()
    expect(readBackendSystemSettings({ model: 'text-model', image: { provider: 'openai', model: 123, apiKey: ['key'] } })?.image)
      .toEqual({ provider: 'openai', url: '', model: '', apiKey: '' })
  })
})
