import { describe, expect, it } from 'bun:test';
import {
  applyFeishuPairingAttempt,
  getFeishuAdapterFingerprint,
  getFeishuAdapterRunLocation,
  hasFeishuAdapterCredentials,
  maskAdapterSettings,
  mergeAdapterSettings,
} from '../src/adapter-settings.mjs';

describe('adapter settings', () => {
  it('preserves stored secrets when the renderer submits masked values', () => {
    const current = {
      feishu: {
        appId: 'cli_test',
        appSecret: 'secret-value',
        encryptKey: 'encrypt-value',
      },
    };
    const merged = mergeAdapterSettings(current, {
      feishu: {
        appSecret: '****alue',
        encryptKey: '****alue',
        streamingCard: true,
      },
    });

    expect(merged.feishu.appSecret).toBe('secret-value');
    expect(merged.feishu.encryptKey).toBe('encrypt-value');
    expect(merged.feishu.streamingCard).toBe(true);
  });

  it('masks credentials and pairing codes returned to the renderer', () => {
    const masked = maskAdapterSettings({
      pairing: { code: 'ABC234' },
      telegram: { botToken: 'telegram-secret' },
      feishu: { appSecret: 'feishu-secret', verificationToken: 'verify-secret' },
    });

    expect(masked.pairing.code).toBe('******');
    expect(masked.telegram).toBeUndefined();
    expect(masked.feishu.appSecret).toBe('****cret');
    expect(masked.feishu.verificationToken).toBe('****cret');
  });

  it('starts only with an app id and app secret and restarts for runtime changes', () => {
    expect(hasFeishuAdapterCredentials({ feishu: { appId: 'cli_test' } })).toBe(false);
    const first = {
      feishu: { appId: 'cli_test', appSecret: 'secret', streamingCard: false },
    };
    const second = {
      feishu: { appId: 'cli_test', appSecret: 'secret', streamingCard: true },
    };
    expect(hasFeishuAdapterCredentials(first)).toBe(true);
    expect(getFeishuAdapterFingerprint(first)).not.toBe(getFeishuAdapterFingerprint(second));
  });

  it('defaults Feishu to Desktop and accepts explicit Server hosting', () => {
    expect(getFeishuAdapterRunLocation({})).toBe('desktop');
    expect(getFeishuAdapterRunLocation({ feishu: { runLocation: 'desktop' } })).toBe('desktop');
    expect(getFeishuAdapterRunLocation({ feishu: { runLocation: 'server' } })).toBe('server');
  });

  it('applies a one-time Feishu pairing without mutating unrelated settings', () => {
    const current = {
      model: 'test-model',
      pairing: { code: 'ABC234', expiresAt: 2_000, createdAt: 100 },
      feishu: { appId: 'cli_test', appSecret: 'secret', pairedUsers: [] },
    };
    expect(applyFeishuPairingAttempt(current, {
      code: 'wrong', openId: 'ou_user', now: 1_000,
    }).matched).toBe(false);
    const result = applyFeishuPairingAttempt(current, {
      code: ' abc234 ', openId: 'ou_user', displayName: 'User', now: 1_000,
    });
    expect(result.matched).toBe(true);
    expect(result.config.model).toBe('test-model');
    expect(result.config.feishu.pairedUsers).toEqual([{
      userId: 'ou_user', displayName: 'User', pairedAt: 1_000,
    }]);
    expect(result.config.pairing).toEqual({ code: null, expiresAt: null, createdAt: null });
    expect(current.feishu.pairedUsers).toEqual([]);
  });
});
