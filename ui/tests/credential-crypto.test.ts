import { afterEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  attachCredentialBaseSnapshot,
  createCredentialCipher,
  createCredentialEncryptionHeader,
  createCredentialMasterKeyStore,
  mergeCredentialUpdate,
  withPrivateFileLockSync,
  writePrivateFileAtomic,
} from '../../shared/security/credential-crypto.mjs';

const temporaryRoots: string[] = [];

function createTemporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-credential-crypto-'));
  temporaryRoots.push(root);
  return root;
}

function createMasterKeyInSubprocess(primaryPath: string, backupPath: string) {
  const moduleUrl = pathToFileURL(
    path.resolve(import.meta.dir, '../../shared/security/credential-crypto.mjs'),
  ).href;
  const script = `
    import { createCredentialMasterKeyStore } from ${JSON.stringify(moduleUrl)};
    const store = createCredentialMasterKeyStore({
      primaryPath: process.env.TEST_PRIMARY_KEY_PATH,
      backupPath: process.env.TEST_BACKUP_KEY_PATH,
    });
    process.stdout.write(store.loadOrCreate().toString('hex'));
  `;
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        TEST_PRIMARY_KEY_PATH: primaryPath,
        TEST_BACKUP_KEY_PATH: backupPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Key creator exited with code ${code}`));
    });
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('credential crypto', () => {
  it('merges a credential update against changes written after its base snapshot', () => {
    const first = attachCredentialBaseSnapshot({
      mcpOAuth: {
        first: { accessToken: 'old-first' },
        removed: { accessToken: 'remove-me' },
      },
    });
    const second = attachCredentialBaseSnapshot({
      mcpOAuth: {
        first: { accessToken: 'old-first' },
        removed: { accessToken: 'remove-me' },
      },
    });

    first.mcpOAuth.first.accessToken = 'new-first';
    const afterFirst = mergeCredentialUpdate(first, {
      mcpOAuth: {
        first: { accessToken: 'old-first' },
        removed: { accessToken: 'remove-me' },
      },
    });
    delete second.mcpOAuth.removed;

    expect(mergeCredentialUpdate(second, afterFirst)).toEqual({
      mcpOAuth: {
        first: { accessToken: 'new-first' },
      },
    });
  });

  it('overlays additions when an update has no base snapshot', () => {
    expect(mergeCredentialUpdate(
      { mcpOAuth: { second: { accessToken: 'second' } } },
      { mcpOAuth: { first: { accessToken: 'first' } } },
    )).toEqual({
      mcpOAuth: {
        first: { accessToken: 'first' },
        second: { accessToken: 'second' },
      },
    });
  });

  it('encrypts with field-bound authenticated encryption', () => {
    const masterKey = Buffer.alloc(32, 7);
    const identity = 'moss-credentials';
    const scope = 'test-store';
    const header = createCredentialEncryptionHeader({ identity, masterKey });
    const cipher = createCredentialCipher({ identity, scope, masterKey, header });

    const first = cipher.encryptString('private-token', 'connectorFields/mail/API_TOKEN');
    const second = cipher.encryptString('private-token', 'connectorFields/mail/API_TOKEN');

    expect(first.ct).not.toBe(second.ct);
    expect(first.iv).not.toBe(second.iv);
    expect(cipher.decryptString(first, 'connectorFields/mail/API_TOKEN')).toBe('private-token');
    expect(() => cipher.decryptString(first, 'connectorFields/mail/OTHER_TOKEN'))
      .toThrow('authentication failed');

    const tampered = Buffer.from(first.ct, 'base64');
    tampered[0] ^= 1;
    expect(() => cipher.decryptString(
      { ...first, ct: tampered.toString('base64') },
      'connectorFields/mail/API_TOKEN',
    )).toThrow('authentication failed');
  });

  it('rejects a different identity or master key', () => {
    const masterKey = Buffer.alloc(32, 3);
    const header = createCredentialEncryptionHeader({
      identity: 'moss-credentials',
      masterKey,
    });

    expect(() => createCredentialCipher({
      identity: 'another-profile',
      scope: 'test-store',
      masterKey,
      header,
    })).toThrow('another identity');
    expect(() => createCredentialCipher({
      identity: 'moss-credentials',
      scope: 'test-store',
      masterKey: Buffer.alloc(32, 4),
      header,
    })).toThrow('does not match');
  });

  it('creates two private master-key copies and restores either missing copy', () => {
    const root = createTemporaryRoot();
    const primaryPath = path.join(root, 'primary', '.master.key');
    const backupPath = path.join(root, 'backup', '.master.key');
    const keyStore = createCredentialMasterKeyStore({ primaryPath, backupPath });

    const original = keyStore.loadOrCreate();
    expect(original).toHaveLength(32);
    expect(fs.readFileSync(primaryPath)).toEqual(original);
    expect(fs.readFileSync(backupPath)).toEqual(original);
    expect(fs.readFileSync(
      path.join(path.dirname(primaryPath), 'README-DO-NOT-DELETE.txt'),
      'utf8',
    )).toContain('Do not delete .master.key');
    if (process.platform !== 'win32') {
      expect(fs.statSync(primaryPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(primaryPath)).mode & 0o777).toBe(0o700);
    }

    fs.unlinkSync(primaryPath);
    expect(keyStore.load()).toEqual(original);
    expect(fs.readFileSync(primaryPath)).toEqual(original);

    fs.unlinkSync(backupPath);
    expect(keyStore.load()).toEqual(original);
    expect(fs.readFileSync(backupPath)).toEqual(original);
  });

  it('preserves mismatched key copies until an encrypted header selects the valid one', () => {
    const root = createTemporaryRoot();
    const primaryPath = path.join(root, 'primary', '.master.key');
    const backupPath = path.join(root, 'backup', '.master.key');
    const primary = Buffer.alloc(32, 1);
    const backup = Buffer.alloc(32, 2);
    writePrivateFileAtomic(primaryPath, primary);
    writePrivateFileAtomic(backupPath, backup);
    const keyStore = createCredentialMasterKeyStore({ primaryPath, backupPath });

    expect(() => keyStore.load()).toThrow('do not match');
    expect(fs.readFileSync(primaryPath)).toEqual(primary);
    expect(fs.readFileSync(backupPath)).toEqual(backup);

    expect(keyStore.loadMatching((candidate) => candidate.equals(backup))).toEqual(backup);
    expect(fs.readFileSync(primaryPath)).toEqual(backup);
    expect(fs.readFileSync(backupPath)).toEqual(backup);
  });

  it('times out on an active lock and recovers a stale lock', () => {
    const root = createTemporaryRoot();
    const targetPath = path.join(root, 'credentials', 'store.json');
    const lockPath = `${targetPath}.lock`;
    writePrivateFileAtomic(lockPath, 'held');

    expect(() => withPrivateFileLockSync(
      targetPath,
      () => 'unreachable',
      { timeoutMs: 50, staleMs: 10_000 },
    )).toThrow('Timed out waiting');

    const staleTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, staleTime, staleTime);
    expect(withPrivateFileLockSync(
      targetPath,
      () => 'recovered',
      { timeoutMs: 100, staleMs: 1000 },
    )).toBe('recovered');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('creates one shared key when multiple processes start together', async () => {
    const root = createTemporaryRoot();
    const primaryPath = path.join(root, 'primary', '.master.key');
    const backupPath = path.join(root, 'backup', '.master.key');
    const keys = await Promise.all(
      Array.from({ length: 6 }, () => createMasterKeyInSubprocess(primaryPath, backupPath)),
    );

    expect(new Set(keys).size).toBe(1);
    expect(fs.readFileSync(primaryPath, 'hex')).toBe(keys[0]);
    expect(fs.readFileSync(backupPath, 'hex')).toBe(keys[0]);
  });

  it('writes private files atomically with restricted permissions', () => {
    const root = createTemporaryRoot();
    const filePath = path.join(root, 'nested', 'credentials.json');
    writePrivateFileAtomic(filePath, 'encrypted');

    expect(fs.readFileSync(filePath, 'utf8')).toBe('encrypted');
    if (process.platform !== 'win32') {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
    }
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(['credentials.json']);
  });
});
