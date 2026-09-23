import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  createCredentialCipher,
  createCredentialEncryptionHeader,
  createCredentialMasterKeyStore,
  getMossCredentialMasterKeyPaths,
  readPrivateFile,
  withPrivateFileLockSync,
  writePrivateFileAtomic,
} from '../../../shared/security/credential-crypto.mjs'
import type { CredentialEnvelope } from '../../../shared/security/credential-crypto.mjs'

type SecretValues = Record<string, Record<string, string>>
type EncryptedDocument = {
  version: 1
  encryption: Record<string, unknown>
  values: Record<string, Record<string, CredentialEnvelope>>
}

export class ServerCredentialStore {
  private readonly storagePath: string
  private readonly legacyStoragePath: string
  private readonly keys: ReturnType<typeof createCredentialMasterKeyStore>
  private readonly identity = 'moss-server-credentials'
  private readonly scope = 'service-secrets'

  constructor(rootDir: string) {
    this.storagePath = join(rootDir, 'credentials', 'server-secrets.json')
    this.legacyStoragePath = join(rootDir, 'credentials', 'app-secrets.json')
    const paths = getMossCredentialMasterKeyPaths(rootDir)
    this.keys = createCredentialMasterKeyStore({ primaryPath: paths.primaryPath, backupPath: paths.backupPath })
  }

  private key(namespace: string, recordId: string): string { return `${namespace}/${recordId}` }

  private readFrom(
    storagePath: string,
    identity: string,
    scope: string,
  ): { values: SecretValues; document: EncryptedDocument; masterKey: Buffer } {
    const document = JSON.parse(readPrivateFile(storagePath).toString('utf8')) as EncryptedDocument
    if (document.version !== 1 || !document.values || typeof document.values !== 'object') {
      throw new Error('Unsupported Server credential file')
    }
    const masterKey = this.keys.loadMatching(candidate => {
      createCredentialCipher({ identity, scope, masterKey: candidate, header: document.encryption })
      return true
    })
    if (!masterKey) throw new Error('Server credential master key is missing')
    const cipher = createCredentialCipher({ identity, scope, masterKey, header: document.encryption })
    const values: SecretValues = {}
    for (const [scopeKey, fields] of Object.entries(document.values)) {
      values[scopeKey] = {}
      for (const [field, envelope] of Object.entries(fields)) {
        values[scopeKey]![field] = cipher.decryptString(envelope, JSON.stringify([scopeKey, field]))
      }
    }
    return { values, document, masterKey }
  }

  private read(): { values: SecretValues; document: EncryptedDocument | null; masterKey: Buffer | null } {
    if (existsSync(this.storagePath)) {
      return this.readFrom(this.storagePath, this.identity, this.scope)
    }
    if (existsSync(this.legacyStoragePath)) {
      const legacy = this.readFrom(
        this.legacyStoragePath,
        'moss-server-app-credentials',
        'app-instance-secrets',
      )
      return { values: legacy.values, document: null, masterKey: legacy.masterKey }
    }
    return { values: {}, document: null, masterKey: null }
  }

  private update(mutator: (values: SecretValues) => SecretValues): void {
    withPrivateFileLockSync(this.storagePath, () => {
      const current = this.read()
      const values = mutator(structuredClone(current.values))
      const masterKey = current.masterKey || this.keys.loadOrCreate()
      const encryption = current.document?.encryption || createCredentialEncryptionHeader({ identity: this.identity, masterKey })
      const cipher = createCredentialCipher({ identity: this.identity, scope: this.scope, masterKey, header: encryption })
      const encrypted: EncryptedDocument['values'] = {}
      for (const [scopeKey, fields] of Object.entries(values)) {
        encrypted[scopeKey] = {}
        for (const [field, value] of Object.entries(fields)) {
          encrypted[scopeKey]![field] = cipher.encryptString(value, JSON.stringify([scopeKey, field]))
        }
      }
      writePrivateFileAtomic(this.storagePath, `${JSON.stringify({ version: 1, encryption, values: encrypted }, null, 2)}\n`)
    })
  }

  async get(namespace: string, recordId: string): Promise<Record<string, string>> {
    return this.read().values[this.key(namespace, recordId)] || {}
  }

  async set(namespace: string, recordId: string, values: Record<string, string>): Promise<void> {
    this.update(all => { all[this.key(namespace, recordId)] = { ...values }; return all })
  }

  async remove(namespace: string, recordId: string): Promise<void> {
    this.update(all => { delete all[this.key(namespace, recordId)]; return all })
  }

  async removeNamespace(namespace: string): Promise<void> {
    this.update(all => {
      for (const key of Object.keys(all)) if (key.startsWith(`${namespace}/`)) delete all[key]
      return all
    })
  }
}
