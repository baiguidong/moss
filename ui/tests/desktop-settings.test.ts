import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildThinkingConfig,
  createDesktopSettingsStore,
  getDeclaredModelContextWindows,
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
  it('defaults selected models to 200k and persists separate context windows', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-context-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const store = createDesktopSettingsStore({ settingsPath });
    store.save({ model: 'self-hosted', fastModel: 'fast-model' });
    expect(getDeclaredModelContextWindows(store.value)).toEqual({
      'self-hosted': 200_000, 'fast-model': 200_000,
    });
    store.save({ declaredContextByModel: { 'self-hosted': 1_000_000, 'fast-model': 200_000 } });
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).models.text.declaredContextByModel)
      .toEqual({ 'self-hosted': 1_000_000, 'fast-model': 200_000 });
    const restarted = createDesktopSettingsStore({ settingsPath });
    expect(getDeclaredModelContextWindows(restarted.value)).toEqual({ 'self-hosted': 1_000_000, 'fast-model': 200_000 });
    restarted.save({ model: 'another-model' });
    expect(getDeclaredModelContextWindows(restarted.value)).toEqual({ 'another-model': 200_000, 'fast-model': 200_000 });
    expect(normalizeDesktopSettings({ declaredContextByModel: { legacy: 258_000, auto: null, medium: 510_000, high: 790_000, large: 1_050_000 } }).declaredContextByModel)
      .toEqual({ legacy: 200_000, auto: 200_000, medium: 500_000, high: 500_000, large: 1_000_000 });
  });
  it('uses model defaults when thinking is unset or the legacy default option is blank', () => {
    for (const input of [{}, { thinkingMode: '' }, { models: { text: { thinking: { mode: '' } } } }]) {
      const settings = normalizeDesktopSettings(input);
      expect(settings.thinkingMode).toBe('auto');
      expect(buildThinkingConfig(settings)).toEqual({ type: 'auto' });
    }
    expect(buildThinkingConfig(undefined)).toEqual({ type: 'auto' });
  });

  it.each(['auto', 'adaptive', 'enabled', 'disabled'])('preserves explicit thinking mode %s across restart and unrelated saves', mode => {
    const previousDisable = process.env.CLAUDE_CODE_DISABLE_THINKING;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-thinking-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ models: { text: { thinking: { mode, budgetTokens: 8192 } } } }));
    try {
      const store = createDesktopSettingsStore({ settingsPath });
      store.save({ language: 'english' });
      const reloaded = createDesktopSettingsStore({ settingsPath });
      expect(reloaded.value.thinkingMode).toBe(mode);
      expect(buildThinkingConfig(reloaded.value)).toEqual(mode === 'enabled' ? { type: mode, budgetTokens: 8192 } : { type: mode });
      reloaded.save({ thinkingMode: 'auto' });
      expect(buildThinkingConfig(createDesktopSettingsStore({ settingsPath }).value)).toEqual({ type: 'auto' });
      expect(process.env.CLAUDE_CODE_DISABLE_THINKING).toBeUndefined();
    } finally {
      if (previousDisable === undefined) delete process.env.CLAUDE_CODE_DISABLE_THINKING;
      else process.env.CLAUDE_CODE_DISABLE_THINKING = previousDisable;
    }
  });

  it('migrates computer control grants and keeps the generic Host setting on subsequent saves', () => {
    const legacy = { computerUse: { enabled:true, apps:[{bundleId:'com.example',name:'Example'}] } };
    const migrated = normalizeDesktopSettings(legacy);
    expect(migrated.desktopControl).toEqual({version:1,enabled:true,apps:[{bundleId:'com.example',name:'Example'}]});
    expect(migrated).not.toHaveProperty('computerUse');
    expect(normalizeDesktopSettings({language:'zh'},migrated).desktopControl).toEqual(migrated.desktopControl);
    expect(normalizeDesktopSettings({desktopControl:{enabled:false}},migrated).desktopControl.enabled).toBe(false);
  });
  it('keeps reply appearance choices across restarts and unrelated settings saves', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-reply-appearance-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ appearance: { themeMode: 'dark' } }));
    const store = createDesktopSettingsStore({ settingsPath });
    expect(store.value.appearance).toMatchObject({ showAssistantMessageBorder: false, showAssistantAvatar: true });
    store.save({ appearance: { showAssistantMessageBorder: true, showAssistantAvatar: false } });
    const restarted = createDesktopSettingsStore({ settingsPath });
    expect(restarted.value.appearance).toMatchObject({ themeMode: 'dark', showAssistantMessageBorder: true, showAssistantAvatar: false });
    restarted.save({ language: 'english' });
    restarted.save({ appearance: { chatFontSize: 16 } });
    expect(createDesktopSettingsStore({ settingsPath }).value.appearance).toMatchObject({
      themeMode: 'dark', chatFontSize: 16, showAssistantMessageBorder: true, showAssistantAvatar: false,
    });
  });

  it('persists a user avatar across restarts and unrelated saves, and can restore the default', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-user-avatar-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const avatar = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="12" fill="blue"/></svg>').toString('base64')}`;
    const store = createDesktopSettingsStore({ settingsPath });
    expect(store.value.userAvatar).toBe('');
    store.save({ userAvatar: avatar });
    const restarted = createDesktopSettingsStore({ settingsPath });
    expect(restarted.getPayload().userAvatar).toBe(avatar);
    restarted.save({ language: 'english' });
    expect(createDesktopSettingsStore({ settingsPath }).value.userAvatar).toBe(avatar);
    restarted.save({ userAvatar: '' });
    expect(createDesktopSettingsStore({ settingsPath }).value.userAvatar).toBe('');
  });

  it('does not select a built-in model when no model is configured', () => {
    expect(normalizeDesktopSettings({}).model).toBe('');
  });

  it('enables the draft box by default and persists an explicit disabled value', () => {
    expect(normalizeDesktopSettings({}).toolCallDrafts).toEqual({ enabled: true });
    expect(normalizeDesktopSettings({ toolCallDrafts: { enabled: false } }).toolCallDrafts).toEqual({ enabled: false });
    expect(normalizeDesktopSettings({}, { toolCallDrafts: { enabled: false } }).toolCallDrafts).toEqual({ enabled: false });
  });

  it('preserves configured models through startup hydration and unrelated saves', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-startup-model-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const text = {
      model: 'configured-model', fastModel: 'configured-fast',
      baseUrl: 'https://configured.test/v1', apiKey: 'configured-key',
      maxTurns: 42, thinking: { mode: 'enabled', budgetTokens: 8192 },
    };
    fs.writeFileSync(settingsPath, JSON.stringify({
      model: 'stale-legacy-model', url: '', apiKey: '',
      models: { text },
    }));
    const store = createDesktopSettingsStore({ settingsPath });
    expect(store.value).toMatchObject({
      model: text.model, fastModel: text.fastModel, url: text.baseUrl,
      apiKey: text.apiKey, maxTurns: text.maxTurns,
    });
    store.save({ ...store.value, enterpriseAccountAccessToken: 'hydrated-server-login-token' });
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).models.text).toEqual(text);

    const updatedText = { ...text, model: 'edited-model', apiKey: 'edited-key' };
    fs.writeFileSync(settingsPath, JSON.stringify({ models: { text: updatedText } }));
    store.save({ ...store.value, language: 'english' });
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).models.text).toEqual(updatedText);
    expect(createDesktopSettingsStore({ settingsPath }).value.model).toBe('edited-model');
  });

  it('does not replace an unreadable settings file with startup defaults', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-invalid-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const unfinishedJson = '{"models":{"text":{"model":"saved-model"}';
    fs.writeFileSync(settingsPath, unfinishedJson);
    const store = createDesktopSettingsStore({ settingsPath });
    expect(store.state.loaded).toBe(false);
    expect(store.value.model).toBe('');
    expect(() => store.save({ ...store.value, language: 'english' })).toThrow('保留配置');
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(unfinishedJson);
  });

  it('normalizes five permission modes and migrates the legacy bypass switch', () => {
    expect(normalizeDesktopSettings({}).permissionMode).toBe('default');
    expect(normalizeDesktopSettings({ permissionMode: 'acceptEdits' }).permissionMode)
      .toBe('acceptEdits');
    expect(normalizeDesktopSettings({ permissionMode: 'dontAsk' }).permissionMode)
      .toBe('dontAsk');
    expect(normalizeDesktopSettings({ permissionMode: 'invalid' }).permissionMode)
      .toBe('default');
    expect(normalizeDesktopSettings({ bypassPermissions: true })).toMatchObject({
      permissionMode: 'bypassPermissions',
      bypassPermissions: true,
    });
    expect(normalizeDesktopSettings(
      { model: 'next-model' },
      { permissionMode: 'plan', bypassPermissions: false },
    ).permissionMode).toBe('plan');
  });

  it('uses recommended tool loading defaults and accepts per-tool choices', () => {
    const defaults = normalizeDesktopSettings({}).toolLoading;
    expect(defaults).toMatchObject({
      moss_browser_open: 'always',
          connector_cli_setup: 'deferred',
      image_gen: 'always',
    });

    const customized = normalizeDesktopSettings({
      toolLoading: {
        browser_open: 'deferred',
        browser_snapshot: 'always',
        browser_click: 'always',
        connector_cli_setup: 'always',
        image_gen: 'invalid',
        unknown_tool: 'always',
      },
    }).toolLoading;
    expect(customized.moss_browser_open).toBe('deferred');
    expect(customized.connector_cli_setup).toBe('always');
    expect(customized.image_gen).toBe('always');
    expect(customized).not.toHaveProperty('unknown_tool');
    expect(customized).not.toHaveProperty('browser_snapshot');
    expect(customized).not.toHaveProperty('browser_click');
    expect(customized).not.toHaveProperty('browser_open');
  });

  it('defaults replies and newly generated memories to Chinese', () => {
    expect(normalizeDesktopSettings({}).language).toBe('chinese');
    expect(normalizeDesktopSettings({ language: ' english ' }).language).toBe('english');
    expect(normalizeDesktopSettings(
      { model: 'next-model' },
      { language: 'japanese' },
    ).language).toBe('japanese');
  });

  it('keeps Agent Teams opt-in and persists an explicit boolean', () => {
    expect(normalizeDesktopSettings({}).agentTeamsEnabled).toBe(false);
    expect(normalizeDesktopSettings({ agentTeamsEnabled: true }).agentTeamsEnabled).toBe(true);
    expect(normalizeDesktopSettings(
      { model: 'next-model' },
      { agentTeamsEnabled: true },
    ).agentTeamsEnabled).toBe(true);
  });

  it('keeps verification disabled by default and migrates the legacy switch', () => {
    expect(normalizeDesktopSettings({}).agentSettings).toEqual({
      disabled: ['verification'],
    });
    expect(normalizeDesktopSettings({
      advanced: { moss_hive_evidence: true },
    })).toMatchObject({
      agentSettings: { disabled: [] },
      advanced: { moss_hive_evidence: true },
    });
    expect(normalizeDesktopSettings({
      agentSettings: { disabled: ['verification', 'Explore', 'Explore', 42] },
      advanced: { moss_hive_evidence: true },
    })).toMatchObject({
      agentSettings: { disabled: ['verification', 'Explore'] },
      advanced: { moss_hive_evidence: false },
    });
    expect(normalizeDesktopSettings(
      { advanced: { moss_scratchpad: true, moss_hive_evidence: false } },
      { agentSettings: { disabled: ['verification', 'Explore'] } },
    ).agentSettings).toEqual({ disabled: ['verification', 'Explore'] });
  });

  it('discards the retired Workflow switch from incoming and saved settings', () => {
    expect(normalizeDesktopSettings({})).not.toHaveProperty('workflows');
    for (const enabled of [true, false]) {
      expect(normalizeDesktopSettings({ workflows: { enabled } }))
        .not.toHaveProperty('workflows');
      expect(normalizeDesktopSettings(
        { model: 'next-model' },
        { workflows: { enabled } },
      )).not.toHaveProperty('workflows');
    }
  });

  it('normalizes Agent Mail as opt-in and preserves its stable local identity', () => {
    expect(normalizeDesktopSettings({}).agentMail).toEqual({
      enabled: false,
      sessionMode: 'fixed',
      consumerId: '',
      inboxSessionId: '',
      inboxSessionIds: {},
    });
    expect(normalizeDesktopSettings({
      enterpriseEnabled: true,
      agentMail: {
        enabled: true,
        sessionMode: 'new',
        consumerId: `  ${'x'.repeat(140)}  `,
        inboxSessionId: ' inbox-session ',
        inboxSessionIds: {
          'mailbox:abc': ' account-session ',
          'mailbox:abc:sender:alice': ' alice-session ',
          'mailbox:abc:sender:bob': ' bob-session ',
          legacy: 'ignored-session',
        },
      },
    }).agentMail).toEqual({
      enabled: true,
      sessionMode: 'new',
      consumerId: 'x'.repeat(128),
      inboxSessionId: 'inbox-session',
      inboxSessionIds: {
        'mailbox:abc': 'account-session',
        'mailbox:abc:sender:alice': 'alice-session',
        'mailbox:abc:sender:bob': 'bob-session',
      },
    });
    expect(normalizeDesktopSettings({
      enterpriseEnabled: false,
      agentMail: { enabled: true },
    }).agentMail.enabled).toBe(false);
    expect(normalizeDesktopSettings(
      { enterpriseEnabled: false },
      { enterpriseEnabled: true, agentMail: { enabled: true } },
    ).agentMail.enabled).toBe(false);
    expect(normalizeDesktopSettings({
      enterpriseEnabled: true,
      agentMail: { sessionMode: 'unsupported' },
    }).agentMail.sessionMode).toBe('fixed');
  });

  it('normalizes legacy and structured model settings into one runtime shape', () => {
    const settings = normalizeDesktopSettings({
      models: {
        text: {
          baseUrl: 'https://models.example.com/v1/',
          apiKey: ' secret ',
          model: 'model-a',
          fastModel: ' model-fast ',
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
      enterpriseAccount: {
        serverUrl: 'https://remote.example.com/',
        credentialMode: 'password',
        accessToken: 'remote-token',
        profileMode: 'session',
      },
    });

    expect(settings).toMatchObject({
      model: 'model-a',
      fastModel: 'model-fast',
      maxTurns: 42,
      thinkingMode: 'enabled',
      thinkingBudgetTokens: 8192,
      url: 'https://models.example.com/v1/',
      apiKey: 'secret',
      image: {
        model: 'image-a',
      },
      enterpriseAccountServerUrl: 'https://remote.example.com/',
      enterpriseAccountCredentialMode: 'password',
      enterpriseAccountAccessToken: 'remote-token',
    });
    expect(settings).not.toHaveProperty('enterpriseAccountProfileMode');
    expect(settings.enterpriseAccount).not.toHaveProperty('profileMode');
    expect(settings.image).toEqual({ model: 'image-a' });
  });

  it.each(['openai', 'minimax'])('drops legacy %s image credentials on save and restart', provider => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-image-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const text = { model: 'main-model', baseUrl: 'https://main.test/v1', apiKey: 'main-key' };
    fs.writeFileSync(settingsPath, JSON.stringify({ models: { text, image: {
      provider, baseUrl: 'https://obsolete.test', apiKey: 'obsolete-key', model: 'custom-image',
    } } }));
    const store = createDesktopSettingsStore({ settingsPath });
    expect(store.getPayload().image).toEqual({ model: 'custom-image' });
    store.save({ language: 'chinese' });
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(saved.models.image).toEqual({ model: 'custom-image' });
    expect(saved.models.text).toMatchObject(text);
    const restarted = createDesktopSettingsStore({ settingsPath });
    expect(restarted.value.image).toEqual({ model: 'custom-image' });
    restarted.save({ image: { model: ' ' } });
    expect(createDesktopSettingsStore({ settingsPath }).value.image).toEqual({ model: 'gpt-image-2' });
  });

  it('preserves the complete model base URL while trimming outer whitespace', () => {
    expect(normalizeMossBaseUrl('https://napi.sudorouter.ai/v1')).toBe(
      'https://napi.sudorouter.ai/v1',
    );
    expect(normalizeMossBaseUrl('  https://example.com/gateway/v1/  ')).toBe(
      'https://example.com/gateway/v1/',
    );
    expect(normalizeMossBaseUrl('https://example.com/v10')).toBe('https://example.com/v10');
  });

  it('normalizes Moss auto-memory settings and legacy aliases', () => {
    expect(normalizeDesktopSettings({}).autoMemory.extractionIntervalTurns).toBe(5);
    expect(normalizeDesktopSettings({
      autoMemoryEnabled: false,
      autoDreamEnabled: true,
      autoMemory: {
        enabled: true,
        extractionEnabled: true,
        extractionIntervalTurns: 2,
        pastContextSearchEnabled: true,
        dreamMinHours: 6.5,
        dreamMinSessions: 3,
      },
    }).autoMemory).toEqual({
      enabled: true,
      extractionEnabled: true,
      extractionIntervalTurns: 2,
      pastContextSearchEnabled: true,
      dreamEnabled: true,
      dreamMinHours: 6.5,
      dreamMinSessions: 3,
    });
  });

  it('ignores retired session-summary settings and removes them on the next save', () => {
    expect(normalizeDesktopSettings({}).sessionMemory).toBeUndefined();
    const legacy = { sessionMemory: { enabled: true, compactEnabled: true, minimumMessageTokensToInit: 100 } };
    expect(normalizeDesktopSettings(legacy).sessionMemory).toBeUndefined();
    expect(normalizeDesktopSettings({}, legacy).sessionMemory).toBeUndefined();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-session-summary-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(legacy));
    const store = createDesktopSettingsStore({ settingsPath });
    expect(store.value.sessionMemory).toBeUndefined();
    store.save({ language: 'english' });
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).sessionMemory).toBeUndefined();
    expect(createDesktopSettingsStore({ settingsPath }).value.sessionMemory).toBeUndefined();
  });

  it('keeps advanced setting defaults and normalizes explicit overrides', () => {
    expect(normalizeDesktopSettings({}).advanced).toEqual({
      moss_auto_background_agents: false,
      moss_bash_ast_permissions: false,
      moss_hive_evidence: false,
      moss_scratchpad: false,
      moss_idle_session_cleanup: false,
      moss_streaming_tool_execution: false,
      moss_disable_nonstreaming_fallback: false,
      moss_plan_mode_interview: true,
      moss_fast_web_search: false,
      moss_memory_learn_from_corrections: false,
      moss_large_tool_result_protection: false,
      moss_tool_result_budget_chars: 200000,
      moss_mcp_output_token_limit: 25000,
      moss_file_read_max_size_bytes: 256 * 1024,
      moss_file_read_max_tokens: 25000,
      moss_request_attribution_enabled: true,
      moss_context_compaction_strategy: 'proactive',
      moss_session_debug_logging: false,
    });

    expect(normalizeDesktopSettings({
      advanced: {
        moss_auto_background_agents: true,
        moss_bash_ast_permissions: true,
        moss_hive_evidence: true,
        moss_scratchpad: true,
        moss_idle_session_cleanup: true,
        moss_streaming_tool_execution: true,
        moss_disable_nonstreaming_fallback: true,
        moss_plan_mode_interview: false,
        moss_fast_web_search: true,
        moss_memory_learn_from_corrections: true,
        moss_large_tool_result_protection: true,
        moss_tool_result_budget_chars: 300000,
        moss_mcp_output_token_limit: 40000,
        moss_file_read_max_size_bytes: 512000,
        moss_file_read_max_tokens: 50000,
        moss_request_attribution_enabled: false,
        moss_context_compaction_strategy: 'reactive',
      },
    }).advanced).toEqual({
      moss_auto_background_agents: true,
      moss_bash_ast_permissions: true,
      moss_hive_evidence: true,
      moss_scratchpad: true,
      moss_idle_session_cleanup: true,
      moss_streaming_tool_execution: true,
      moss_disable_nonstreaming_fallback: true,
      moss_plan_mode_interview: false,
      moss_fast_web_search: true,
      moss_memory_learn_from_corrections: true,
      moss_large_tool_result_protection: true,
      moss_tool_result_budget_chars: 300000,
      moss_mcp_output_token_limit: 40000,
      moss_file_read_max_size_bytes: 512000,
      moss_file_read_max_tokens: 50000,
      moss_request_attribution_enabled: false,
      moss_context_compaction_strategy: 'reactive',
      moss_session_debug_logging: false,
    });

    expect(normalizeDesktopSettings({
      advanced: {
        moss_auto_background_agents: 'false',
        moss_bash_ast_permissions: 'true',
        moss_hive_evidence: 'true',
        moss_plan_mode_interview: 'false',
        moss_tool_result_budget_chars: -1,
        moss_mcp_output_token_limit: 2_000_000,
        moss_file_read_max_size_bytes: 2_000_000_000,
        moss_file_read_max_tokens: '50000',
        moss_request_attribution_enabled: 'false',
        moss_context_compaction_strategy: 'unknown',
      },
    }).advanced).toMatchObject({
      moss_auto_background_agents: false,
      moss_bash_ast_permissions: false,
      moss_hive_evidence: false,
      moss_plan_mode_interview: true,
      moss_tool_result_budget_chars: 200000,
      moss_mcp_output_token_limit: 1000000,
      moss_file_read_max_size_bytes: 1000000000,
      moss_file_read_max_tokens: 50000,
      moss_request_attribution_enabled: true,
      moss_context_compaction_strategy: 'proactive',
    });
  });

  it('does not persist remote login secrets in settings.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-desktop-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const store = createDesktopSettingsStore({ settingsPath });
    store.save({
      ...store.value,
      enterpriseAccountServerUrl: 'https://moss.example.com',
      enterpriseAccountCredentialMode: 'password',
      enterpriseAccountUserName: 'Moss User',
      enterpriseAccountAccessToken: 'jwt.remote.token',
      enterpriseAccountUserPassword: 'remote-password',
      enterpriseAccountProfileMode: 'session',
      enterpriseAccount: {
        ...store.value.enterpriseAccount,
        profileMode: 'session',
      },
    });

    const serialized = fs.readFileSync(settingsPath, 'utf8');
    expect(serialized).not.toContain('jwt.remote.token');
    expect(serialized).not.toContain('remote-password');
    const persisted = JSON.parse(serialized);
    expect(persisted.enterpriseAccount).not.toHaveProperty('apiKey');
    expect(persisted.enterpriseAccount).not.toHaveProperty('userPassword');
    expect(persisted.enterpriseAccount).not.toHaveProperty('profileMode');
    expect(persisted.enterpriseAccount.userName).toBe('Moss User');
    expect(persisted).not.toHaveProperty('enterpriseAccountProfileMode');
  });

  it('persists a text model API URL ending in /v1', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-model-url-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const store = createDesktopSettingsStore({ settingsPath });

    store.save({
      ...store.value,
      url: 'https://napi.sudorouter.ai/v1',
    });

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(persisted.models.text.baseUrl).toBe('https://napi.sudorouter.ai/v1');
    expect(createDesktopSettingsStore({ settingsPath }).value.url).toBe(
      'https://napi.sudorouter.ai/v1',
    );
  });

  it('allows text model settings to be explicitly cleared', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-empty-model-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const store = createDesktopSettingsStore({ settingsPath });

    store.save({
      ...store.value,
      model: 'custom-model',
      url: 'https://model.example.com/v1/',
      apiKey: 'secret',
    });
    store.save({
      ...store.value,
      model: '',
      url: '',
      apiKey: '',
    });

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(persisted.models.text).toMatchObject({
      model: '',
      baseUrl: '',
      apiKey: '',
    });
    expect(createDesktopSettingsStore({ settingsPath }).value).toMatchObject({
      model: '',
      url: '',
      apiKey: '',
    });
  });

  it('persists the fast model with text model settings and allows clearing it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-fast-model-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const store = createDesktopSettingsStore({ settingsPath });

    store.save({
      ...store.value,
      model: 'primary-model',
      fastModel: 'fast-model',
    });

    let persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(persisted.models.text.model).toBe('primary-model');
    expect(persisted.models.text.fastModel).toBe('fast-model');
    expect(persisted).not.toHaveProperty('fastModel');
    expect(createDesktopSettingsStore({ settingsPath }).value.fastModel).toBe('fast-model');

    store.save({ ...store.value, fastModel: '' });
    persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(persisted.models.text.fastModel).toBe('');
    expect(createDesktopSettingsStore({ settingsPath }).value.fastModel).toBe('');
  });

  it('persists tool loading choices and fills missing tools from defaults', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-tool-loading-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const store = createDesktopSettingsStore({ settingsPath });

    store.save({
      ...store.value,
      toolLoading: {
        moss_browser_open: 'deferred',
        connector_cli_setup: 'always',
      },
    });

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(persisted.toolLoading.moss_browser_open).toBe('deferred');
    expect(persisted.toolLoading.connector_cli_setup).toBe('always');
    expect(persisted.toolLoading.image_gen).toBe('always');

    const reloaded = createDesktopSettingsStore({ settingsPath });
    expect(reloaded.value.toolLoading).toMatchObject({
      moss_browser_open: 'deferred',
      connector_cli_setup: 'always',
      image_gen: 'always',
    });
  });

  it('persists the WebSearch mode without writing provider credentials', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-desktop-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    const store = createDesktopSettingsStore({ settingsPath });

    const saved = store.save({
      ...store.value,
      webSearch: {
        mode: 'auto',
        tavilyApiKey: 'tvly-private-value',
        braveApiKey: 'brave-private-value',
      },
    });

    expect(saved.value.webSearch).toMatchObject({
      mode: 'auto',
      tavilyApiKey: 'tvly-private-value',
      braveApiKey: 'brave-private-value',
    });
    expect(store.getPayload().webSearch).toMatchObject({
      tavilyApiKey: '',
      braveApiKey: '',
      tavilyConfigured: true,
      braveConfigured: true,
    });
    const serialized = fs.readFileSync(settingsPath, 'utf8');
    expect(serialized).not.toContain('tvly-private-value');
    expect(serialized).not.toContain('brave-private-value');
    expect(JSON.parse(serialized).webSearch).toEqual({ mode: 'auto' });
  });

  it('keeps hydrated WebSearch credentials when the public settings are reloaded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-desktop-settings-'));
    temporaryRoots.push(root);
    const settingsPath = path.join(root, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ webSearch: { mode: 'auto' } }));
    const store = createDesktopSettingsStore({ settingsPath });

    store.hydrate({
      ...store.value,
      webSearch: {
        ...store.value.webSearch,
        tavilyApiKey: 'tvly-private-value',
      },
    });
    const reloaded = store.reload();

    expect(reloaded.value.webSearch).toMatchObject({
      mode: 'auto',
      tavilyApiKey: 'tvly-private-value',
    });
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).webSearch)
      .toEqual({ mode: 'auto' });
  });
});


it('reads legacy enterprise credentials without creating or moving any sessions', () => {
  const settings = normalizeDesktopSettings({ remoteEnabled: true, remoteDirect: { serverUrl: 'https://enterprise.test', userEmail: 'alice', apiKey: 'key' } });
  expect(settings.enterpriseEnabled).toBe(true);
  expect(settings.enterpriseAccountServerUrl).toBe('https://enterprise.test');
  expect(settings.enterpriseAccountAccessToken).toBe('');
  expect(settings.remoteDirect).toBeUndefined();
  expect(settings.remoteEnabled).toBeUndefined();
});
