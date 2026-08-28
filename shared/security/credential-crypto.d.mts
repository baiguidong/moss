export type CredentialEncryptionHeader = {
  scheme: 'aes-256-gcm';
  kdf: 'hkdf-sha256';
  salt: string;
  identityCheck: string;
  keyCheck: string;
  createdAt: number;
};

export type CredentialEnvelope = {
  iv: string;
  tag: string;
  ct: string;
};

export type CredentialCipher = {
  encryptString(value: string, fieldPath: string): CredentialEnvelope;
  decryptString(envelope: CredentialEnvelope, fieldPath: string): string;
};

export type CredentialMasterKeyStore = {
  primaryPath: string;
  backupPath: string;
  load(): Buffer | null;
  loadOrCreate(): Buffer;
  loadMatching(matches: (key: Buffer) => boolean): Buffer | null;
};

export const CREDENTIAL_ENCRYPTION_SCHEME: 'aes-256-gcm';
export const CREDENTIAL_KDF: 'hkdf-sha256';

export function ensurePrivateDirectory(directoryPath: string): void;
export function ensurePrivateFile(filePath: string): void;
export function readPrivateFile(filePath: string): Buffer;
export function writePrivateFileAtomic(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
): void;
export function withPrivateFileLockSync<T>(
  targetPath: string,
  operation: () => T & (T extends PromiseLike<unknown> ? never : unknown),
  options?: { timeoutMs?: number; staleMs?: number },
): T;
export function attachCredentialBaseSnapshot<T extends Record<string, unknown>>(data: T): T;
export function mergeCredentialUpdate<T extends Record<string, unknown>>(
  proposed: T,
  current: T | null | undefined,
): T;
export function createCredentialMasterKeyStore(options: {
  primaryPath: string;
  backupPath: string;
}): CredentialMasterKeyStore;
export function getMossCredentialMasterKeyPaths(
  configDirectory: string,
  homeDirectory?: string,
): { primaryPath: string; backupPath: string };
export function createCredentialEncryptionHeader(options: {
  identity: string;
  masterKey: Buffer;
}): CredentialEncryptionHeader;
export function createCredentialCipher(options: {
  identity: string;
  scope: string;
  masterKey: Buffer;
  header: CredentialEncryptionHeader | Record<string, unknown>;
}): CredentialCipher;
