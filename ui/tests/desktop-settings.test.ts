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

  it('normalizes Moss auto-memory settings and legacy aliases', () => {
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
    });

    expect(normalizeDesktopSettings({
      advanced: {
        moss_auto_background_agents: true,
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
    });

    expect(normalizeDesktopSettings({
      advanced: {
        moss_auto_background_agents: 'false',
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
