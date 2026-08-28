import { execFileSync } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import fs from 'node:fs';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';

export {
  attachCredentialBaseSnapshot,
  mergeCredentialUpdate,
} from './credential-update.mjs';

// Shared foundation for encrypted Moss credential stores. Base64 is used
// only to serialize random binary values and ciphertext into JSON.
export const CREDENTIAL_ENCRYPTION_SCHEME = 'aes-256-gcm';
export const CREDENTIAL_KDF = 'hkdf-sha256';

const MASTER_KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const CHECK_BYTES = 16;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_STALE_LOCK_MS = 30000;
const LOCK_RETRY_MS = 25;
const HKDF_INFO = 'moss-credentials-v1';
const MASTER_KEY_README_FILE = 'README-DO-NOT-DELETE.txt';
const MASTER_KEY_README = `Moss Credential Encryption
==========================

This directory contains the local master key used to encrypt Moss credentials.
Do not delete .master.key by itself. Deleting it makes encrypted credentials
unreadable and requires affected services to be authorized again.
`;
const FORBIDDEN_WINDOWS_PRINCIPALS = [
  { names: ['Everyone'], sid: 'S-1-1-0' },
  { names: ['Authenticated Users'], sid: 'S-1-5-11' },
  { names: ['BUILTIN\\Users'], sid: 'S-1-5-32-545' },
  { names: ['Guests', 'BUILTIN\\Guests'], sid: 'S-1-5-32-546' },
];
const privatePathVerificationCache = new Map();
const privatePathEnforcementCache = new Map();
const lockWaitState = new Int32Array(new SharedArrayBuffer(4));

function requireNonEmptyString(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requireMasterKey(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error('Credential master key must be 32 bytes.');
  }
  return masterKey;
}

function decodeBase64(value, expectedBytes, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`Invalid credential ${label}.`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (expectedBytes !== null && decoded.length !== expectedBytes) {
    throw new Error(`Invalid credential ${label}.`);
  }
  if (decoded.toString('base64') !== value) {
    throw new Error(`Invalid credential ${label}.`);
  }
  return decoded;
}

function computeCheck(input, salt) {
  return createHash('sha256')
    .update(input)
    .update(salt)
    .digest()
    .subarray(0, CHECK_BYTES);
}

