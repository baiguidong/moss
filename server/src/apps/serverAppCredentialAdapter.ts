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

export class ServerAppCredentialAdapter {
  private readonly storagePath: string
  private readonly keys: ReturnType<typeof createCredentialMasterKeyStore>
  private readonly identity = 'moss-server-app-credentials'
  private readonly scope = 'app-instance-secrets'

  constructor(rootDir: string) {
    this.storagePath = join(rootDir, 'credentials', 'app-secrets.json')
    const paths = getMossCredentialMasterKeyPaths(rootDir)
    this.keys = createCredentialMasterKeyStore({ primaryPath: paths.primaryPath, backupPath: paths.backupPath })
  }

  private key(appId: string, instanceId: string): string { return `${appId}/${instanceId}` }

  private read(): { values: SecretValues; document: EncryptedDocument | null; masterKey: Buffer | null } {
    if (!existsSync(this.storagePath)) return { values: {}, document: null, masterKey: null }
    const document = JSON.parse(readPrivateFile(this.storagePath).toString('utf8')) as EncryptedDocument
    if (document.version !== 1 || !document.values || typeof document.values !== 'object') throw new Error('Unsupported Server App credential file')
    const masterKey = this.keys.loadMatching(candidate => {
      createCredentialCipher({ identity: this.identity, scope: this.scope, masterKey: candidate, header: document.encryption })
      return true
    })
    if (!masterKey) throw new Error('Server App credential master key is missing')
    const cipher = createCredentialCipher({ identity: this.identity, scope: this.scope, masterKey, header: document.encryption })
    const values: SecretValues = {}
    for (const [scopeKey, fields] of Object.entries(document.values)) {
      values[scopeKey] = {}
      for (const [field, envelope] of Object.entries(fields)) {
        values[scopeKey]![field] = cipher.decryptString(envelope, JSON.stringify([scopeKey, field]))
      }
    }
    return { values, document, masterKey }
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

  async get(appId: string, instanceId: string): Promise<Record<string, string>> {
    return this.read().values[this.key(appId, instanceId)] || {}
  }
  async set(appId: string, instanceId: string, values: Record<string, string>): Promise<void> {
    this.update(all => { all[this.key(appId, instanceId)] = { ...values }; return all })
  }
  async remove(appId: string, instanceId: string): Promise<void> {
    this.update(all => { delete all[this.key(appId, instanceId)]; return all })
  }
  async removeApp(appId: string): Promise<void> {
    this.update(all => {
      for (const key of Object.keys(all)) if (key.startsWith(`${appId}/`)) delete all[key]
      return all
    })
  }
}
