import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createWebSearchCapabilityStore,
  getWebSearchCapabilityFingerprint,
  normalizeWebSearchSettings,
  resolveWebSearchProviders,
  toPublicWebSearchSettings,
} from '../src/web-search-capability.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('WebSearch capability settings', () => {
  it('uses configured providers before a detected native endpoint', () => {
    const settings = normalizeWebSearchSettings({
      mode: 'auto',
      tavilyApiKey: 'tavily-secret',
      braveApiKey: 'brave-secret',
    });

    expect(resolveWebSearchProviders(settings, { status: 'supported' }))
      .toEqual(['tavily', 'brave', 'native']);
    expect(resolveWebSearchProviders(settings, { status: 'unknown' }))
      .toEqual(['tavily', 'brave']);
    expect(resolveWebSearchProviders({ ...settings, mode: 'disabled' }, { status: 'supported' }))
      .toEqual([]);
  });

  it('does not expose native WebSearch until the endpoint was detected', () => {
    expect(resolveWebSearchProviders({ mode: 'auto' }, { status: 'unknown' })).toEqual([]);
    expect(resolveWebSearchProviders({ mode: 'native' }, { status: 'unsupported' })).toEqual([]);
    expect(resolveWebSearchProviders({ mode: 'native' }, { status: 'compatible' }))
      .toEqual(['native']);
  });

  it('masks API keys in renderer payloads', () => {
    const payload = toPublicWebSearchSettings({
      mode: 'auto',
      tavilyApiKey: 'tavily-secret',
      braveApiKey: 'brave-secret',
    }, { status: 'supported', format: 'structured', checkedAt: 123, reasonCode: null });

    expect(payload).toMatchObject({
      tavilyApiKey: '',
      braveApiKey: '',
      tavilyConfigured: true,
      braveConfigured: true,
      activeProvider: 'tavily',
    });
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('persists capabilities by endpoint, model, and credential fingerprint', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-web-search-'));
    temporaryRoots.push(root);
    const storagePath = path.join(root, 'capabilities.json');
    const firstFingerprint = getWebSearchCapabilityFingerprint({
      url: 'https://models.example.com/v1',
      model: 'model-a',
      apiKey: 'first-key',
    });
    const secondFingerprint = getWebSearchCapabilityFingerprint({
      url: 'https://models.example.com/v1',
      model: 'model-a',
      apiKey: 'second-key',
    });
    const store = createWebSearchCapabilityStore({ storagePath });

    store.set(firstFingerprint, {
      status: 'compatible',
      format: 'compatible-text',
      reasonCode: null,
    });

    expect(firstFingerprint).not.toBe(secondFingerprint);
    expect(store.get(secondFingerprint)).toBeNull();
    expect(createWebSearchCapabilityStore({ storagePath }).get(firstFingerprint))
      .toMatchObject({ status: 'compatible', format: 'compatible-text' });
    const serialized = fs.readFileSync(storagePath, 'utf8');
    expect(serialized).not.toContain('first-key');
  });
});