function checksMatch(expected, encoded) {
  try {
    const actual = decodeBase64(encoded, CHECK_BYTES, 'header check');
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function buildAad(identity, scope, fieldPath) {
  return Buffer.from(JSON.stringify([identity, scope, fieldPath]), 'utf8');
}

function assertExpectedPathType(targetPath, directory) {
  const stats = fs.lstatSync(targetPath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Credential path must not be a symbolic link: ${targetPath}`);
  }
  if (directory ? !stats.isDirectory() : !stats.isFile()) {
    throw new Error(`Credential path has an invalid type: ${targetPath}`);
  }
  return stats;
}

function assertPrivatePosixPath(targetPath, directory) {
  const stats = assertExpectedPathType(targetPath, directory);
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error(`Credential path is owned by another user: ${targetPath}`);
  }

  const expectedMode = directory ? PRIVATE_DIRECTORY_MODE : PRIVATE_FILE_MODE;
  if ((stats.mode & 0o777) !== expectedMode) {
    fs.chmodSync(targetPath, expectedMode);
    const repaired = fs.lstatSync(targetPath);
    if ((repaired.mode & 0o777) !== expectedMode) {
      throw new Error(`Credential path permissions could not be secured: ${targetPath}`);
    }
  }
}

function getWindowsPrincipal() {
  const username = process.env.USERNAME?.trim() || userInfo().username;
  const domain = process.env.USERDOMAIN?.trim();
  if (!username) throw new Error('Unable to determine the Windows account name.');
  return domain ? `${domain}\\${username}` : username;
}

function getPathFingerprint(targetPath, directory) {
  const stats = assertExpectedPathType(targetPath, directory);
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}

function hasUnsafeWindowsAcl(acl) {
  const upperAcl = acl.toUpperCase();
  return FORBIDDEN_WINDOWS_PRINCIPALS.some(({ names, sid }) => (
    upperAcl.includes(`${sid}:`)
    || names.some((name) => upperAcl.includes(`${name.toUpperCase()}:`))
  ));
}

function cachePrivatePath(cache, targetPath, directory) {
  cache.set(
    `${directory ? 'directory' : 'file'}:${targetPath}`,
    getPathFingerprint(targetPath, directory),
  );
}

function isPrivatePathCached(cache, targetPath, directory) {
  const cacheKey = `${directory ? 'directory' : 'file'}:${targetPath}`;
  return cache.get(cacheKey) === getPathFingerprint(targetPath, directory);
}

function clearPrivatePathVerification(targetPath) {
  privatePathVerificationCache.delete(`directory:${targetPath}`);
  privatePathVerificationCache.delete(`file:${targetPath}`);
  privatePathEnforcementCache.delete(`directory:${targetPath}`);
  privatePathEnforcementCache.delete(`file:${targetPath}`);
}

function enforcePrivateWindowsPath(targetPath, directory) {
  if (isPrivatePathCached(privatePathEnforcementCache, targetPath, directory)) return;
  const principal = getWindowsPrincipal();
  const permission = directory ? '(OI)(CI)F' : 'F';
  const commandOptions = {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  };

  execFileSync('icacls', [targetPath, '/inheritance:r'], commandOptions);
  for (const { sid } of FORBIDDEN_WINDOWS_PRINCIPALS) {
    try {
      execFileSync('icacls', [targetPath, '/remove:g', `*${sid}`], commandOptions);
    } catch {}
  }
  execFileSync(
    'icacls',
    [targetPath, '/grant:r', `${principal}:${permission}`, `*S-1-5-18:${permission}`],
    commandOptions,
  );

  const acl = execFileSync('icacls', [targetPath], commandOptions);
  if (hasUnsafeWindowsAcl(acl)) {
    throw new Error(`Credential path has an unsafe Windows ACL: ${targetPath}`);
  }
  cachePrivatePath(privatePathVerificationCache, targetPath, directory);
  cachePrivatePath(privatePathEnforcementCache, targetPath, directory);
}

function verifyPrivateWindowsPath(targetPath, directory) {
  if (isPrivatePathCached(privatePathVerificationCache, targetPath, directory)) return;
  const acl = execFileSync('icacls', [targetPath], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (hasUnsafeWindowsAcl(acl)) {
    enforcePrivateWindowsPath(targetPath, directory);
    return;
  }
  cachePrivatePath(privatePathVerificationCache, targetPath, directory);
}

export function ensurePrivateDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  if (process.platform === 'win32') {
    enforcePrivateWindowsPath(directoryPath, true);
  } else {
    assertPrivatePosixPath(directoryPath, true);
  }
}

export function ensurePrivateFile(filePath) {
  if (process.platform === 'win32') {
    enforcePrivateWindowsPath(filePath, false);
  } else {
    assertPrivatePosixPath(filePath, false);
  }
}

export function readPrivateFile(filePath) {
  const directoryPath = path.dirname(filePath);
  if (process.platform === 'win32') {
    verifyPrivateWindowsPath(directoryPath, true);
    verifyPrivateWindowsPath(filePath, false);
  } else {
    assertPrivatePosixPath(directoryPath, true);
    assertPrivatePosixPath(filePath, false);
  }
  return fs.readFileSync(filePath);
}

export function writePrivateFileAtomic(filePath, data) {
  const directoryPath = path.dirname(filePath);
  ensurePrivateDirectory(directoryPath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );

  try {
    const descriptor = fs.openSync(temporaryPath, 'wx', PRIVATE_FILE_MODE);
    try {
      fs.writeFileSync(descriptor, data);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    ensurePrivateFile(temporaryPath);
    clearPrivatePathVerification(filePath);
    fs.renameSync(temporaryPath, filePath);
    ensurePrivateFile(filePath);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {}
    clearPrivatePathVerification(temporaryPath);
  }
}

function waitForLockRetry() {
  Atomics.wait(lockWaitState, 0, 0, LOCK_RETRY_MS);
}

function getErrorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}

export function withPrivateFileLockSync(
  targetPath,
  operation,
  { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS, staleMs = DEFAULT_STALE_LOCK_MS } = {},
) {
  const lockPath = `${path.resolve(targetPath)}.lock`;
  ensurePrivateDirectory(path.dirname(lockPath));
  const deadline = Date.now() + timeoutMs;
  let descriptor;

  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockPath, 'wx', PRIVATE_FILE_MODE);
    } catch (error) {
      if (getErrorCode(error) !== 'EEXIST') throw error;
      try {
        const stats = fs.lstatSync(lockPath);
        if (Date.now() - stats.mtimeMs > staleMs) {
          fs.unlinkSync(lockPath);
          clearPrivatePathVerification(lockPath);
          continue;
        }
      } catch (lockError) {
        if (getErrorCode(lockError) === 'ENOENT') continue;
        throw lockError;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for credential lock: ${targetPath}`);
      }
      waitForLockRetry();
    }
  }

  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    ensurePrivateFile(lockPath);
    return operation();
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch {}
    try {
      fs.unlinkSync(lockPath);
    } catch {}
    clearPrivatePathVerification(lockPath);
  }
}

