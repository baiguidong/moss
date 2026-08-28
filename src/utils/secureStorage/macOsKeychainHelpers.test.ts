import { afterEach, describe, expect, it } from 'bun:test'
import { mergeCredentialUpdate } from '../../../shared/security/credential-update.mjs'
import {
  clearKeychainCache,
  getMacOsKeychainStorageServiceName,
  keychainCacheState,
  MOSS_CREDENTIALS_SERVICE_NAME,
  primeKeychainCacheFromPrefetch,
} from './macOsKeychainHelpers.js'

afterEach(() => {
  clearKeychainCache()
})

describe('macOS keychain service naming', () => {
  it('uses the Moss credential service without an upstream product name', () => {
    expect(MOSS_CREDENTIALS_SERVICE_NAME).toBe('moss-credentials')
    expect(getMacOsKeychainStorageServiceName()).toBe('moss-credentials')
  })

  it('keeps a base snapshot on prefetched data so later deletion can be merged', () => {
    primeKeychainCacheFromPrefetch(JSON.stringify({
      mcpOAuth: {
        kept: { accessToken: 'old' },
        removed: { accessToken: 'remove-me' },
      },
    }))
    const proposed = keychainCacheState.cache.data
    if (!proposed?.mcpOAuth) throw new Error('Missing prefetched credentials')
    delete proposed.mcpOAuth.removed

    expect(mergeCredentialUpdate(proposed, {
      mcpOAuth: {
        kept: { accessToken: 'new' },
        removed: { accessToken: 'remove-me' },
      },
    })).toEqual({
      mcpOAuth: {
        kept: { accessToken: 'new' },
      },
    })
  })
})
