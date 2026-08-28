import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getMossCredentialMasterKeyPaths,
  writePrivateFileAtomic,
} from '../../../shared/security/credential-crypto.mjs'
import {
  createEncryptedFileStorage,
  ENCRYPTED_SECURE_STORAGE_VERSION,
} from './encryptedFileStorage.js'
import { getSecureStorageForPlatform } from './index.js'

const temporaryRoots: string[] = []

function createStorage() {
  const root = mkdtempSync(join(tmpdir(), 'moss-standard-mcp-credentials-'))
  temporaryRoots.push(root)
  const storagePath = join(root, '.credentials.v3.json')
  const primaryKeyPath = join(root, 'credentials', '.master.key')
  const backupKeyPath = join(root, 'backup', '.master.key')
  return {
    root,
    storagePath,
    primaryKeyPath,
    backupKeyPath,
    storage: createEncryptedFileStorage({
      storagePath,
      primaryKeyPath,
      backupKeyPath,
    }),
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('encrypted standard MCP credential storage', () => {
  it('persists OAuth data as authenticated ciphertext', async () => {
    const { storage, storagePath, primaryKeyPath, backupKeyPath } = createStorage()
    const data = {
      mcpOAuth: {
        'example-server': {
          accessToken: 'access-token-secret',
          refreshToken: 'refresh-token-secret',
          expiresAt: 123456789,
        },
      },
    }

    expect(storage.update(data)).toEqual({ success: true })
    const serialized = readFileSync(storagePath, 'utf8')
    const document = JSON.parse(serialized)

    expect(serialized).not.toContain('access-token-secret')
    expect(serialized).not.toContain('refresh-token-secret')
    expect(document.version).toBe(ENCRYPTED_SECURE_STORAGE_VERSION)
    expect(document.encryption.scheme).toBe('aes-256-gcm')
    expect(document.encryption.kdf).toBe('hkdf-sha256')
    expect(document.payload).toEqual({
      iv: expect.any(String),
      tag: expect.any(String),
      ct: expect.any(String),
    })
    expect(storage.read()).toEqual(data)
    expect(await storage.readAsync()).toEqual(data)
    expect(readFileSync(primaryKeyPath)).toEqual(readFileSync(backupKeyPath))
  })

  it('rejects tampered ciphertext and refuses to overwrite it', () => {
    const { storage, storagePath } = createStorage()
    expect(storage.update({ mcpOAuth: { server: { accessToken: 'secret' } } }).success).toBe(true)
    const document = JSON.parse(readFileSync(storagePath, 'utf8'))
    const ciphertext = Buffer.from(document.payload.ct, 'base64')
    ciphertext[0] ^= 1
    document.payload.ct = ciphertext.toString('base64')
    writeFileSync(storagePath, `${JSON.stringify(document)}\n`)
    if (process.platform !== 'win32') chmodSync(storagePath, 0o600)
    const tampered = readFileSync(storagePath, 'utf8')

    expect(storage.read()).toBeNull()
    expect(storage.update({ mcpOAuth: {} })).toEqual({ success: false })
    expect(readFileSync(storagePath, 'utf8')).toBe(tampered)
  })

  it('uses the key matching the encrypted header to repair a corrupted primary copy', () => {
    const { storage, primaryKeyPath, backupKeyPath } = createStorage()
    const data = { mcpOAuth: { server: { accessToken: 'secret' } } }
    expect(storage.update(data).success).toBe(true)
    const validBackup = readFileSync(backupKeyPath)
    writePrivateFileAtomic(primaryKeyPath, Buffer.alloc(32, 9))

    expect(storage.read()).toEqual(data)
    expect(readFileSync(primaryKeyPath)).toEqual(validBackup)
    expect(readFileSync(backupKeyPath)).toEqual(validBackup)
  })

  it('preserves disjoint updates and deletions based on concurrent reads', () => {
    const { storage } = createStorage()
    expect(storage.update({
      mcpOAuth: {
        first: { accessToken: 'old-first', expiresAt: 1 },
        removed: { accessToken: 'remove-me', expiresAt: 1 },
      },
    }).success).toBe(true)
    const first = storage.read()
    const second = storage.read()
    if (!first?.mcpOAuth || !second?.mcpOAuth) throw new Error('Missing test credentials')

    first.mcpOAuth.first.accessToken = 'new-first'
    expect(storage.update(first).success).toBe(true)
    delete second.mcpOAuth.removed
    expect(storage.update(second).success).toBe(true)

    expect(storage.read()).toEqual({
      mcpOAuth: {
        first: { accessToken: 'new-first', expiresAt: 1 },
      },
    })
  })

  it('does not overwrite another first write made after a missing-file read', () => {
    const { storage } = createStorage()

    expect(storage.update({
      mcpOAuth: { first: { accessToken: 'first', expiresAt: 1 } },
    }).success).toBe(true)
    expect(storage.update({
      mcpXaaIdp: { issuer: { idToken: 'id-token', expiresAt: 2 } },
    }).success).toBe(true)

    expect(storage.read()).toEqual({
      mcpOAuth: { first: { accessToken: 'first', expiresAt: 1 } },
      mcpXaaIdp: { issuer: { idToken: 'id-token', expiresAt: 2 } },
    })
  })

  it('does not read the unpublished plaintext credential file', () => {
    const { root, storage, storagePath } = createStorage()
    writeFileSync(
      join(root, '.credentials.json'),
      JSON.stringify({ mcpOAuth: { old: { accessToken: 'legacy-secret' } } }),
    )

    expect(storage.read()).toBeNull()
    expect(existsSync(storagePath)).toBe(false)
  })

  it('keeps shared master keys when encrypted OAuth data is deleted', () => {
    const { storage, storagePath, primaryKeyPath, backupKeyPath } = createStorage()
    expect(storage.update({ mcpOAuth: {} }).success).toBe(true)

    expect(storage.delete()).toBe(true)
    expect(existsSync(storagePath)).toBe(false)
    expect(existsSync(primaryKeyPath)).toBe(true)
    expect(existsSync(backupKeyPath)).toBe(true)
  })
})

describe('secure storage platform routing', () => {
  it('never routes standard MCP credentials to plaintext storage', () => {
    expect(getSecureStorageForPlatform('darwin').name)
      .toBe('keychain-with-encrypted-file-fallback')
    expect(getSecureStorageForPlatform('win32').name).toBe('encrypted-file')
    expect(getSecureStorageForPlatform('linux').name).toBe('encrypted-file')
  })

  it('derives stable shared master-key paths for a Moss config directory', () => {
    const root = join(tmpdir(), 'moss-config-profile')
    const first = getMossCredentialMasterKeyPaths(root, join(tmpdir(), 'home'))
    const second = getMossCredentialMasterKeyPaths(root, join(tmpdir(), 'home'))
    const another = getMossCredentialMasterKeyPaths(`${root}-2`, join(tmpdir(), 'home'))

    expect(first).toEqual(second)
    expect(first.primaryPath).toBe(join(root, 'credentials', '.master.key'))
    expect(first.backupPath).not.toBe(another.backupPath)
  })
})
