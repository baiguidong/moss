import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createDesktopSettingsStore,
  normalizeDesktopSettings,
  normalizeMossBaseUrl,
} from '../src/desktop-settings.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('desktop settings', () => {
  it('normalizes legacy and structured model settings into one runtime shape', () => {
    const settings = normalizeDesktopSettings({
      models: {
        text: {
          baseUrl: 'https://models.example.com/v1/',
          apiKey: ' secret ',
          model: 'model-a',
          maxTurns: 42,
          thinking: { mode: 'enabled', budgetTokens: 8192 },
        },
        image: {
          provider: 'provider-a',
          baseUrl: 'https://images.example.com',
          apiKey: 'image-secret',
          model: 'image-a',
        },
      },
      remoteDirect: {
        serverUrl: 'https://remote.example.com/',
        credentialMode: 'api-key',
        apiKey: 'remote-secret',
        profileMode: 'user',
      },
    });

    expect(settings).toMatchObject({
      model: 'model-a',
      maxTurns: 42,
      thinkingMode: 'enabled',
      thinkingBudgetTokens: 8192,
      url: 'https://models.example.com',
      apiKey: 'secret',
      image: {
        provider: 'provider-a',
        url: 'https://images.example.com',
        apiKey: 'image-secret',
        model: 'image-a',
      },
      remoteDirectServerUrl: 'https://remote.example.com/',
      remoteDirectCredentialMode: 'api-key',
      remoteDirectApiKey: 'remote-secret',
      remoteDirectProfileMode: 'user',
    });
  });

  it('removes only a trailing API version from model base URLs', () => {
    expect(normalizeMossBaseUrl('https://example.com/gateway/v1/')).toBe(
      'https://example.com/gateway',
    );
    expect(normalizeMossBaseUrl('https://example.com/v10')).toBe('https://example.com/v10');
  });

  it('does not persist remote login secrets in settings.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-desktop-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const store = createDesktopSettingsStore({ settingsPath });
    store.save({
      ...store.value,
      remoteDirectServerUrl: 'https://moss.example.com',
      remoteDirectCredentialMode: 'api-key',
      remoteDirectApiKey: 'moss_sk_remote.secret',
      remoteDirectUserPassword: 'remote-password',
    });

    const serialized = fs.readFileSync(settingsPath, 'utf8');
    expect(serialized).not.toContain('moss_sk_remote.secret');
    expect(serialized).not.toContain('remote-password');
    const persisted = JSON.parse(serialized);
    expect(persisted.remoteDirect).not.toHaveProperty('apiKey');
    expect(persisted.remoteDirect).not.toHaveProperty('userPassword');
  });
});
