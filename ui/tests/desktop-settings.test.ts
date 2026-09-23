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
  it('does not select a built-in model when no model is configured', () => {
    expect(normalizeDesktopSettings({}).model).toBe('');
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
    store.save({ ...store.value, remoteDirectApiKey: 'hydrated-server-login-key' });
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
      browser_open: 'always',
      browser_snapshot: 'always',
      browser_click: 'always',
      browser_type: 'always',
      browser_scroll: 'deferred',
      app_build: 'deferred',
      app_launch: 'deferred',
      connector_cli_setup: 'deferred',
      image_generate: 'deferred',
    });

    const customized = normalizeDesktopSettings({
      toolLoading: {
        browser_open: 'deferred',
        app_build: 'always',
        image_generate: 'invalid',
        unknown_tool: 'always',
      },
    }).toolLoading;
    expect(customized.browser_open).toBe('deferred');
    expect(customized.app_build).toBe('always');
    expect(customized.image_generate).toBe('deferred');
    expect(customized).not.toHaveProperty('unknown_tool');
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

  it('keeps Library Agent tools opt-in and normalizes the persisted switch', () => {
    expect(normalizeDesktopSettings({}).library).toEqual({
      enabled: false,
      extensionGuideAcknowledged: false,
    });
    expect(normalizeDesktopSettings({ library: { enabled: true } }).library)
      .toEqual({ enabled: true, extensionGuideAcknowledged: false });
    expect(normalizeDesktopSettings(
      { model: 'next-model' },
      { library: { enabled: true } },
    ).library).toEqual({ enabled: true, extensionGuideAcknowledged: false });
    expect(normalizeDesktopSettings(
      { library: { extensionGuideAcknowledged: true } },
      { library: { enabled: true, extensionGuideAcknowledged: false } },
    ).library).toEqual({ enabled: true, extensionGuideAcknowledged: true });
  });

  it('keeps Workflow tools opt-in and normalizes the persisted switch', () => {
    expect(normalizeDesktopSettings({}).workflows).toEqual({ enabled: false });
    expect(normalizeDesktopSettings({ workflows: { enabled: true } }).workflows)
      .toEqual({ enabled: true });
    expect(normalizeDesktopSettings(
      { model: 'next-model' },
      { workflows: { enabled: true } },
    ).workflows).toEqual({ enabled: true });
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
      remoteEnabled: true,
      agentMail: {
        enabled: true,
        sessionMode: 'new',
        consumerId: `  ${'x'.repeat(140)}  `,
        inboxSessionId: ' inbox-session ',
        inboxSessionIds: {
          'mailbox:abc': ' account-session ',
          legacy: 'ignored-session',
        },
      },
    }).agentMail).toEqual({
      enabled: true,
      sessionMode: 'new',
      consumerId: 'x'.repeat(128),
      inboxSessionId: 'inbox-session',
      inboxSessionIds: { 'mailbox:abc': 'account-session' },
    });
    expect(normalizeDesktopSettings({
      remoteEnabled: false,
      agentMail: { enabled: true },
    }).agentMail.enabled).toBe(false);
    expect(normalizeDesktopSettings(
      { remoteEnabled: false },
      { remoteEnabled: true, agentMail: { enabled: true } },
    ).agentMail.enabled).toBe(false);
    expect(normalizeDesktopSettings({
      remoteEnabled: true,
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
      remoteDirect: {
        serverUrl: 'https://remote.example.com/',
        credentialMode: 'api-key',
        apiKey: 'remote-secret',
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
        provider: 'provider-a',
        url: 'https://images.example.com',
        apiKey: 'image-secret',
        model: 'image-a',
      },
      remoteDirectServerUrl: 'https://remote.example.com/',
      remoteDirectCredentialMode: 'api-key',
      remoteDirectApiKey: 'remote-secret',
    });
    expect(settings).not.toHaveProperty('remoteDirectProfileMode');
    expect(settings.remoteDirect).not.toHaveProperty('profileMode');
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

  it('normalizes all Moss session-memory and compact settings', () => {
    expect(normalizeDesktopSettings({
      sessionMemory: {
        enabled: true,
        compactEnabled: true,
        minimumMessageTokensToInit: 100,
        minimumTokensBetweenUpdate: 50,
        toolCallsBetweenUpdates: 2,
        compactMinTokens: 4000,
        compactMinTextBlockMessages: 3,
        compactMaxTokens: 1000,
      },
    }).sessionMemory).toEqual({
      enabled: true,
      compactEnabled: true,
      minimumMessageTokensToInit: 100,
      minimumTokensBetweenUpdate: 50,
      toolCallsBetweenUpdates: 2,
      compactMinTokens: 4000,
      compactMinTextBlockMessages: 3,
      compactMaxTokens: 4000,
    });
  });

  it('keeps advanced setting defaults and normalizes explicit overrides', () => {
    expect(normalizeDesktopSettings({}).advanced).toEqual({
      moss_auto_background_agents: false,
      moss_bash_ast_permissions: false,
      moss_hive_evidence: false,
      moss_scratchpad: false,
      moss_idle_session_cleanup: false,
      moss_streaming_tool_execution: false,
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
      remoteDirectServerUrl: 'https://moss.example.com',
      remoteDirectCredentialMode: 'api-key',
      remoteDirectUserName: 'Moss User',
      remoteDirectApiKey: 'moss_sk_remote.secret',
      remoteDirectUserPassword: 'remote-password',
      remoteDirectProfileMode: 'session',
      remoteDirect: {
        ...store.value.remoteDirect,
        profileMode: 'session',
      },
    });

    const serialized = fs.readFileSync(settingsPath, 'utf8');
    expect(serialized).not.toContain('moss_sk_remote.secret');
    expect(serialized).not.toContain('remote-password');
    const persisted = JSON.parse(serialized);
    expect(persisted.remoteDirect).not.toHaveProperty('apiKey');
    expect(persisted.remoteDirect).not.toHaveProperty('userPassword');
    expect(persisted.remoteDirect).not.toHaveProperty('profileMode');
    expect(persisted.remoteDirect.userName).toBe('Moss User');
    expect(persisted).not.toHaveProperty('remoteDirectProfileMode');
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
        browser_open: 'deferred',
        app_build: 'always',
      },
    });

    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(persisted.toolLoading.browser_open).toBe('deferred');
    expect(persisted.toolLoading.app_build).toBe('always');
    expect(persisted.toolLoading.image_generate).toBe('deferred');

    const reloaded = createDesktopSettingsStore({ settingsPath });
    expect(reloaded.value.toolLoading).toMatchObject({
      browser_open: 'deferred',
      app_build: 'always',
      browser_snapshot: 'always',
      image_generate: 'deferred',
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
});