function readMasterKeyCandidate(keyPath) {
  if (!fs.existsSync(keyPath)) return { exists: false, key: null };
  try {
    return { exists: true, key: requireMasterKey(readPrivateFile(keyPath)) };
  } catch (error) {
    return { exists: true, key: null, error };
  }
}

function ensureMasterKeyReadme(primaryPath) {
  const readmePath = path.join(path.dirname(primaryPath), MASTER_KEY_README_FILE);
  if (!fs.existsSync(readmePath)) {
    writePrivateFileAtomic(readmePath, MASTER_KEY_README);
  }
}

export function createCredentialMasterKeyStore({ primaryPath, backupPath }) {
  const normalizedPrimaryPath = path.resolve(primaryPath);
  const normalizedBackupPath = path.resolve(backupPath);
  if (normalizedPrimaryPath === normalizedBackupPath) {
    throw new Error('Credential master key backup must use a different path.');
  }

  function readCandidates() {
    return {
      primary: readMasterKeyCandidate(normalizedPrimaryPath),
      backup: readMasterKeyCandidate(normalizedBackupPath),
    };
  }

  function copiesMatch(candidates) {
    return Boolean(
      candidates.primary.key
      && candidates.backup.key
      && timingSafeEqual(candidates.primary.key, candidates.backup.key),
    );
  }

  function writeBothCopies(key, candidates = readCandidates()) {
    if (!candidates.primary.key || !timingSafeEqual(candidates.primary.key, key)) {
      writePrivateFileAtomic(normalizedPrimaryPath, key);
    }
    if (!candidates.backup.key || !timingSafeEqual(candidates.backup.key, key)) {
      writePrivateFileAtomic(normalizedBackupPath, key);
    }
  }

  function resolveWithoutHeader({ create }) {
    return withPrivateFileLockSync(normalizedPrimaryPath, () => {
      const candidates = readCandidates();
      if (copiesMatch(candidates)) return candidates.primary.key;
      if (candidates.primary.key && candidates.backup.key) {
        throw new Error('Credential master key copies do not match.');
      }
      const existing = candidates.primary.key || candidates.backup.key;
      if (existing) {
        writeBothCopies(existing, candidates);
        return existing;
      }
      if (candidates.primary.exists || candidates.backup.exists) {
        throw new Error('Credential master key is invalid.');
      }
      if (!create) return null;

      const key = randomBytes(MASTER_KEY_BYTES);
      writeBothCopies(key, candidates);
      ensureMasterKeyReadme(normalizedPrimaryPath);
      return key;
    });
  }

  function load({ create }) {
    const candidates = readCandidates();
    if (copiesMatch(candidates)) return candidates.primary.key;
    return resolveWithoutHeader({ create });
  }

  function getMatchingKeys(candidates, matches) {
    const uniqueKeys = [];
    for (const candidate of [candidates.primary.key, candidates.backup.key]) {
      if (!candidate) continue;
      if (!uniqueKeys.some((key) => timingSafeEqual(key, candidate))) {
        uniqueKeys.push(candidate);
      }
    }
    return uniqueKeys.filter((key) => {
      try {
        return Boolean(matches(key));
      } catch {
        return false;
      }
    });
  }

  function loadMatching(matches) {
    const initialCandidates = readCandidates();
    const initialMatches = getMatchingKeys(initialCandidates, matches);
    if (copiesMatch(initialCandidates) && initialMatches.length === 1) {
      return initialMatches[0];
    }

    return withPrivateFileLockSync(normalizedPrimaryPath, () => {
      const candidates = readCandidates();
      const matchingKeys = getMatchingKeys(candidates, matches);
      if (matchingKeys.length !== 1) {
        if (matchingKeys.length > 1) {
          throw new Error('Multiple credential master keys match the encrypted file.');
        }
        if (candidates.primary.exists || candidates.backup.exists) {
          throw new Error('No credential master key matches the encrypted file.');
        }
        return null;
      }
      writeBothCopies(matchingKeys[0], candidates);
      return matchingKeys[0];
    });
  }

  return {
    primaryPath: normalizedPrimaryPath,
    backupPath: normalizedBackupPath,
    load: () => load({ create: false }),
    loadOrCreate: () => load({ create: true }),
    loadMatching,
  };
}

