import { createCredentialCipher, createCredentialEncryptionHeader, createCredentialMasterKeyStore, getMossCredentialMasterKeyPaths } from '../../../shared/security/credential-crypto.mjs'

// Shares must remain copyable by their owner after restarting Desktop. Keep the
// recoverable token/code encrypted in the database, bound to this specific row.
export class ShareSecrets {
  private keys: ReturnType<typeof createCredentialMasterKeyStore>
  private identity = 'moss-cloud-shares'
  constructor(root: string) {
    this.keys = createCredentialMasterKeyStore(getMossCredentialMasterKeyPaths(root))
  }
  encrypt(id: string, value: { token: string; accessCode: string | null }) {
    const masterKey = this.keys.loadOrCreate()
    const header = createCredentialEncryptionHeader({ identity: this.identity, masterKey })
    const cipher = createCredentialCipher({ identity: this.identity, scope: 'share', masterKey, header })
    return JSON.stringify({ header, value: cipher.encryptString(JSON.stringify(value), id) })
  }
  decrypt(id: string, text: string): { token: string; accessCode: string | null } {
    const { header, value } = JSON.parse(text)
    const options = { identity: this.identity, scope: 'share', header }
    const masterKey = this.keys.loadMatching(key => { createCredentialCipher({ ...options, masterKey: key }); return true })
    if (!masterKey) throw new Error('Share encryption key is unavailable')
    return JSON.parse(createCredentialCipher({ ...options, masterKey }).decryptString(value, id))
  }
}
