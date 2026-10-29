import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONNECTOR_CREDENTIALS_FILE_VERSION,
  createConnectorCredentialStore,
} from '../src/connector-credential-store.mjs';

const temporaryRoots: string[] = [];

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-connector-credentials-'));
  temporaryRoots.push(root);
  const storagePath = path.join(root, 'connectors', 'credentials.v3.json');
  return {
    root,
    storagePath,
    store: createConnectorCredentialStore({
      storagePath,
      primaryKeyPath: path.join(root, 'credentials', '.master.key'),
      backupKeyPath: path.join(root, 'key-backup', '.master.key'),
    }),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('connector credential store', () => {
  it('persists only authenticated ciphertext and restores the logical records', () => {
    const { storagePath, store } = createStore();
    const data = {
      connectorFields: {
        mail: {
          API_TOKEN: {
            value: 'connector-secret-value',
            connectorId: 'mail',
            field: 'API_TOKEN',
            updatedAt: '2026-08-28T00:00:00.000Z',
          },
        },
      },
      mcpAccessTokens: {
        'mail:mail-server': {
          value: 'oauth-secret-value',
          connectorId: 'mail',
          serverName: 'mail-server',
          updatedAt: '2026-08-28T00:00:00.000Z',
        },
      },
    };

    store.write(data);
    const serialized = fs.readFileSync(storagePath, 'utf8');
    const document = JSON.parse(serialized);

    expect(serialized).not.toContain('connector-secret-value');
    expect(serialized).not.toContain('oauth-secret-value');
    expect(document.version).toBe(CONNECTOR_CREDENTIALS_FILE_VERSION);
    expect(document.encryption.scheme).toBe('aes-256-gcm');
    expect(document.encryption.kdf).toBe('hkdf-sha256');
    expect(document.connectorFields.mail.API_TOKEN).toMatchObject({
      connectorId: 'mail',
      field: 'API_TOKEN',
    });
    expect(document.connectorFields.mail.API_TOKEN.value).toBeUndefined();
    expect(document.connectorFields.mail.API_TOKEN.type).toBeUndefined();
    expect(document.connectorFields.mail.API_TOKEN.iv).toBeString();
    expect(document.connectorFields.mail.API_TOKEN.tag).toBeString();
    expect(document.connectorFields.mail.API_TOKEN.ct).toBeString();
    expect(store.read()).toEqual(data);
  });

  it('detects records moved between fields', () => {
    const { storagePath, store } = createStore();
    store.write({
      connectorFields: {
        mail: {
          FIRST_TOKEN: { value: 'first', connectorId: 'mail', field: 'FIRST_TOKEN' },
          SECOND_TOKEN: { value: 'second', connectorId: 'mail', field: 'SECOND_TOKEN' },
        },
      },
    });
    const document = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    const first = document.connectorFields.mail.FIRST_TOKEN;
    document.connectorFields.mail.FIRST_TOKEN = document.connectorFields.mail.SECOND_TOKEN;
    document.connectorFields.mail.SECOND_TOKEN = first;
    fs.writeFileSync(storagePath, `${JSON.stringify(document, null, 2)}\n`);

    expect(() => store.read()).toThrow('authentication failed');
  });

  it('encrypts remote server API keys and passwords by server identity', () => {
    const { storagePath, store } = createStore();
    const data = {
      remoteDirectCredentials: {
        abc123: {
          apiKey: {
            value: 'moss_sk_remote.secret',
            field: 'apiKey',
            serverUrl: 'https://moss.example.com',
          },
          userPassword: {
            value: 'remote-password',
            field: 'userPassword',
            serverUrl: 'https://moss.example.com',
          },
        },
      },
    };

    store.write(data);
    const serialized = fs.readFileSync(storagePath, 'utf8');
    expect(serialized).not.toContain('moss_sk_remote.secret');
    expect(serialized).not.toContain('remote-password');
    expect(store.read()).toEqual({
      connectorFields: {},
      mcpAccessTokens: {},
      ...data,
    });
  });

  it('restores encrypted WebSearch keys after restart and unrelated credential updates', () => {
    const { storagePath, store } = createStore();
    const webSearchCredentials = {
      tavilyApiKey: { value: 'tvly-private-value', field: 'tavilyApiKey', updatedAt: '2026-10-29T00:00:00.000Z' },
      braveApiKey: { value: 'brave-private-value', field: 'braveApiKey' },
    };
    store.update((current) => ({ ...current, webSearchCredentials }));

    const serialized = fs.readFileSync(storagePath, 'utf8');
    const document = JSON.parse(serialized);
    expect(serialized).not.toContain('tvly-private-value');
    expect(serialized).not.toContain('brave-private-value');
    expect(document.webSearchCredentials?.tavilyApiKey).toMatchObject({
      field: 'tavilyApiKey', updatedAt: '2026-10-29T00:00:00.000Z',
    });
    expect(document.webSearchCredentials.tavilyApiKey.value).toBeUndefined();
    expect(document.webSearchCredentials.tavilyApiKey.ct).toBeString();

    const reopened = createConnectorCredentialStore({
      storagePath, primaryKeyPath: store.primaryKeyPath, backupKeyPath: store.backupKeyPath,
    });
    expect(reopened.read().webSearchCredentials).toEqual(webSearchCredentials);
    reopened.update((current) => ({
      ...current,
      remoteDirectCredentials: { server: { apiKey: { value: 'server-secret', field: 'apiKey' } } },
    }));
    expect(store.read().webSearchCredentials).toEqual(webSearchCredentials);
  });

  it('deletes only the selected WebSearch key and preserves other credentials', () => {
    const { store } = createStore();
    store.write({
      webSearchCredentials: {
        tavilyApiKey: { value: 'tvly-private-value', field: 'tavilyApiKey' },
        braveApiKey: { value: 'brave-private-value', field: 'braveApiKey' },
      },
      remoteDirectCredentials: { server: { apiKey: { value: 'server-secret', field: 'apiKey' } } },
    });
    store.update((current) => {
      delete current.webSearchCredentials.tavilyApiKey;
      return current;
    });
    expect(store.read().webSearchCredentials).toEqual({
      braveApiKey: { value: 'brave-private-value', field: 'braveApiKey' },
    });
    expect(store.read().remoteDirectCredentials.server.apiKey.value).toBe('server-secret');
    store.update((current) => ({ ...current, webSearchCredentials: {} }));
    expect(store.read().webSearchCredentials || {}).toEqual({});
  });

  it('rejects WebSearch ciphertext moved to another provider', () => {
    const { storagePath, store } = createStore();
    store.write({ webSearchCredentials: {
      tavilyApiKey: { value: 'tvly-private-value', field: 'tavilyApiKey' },
    } });
    const document = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    expect(document.webSearchCredentials?.tavilyApiKey).toBeDefined();
    document.webSearchCredentials.braveApiKey = document.webSearchCredentials.tavilyApiKey;
    delete document.webSearchCredentials.tavilyApiKey;
    fs.writeFileSync(storagePath, JSON.stringify(document));

    expect(() => store.read()).toThrow('authentication failed');
  });

  it('updates against the latest encrypted document while holding the lock', () => {
    const { store } = createStore();
    store.update((credentials) => ({
      ...credentials,
      connectorFields: {
        mail: {
          API_TOKEN: { value: 'connector-secret', connectorId: 'mail', field: 'API_TOKEN' },
        },
      },
    }));
    store.update((credentials) => ({
      ...credentials,
      mcpAccessTokens: {
        'calendar:server': {
          value: 'oauth-secret',
          connectorId: 'calendar',
          serverName: 'server',
        },
      },
    }));

    expect(store.read()).toEqual({
      connectorFields: {
        mail: {
          API_TOKEN: { value: 'connector-secret', connectorId: 'mail', field: 'API_TOKEN' },
        },
      },
      mcpAccessTokens: {
        'calendar:server': {
          value: 'oauth-secret',
          connectorId: 'calendar',
          serverName: 'server',
        },
      },
    });
  });

  it('ignores the unpublished legacy credentials file', () => {
    const { root, storagePath, store } = createStore();
    const legacyPath = path.join(root, 'connectors', 'credentials.json');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, JSON.stringify({ connectorFields: { old: 'data' } }));

    expect(store.read()).toEqual({});
    expect(fs.existsSync(storagePath)).toBe(false);
  });
});