export function getMossCredentialMasterKeyPaths(configDirectory, homeDirectory = homedir()) {
  const normalizedConfigDirectory = path.resolve(configDirectory);
  const keyId = createHash('sha256')
    .update(normalizedConfigDirectory)
    .digest('hex')
    .slice(0, 16);
  return {
    primaryPath: path.join(normalizedConfigDirectory, 'credentials', '.master.key'),
    backupPath: path.join(
      path.resolve(homeDirectory),
      '.moss-credential-key-backup',
      `${keyId}.key`,
    ),
  };
}

export function createCredentialEncryptionHeader({ identity, masterKey }) {
  const normalizedIdentity = requireNonEmptyString(identity, 'Credential identity');
  const normalizedMasterKey = requireMasterKey(masterKey);
  const salt = randomBytes(SALT_BYTES);
  return {
    scheme: CREDENTIAL_ENCRYPTION_SCHEME,
    kdf: CREDENTIAL_KDF,
    salt: salt.toString('base64'),
    identityCheck: computeCheck(Buffer.from(normalizedIdentity, 'utf8'), salt).toString('base64'),
    keyCheck: computeCheck(normalizedMasterKey, salt).toString('base64'),
    createdAt: Date.now(),
  };
}

export function createCredentialCipher({ identity, scope, masterKey, header }) {
  const normalizedIdentity = requireNonEmptyString(identity, 'Credential identity');
  const normalizedScope = requireNonEmptyString(scope, 'Credential scope');
  const normalizedMasterKey = requireMasterKey(masterKey);
  if (
    !header
    || header.scheme !== CREDENTIAL_ENCRYPTION_SCHEME
    || header.kdf !== CREDENTIAL_KDF
  ) {
    throw new Error('Unsupported credential encryption header.');
  }

  const salt = decodeBase64(header.salt, SALT_BYTES, 'salt');
  if (!checksMatch(computeCheck(Buffer.from(normalizedIdentity, 'utf8'), salt), header.identityCheck)) {
    throw new Error('Credential file belongs to another identity.');
  }
  if (!checksMatch(computeCheck(normalizedMasterKey, salt), header.keyCheck)) {
    throw new Error('Credential master key does not match the encrypted file.');
  }

  const info = Buffer.from(`${HKDF_INFO}\0${normalizedIdentity}\0${normalizedScope}`, 'utf8');
  const encryptionKey = Buffer.from(
    hkdfSync('sha256', normalizedMasterKey, salt, info, MASTER_KEY_BYTES),
  );

  return {
    encryptString(value, fieldPath) {
      const normalizedFieldPath = requireNonEmptyString(fieldPath, 'Credential field path');
      if (typeof value !== 'string') throw new Error('Credential value must be a string.');
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(CREDENTIAL_ENCRYPTION_SCHEME, encryptionKey, iv);
      cipher.setAAD(buildAad(normalizedIdentity, normalizedScope, normalizedFieldPath));
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ct: ciphertext.toString('base64'),
      };
    },

    decryptString(envelope, fieldPath) {
      const normalizedFieldPath = requireNonEmptyString(fieldPath, 'Credential field path');
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        throw new Error('Invalid encrypted credential record.');
      }
      const iv = decodeBase64(envelope.iv, IV_BYTES, 'IV');
      const tag = decodeBase64(envelope.tag, AUTH_TAG_BYTES, 'authentication tag');
      const ciphertext = decodeBase64(envelope.ct, null, 'ciphertext');
      try {
        const decipher = createDecipheriv(CREDENTIAL_ENCRYPTION_SCHEME, encryptionKey, iv);
        decipher.setAAD(buildAad(normalizedIdentity, normalizedScope, normalizedFieldPath));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch {
        throw new Error('Encrypted credential authentication failed.');
      }
    },
  };
}
