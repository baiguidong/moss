import { existsSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  attachCredentialBaseSnapshot,
  createCredentialCipher,
  createCredentialEncryptionHeader,
  createCredentialMasterKeyStore,
  getMossCredentialMasterKeyPaths,
  mergeCredentialUpdate,
  readPrivateFile,
  withPrivateFileLockSync,
  writePrivateFileAtomic,
} from '../../../shared/security/credential-crypto.mjs'
import { logForDebugging } from '../debug.js'
import { getMossConfigHomeDir } from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import type { SecureStorage, SecureStorageData } from './types.js'

export const ENCRYPTED_SECURE_STORAGE_VERSION = 3

const STORAGE_FILE_NAME = '.credentials.v3.json'
const STORAGE_IDENTITY = 'moss-credentials'
const STORAGE_SCOPE = 'standard-mcp-oauth'
const STORAGE_FIELD_PATH = 'secure-storage-data'

type EncryptedFileStorageOptions = {
  storagePath: string
  primaryKeyPath: string
  backupKeyPath: string
  identity?: string
}

type EncryptedStorageDocument = {
  version: number
  encryption: Record<string, unknown>
  payload: {
    iv: string
    tag: string
    ct: string
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseEncryptedDocument(storagePath: string): EncryptedStorageDocument {
  const parsed: unknown = jsonParse(readPrivateFile(storagePath).toString('utf8'))
  if (
    !isPlainObject(parsed) ||
    parsed.version !== ENCRYPTED_SECURE_STORAGE_VERSION ||
    !isPlainObject(parsed.encryption) ||
    !isPlainObject(parsed.payload) ||
    typeof parsed.payload.iv !== 'string' ||
    typeof parsed.payload.tag !== 'string' ||
    typeof parsed.payload.ct !== 'string'
  ) {
    throw new Error('Unsupported encrypted credential file format.')
  }
  return parsed as EncryptedStorageDocument
}

export function createEncryptedFileStorage({
  storagePath,
  primaryKeyPath,
  backupKeyPath,
  identity = STORAGE_IDENTITY,
}: EncryptedFileStorageOptions): SecureStorage {
  const keyStore = createCredentialMasterKeyStore({
    primaryPath: primaryKeyPath,
    backupPath: backupKeyPath,
  })

  const read = (): SecureStorageData | null => {
    if (!existsSync(storagePath)) return null
    try {
      const document = parseEncryptedDocument(storagePath)
      const masterKey = keyStore.loadMatching((candidate: Buffer) => {
        createCredentialCipher({
          identity,
          scope: STORAGE_SCOPE,
          masterKey: candidate,
          header: document.encryption,
        })
        return true
      })
      if (!masterKey) throw new Error('Credential master key is missing.')
      const cipher = createCredentialCipher({
        identity,
        scope: STORAGE_SCOPE,
        masterKey,
        header: document.encryption,
      })
      const decrypted: unknown = jsonParse(
        cipher.decryptString(document.payload, STORAGE_FIELD_PATH),
      )
      if (!isPlainObject(decrypted)) {
        throw new Error('Decrypted credential data is invalid.')
      }
      return attachCredentialBaseSnapshot(decrypted) as SecureStorageData
    } catch (error) {
      logForDebugging('[secure-storage] encrypted credential read failed', {
        level: 'warn',
      })
      return null
    }
  }

  return {
    name: 'encrypted-file',
    read,

    async readAsync(): Promise<SecureStorageData | null> {
      return read()
    },

    update(data: SecureStorageData): { success: boolean } {
      try {
        return withPrivateFileLockSync(storagePath, () => {
          const storageExists = existsSync(storagePath)
          const existingDocument = storageExists
            ? parseEncryptedDocument(storagePath)
            : null
          const masterKey = existingDocument
            ? keyStore.loadMatching((candidate: Buffer) => {
                createCredentialCipher({
                  identity,
                  scope: STORAGE_SCOPE,
                  masterKey: candidate,
                  header: existingDocument.encryption,
                })
                return true
              })
            : keyStore.loadOrCreate()
          if (!masterKey) throw new Error('Credential master key is missing.')
          const encryption = existingDocument?.encryption
            ?? createCredentialEncryptionHeader({ identity, masterKey })
          const cipher = createCredentialCipher({
            identity,
            scope: STORAGE_SCOPE,
            masterKey,
            header: encryption,
          })
          const currentData: unknown = existingDocument
            ? jsonParse(cipher.decryptString(existingDocument.payload, STORAGE_FIELD_PATH))
            : {}
          if (!isPlainObject(currentData)) {
            throw new Error('Decrypted credential data is invalid.')
          }
          const nextData = mergeCredentialUpdate(data, currentData) as SecureStorageData
          const document = {
            version: ENCRYPTED_SECURE_STORAGE_VERSION,
            encryption,
            payload: cipher.encryptString(jsonStringify(nextData), STORAGE_FIELD_PATH),
          }
          writePrivateFileAtomic(storagePath, `${jsonStringify(document)}\n`)
          return { success: true }
        })
      } catch (error) {
        logForDebugging('[secure-storage] encrypted credential write failed', {
          level: 'warn',
        })
        return { success: false }
      }
    },

    delete(): boolean {
      try {
        return withPrivateFileLockSync(storagePath, () => {
          try {
            unlinkSync(storagePath)
            return true
          } catch (error) {
            return getErrnoCode(error) === 'ENOENT'
          }
        })
      } catch (error) {
        return false
      }
    },
  }
}

function createDefaultEncryptedFileStorage(): SecureStorage {
  const configDirectory = getMossConfigHomeDir()
  const keyPaths = getMossCredentialMasterKeyPaths(configDirectory, homedir())
  return createEncryptedFileStorage({
    storagePath: join(configDirectory, STORAGE_FILE_NAME),
    primaryKeyPath: keyPaths.primaryPath,
    backupKeyPath: keyPaths.backupPath,
  })
}

export const encryptedFileStorage = {
  name: 'encrypted-file',
  read: () => createDefaultEncryptedFileStorage().read(),
  readAsync: () => createDefaultEncryptedFileStorage().readAsync(),
  update: (data: SecureStorageData) => createDefaultEncryptedFileStorage().update(data),
  delete: () => createDefaultEncryptedFileStorage().delete(),
} satisfies SecureStorage
