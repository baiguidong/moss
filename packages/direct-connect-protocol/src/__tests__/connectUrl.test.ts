import { describe, expect, test } from 'bun:test'
import { buildConnectUrl, parseConnectUrl } from '../index.js'

describe('direct connect URL protocol', () => {
  test('builds and parses an HTTP endpoint', () => {
    const url = buildConnectUrl({ host: '192.168.1.20', port: 43127 })
    expect(url).toBe('cc://192.168.1.20:43127')
    expect(parseConnectUrl(url)).toEqual({
      serverUrl: 'http://192.168.1.20:43127',
      authMode: 'local',
    })
  })

  test('rejects credentials embedded in a connection URL', () => {
    expect(() => parseConnectUrl('cc://localhost:43127?token=secret')).toThrow(
      'Static token URLs are no longer supported',
    )
  })
})
