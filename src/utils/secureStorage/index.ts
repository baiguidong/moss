import { createFallbackStorage } from './fallbackStorage.js'
import { encryptedFileStorage } from './encryptedFileStorage.js'
import { macOsKeychainStorage } from './macOsKeychainStorage.js'
import type { SecureStorage } from './types.js'

/**
 * Get the appropriate secure storage implementation for the current platform
 */
export function getSecureStorage(): SecureStorage {
  return getSecureStorageForPlatform(process.platform)
}

export function getSecureStorageForPlatform(platform: NodeJS.Platform): SecureStorage {
  return platform === 'darwin'
    ? createFallbackStorage(macOsKeychainStorage, encryptedFileStorage)
    : encryptedFileStorage
}
