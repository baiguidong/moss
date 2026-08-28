import fs from 'node:fs';
import {
  createCredentialCipher,
  createCredentialEncryptionHeader,
  createCredentialMasterKeyStore,
  readPrivateFile,
  withPrivateFileLockSync,
  writePrivateFileAtomic,
} from '../../shared/security/credential-crypto.mjs';

export const CONNECTOR_CREDENTIALS_FILE_VERSION = 3;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseEncryptedDocument(storagePath) {
  let parsed;
  try {
    parsed = JSON.parse(readPrivateFile(storagePath).toString('utf8'));
  } catch (error) {
    throw new Error(`Unable to read encrypted connector credentials: ${error?.message || String(error)}`);
  }
  if (
    !isPlainObject(parsed)
    || parsed.version !== CONNECTOR_CREDENTIALS_FILE_VERSION
    || !isPlainObject(parsed.encryption)
  ) {
    throw new Error('Unsupported connector credential file format.');
  }
  return parsed;
}

function recordPath(...parts) {
  return JSON.stringify(parts);
}

function getRecordMetadata(record) {
  return Object.fromEntries(
    ['connectorId', 'field', 'serverName', 'updatedAt']
      .filter((key) => typeof record[key] === 'string')
      .map((key) => [key, record[key]]),
  );
}

function decryptRecord(cipher, record, fieldPath) {
  if (!isPlainObject(record)) throw new Error('Invalid encrypted connector credential record.');
  return {
    ...getRecordMetadata(record),
    value: cipher.decryptString(
      { iv: record.iv, tag: record.tag, ct: record.ct },
      fieldPath,
    ),
  };
}

function encryptRecord(cipher, record, fieldPath) {
  if (!isPlainObject(record) || typeof record.value !== 'string') {
    throw new Error('Invalid connector credential record.');
  }
  return {
    ...getRecordMetadata(record),
    ...cipher.encryptString(record.value, fieldPath),
  };
}

function decryptDocument(document, cipher) {
  const result = { connectorFields: {}, mcpAccessTokens: {} };
  const connectorFields = isPlainObject(document.connectorFields) ? document.connectorFields : {};
  for (const [connectorId, records] of Object.entries(connectorFields)) {
    if (!isPlainObject(records)) throw new Error('Invalid connector credential field group.');
    result.connectorFields[connectorId] = {};
    for (const [field, record] of Object.entries(records)) {
      result.connectorFields[connectorId][field] = decryptRecord(
        cipher,
        record,
        recordPath('connectorFields', connectorId, field),
      );
    }
  }

  const mcpAccessTokens = isPlainObject(document.mcpAccessTokens) ? document.mcpAccessTokens : {};
  for (const [key, record] of Object.entries(mcpAccessTokens)) {
    result.mcpAccessTokens[key] = decryptRecord(
      cipher,
      record,
      recordPath('mcpAccessTokens', key),
    );
  }
  return result;
}

function encryptDocument(data, cipher, header) {
  const document = {
    version: CONNECTOR_CREDENTIALS_FILE_VERSION,
    encryption: header,
    connectorFields: {},
    mcpAccessTokens: {},
  };
  const connectorFields = isPlainObject(data?.connectorFields) ? data.connectorFields : {};
  for (const [connectorId, records] of Object.entries(connectorFields)) {
    if (!isPlainObject(records)) throw new Error('Invalid connector credential field group.');
    document.connectorFields[connectorId] = {};
    for (const [field, record] of Object.entries(records)) {
      document.connectorFields[connectorId][field] = encryptRecord(
        cipher,
        record,
        recordPath('connectorFields', connectorId, field),
      );
    }
  }

  const mcpAccessTokens = isPlainObject(data?.mcpAccessTokens) ? data.mcpAccessTokens : {};
  for (const [key, record] of Object.entries(mcpAccessTokens)) {
    document.mcpAccessTokens[key] = encryptRecord(
      cipher,
      record,
      recordPath('mcpAccessTokens', key),
    );
  }
  return document;
}

export function createConnectorCredentialStore({
  storagePath,
  primaryKeyPath,
  backupKeyPath,
  identity = 'moss-credentials',
}) {
  const keyStore = createCredentialMasterKeyStore({
    primaryPath: primaryKeyPath,
    backupPath: backupKeyPath,
  });
  const scope = 'connector-credentials';

  const readUnlocked = () => {
    if (!fs.existsSync(storagePath)) return {};
    const document = parseEncryptedDocument(storagePath);
    const masterKey = keyStore.loadMatching((candidate) => {
      createCredentialCipher({
        identity,
        scope,
        masterKey: candidate,
        header: document.encryption,
      });
      return true;
    });
    if (!masterKey) throw new Error('Connector credential master key is missing.');
    const cipher = createCredentialCipher({
      identity,
      scope,
      masterKey,
      header: document.encryption,
    });
    return decryptDocument(document, cipher);
  };

  const update = (mutator) => withPrivateFileLockSync(storagePath, () => {
    if (typeof mutator !== 'function') throw new Error('Credential updater must be a function.');
    const storageExists = fs.existsSync(storagePath);
    const existing = storageExists ? parseEncryptedDocument(storagePath) : null;
    const masterKey = existing
      ? keyStore.loadMatching((candidate) => {
          createCredentialCipher({
            identity,
            scope,
            masterKey: candidate,
            header: existing.encryption,
          });
          return true;
        })
      : keyStore.loadOrCreate();
    if (!masterKey) throw new Error('Connector credential master key is missing.');
    const header = existing?.encryption
      || createCredentialEncryptionHeader({ identity, masterKey });
    const cipher = createCredentialCipher({ identity, scope, masterKey, header });
    const current = existing ? decryptDocument(existing, cipher) : {};
    const next = mutator(current);
    if (!isPlainObject(next)) throw new Error('Credential updater must return an object.');
    const document = encryptDocument(next, cipher, header);
    writePrivateFileAtomic(storagePath, `${JSON.stringify(document, null, 2)}\n`);
    return next;
  });

  return {
    storagePath,
    primaryKeyPath: keyStore.primaryPath,
    backupKeyPath: keyStore.backupPath,

    read() {
      return readUnlocked();
    },

    write(data) {
      return update(() => data);
    },

    update,
  };
}
