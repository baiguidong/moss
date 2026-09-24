import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionRepository } from '../model/repositories/session.js'
import { openTestDatabase } from './databaseTestUtils.js'

const root = await mkdtemp(join(tmpdir(), 'moss-server-db-'))

try {
  const memoryStore = new SessionRepository(await openTestDatabase(':memory:'))
  await memoryStore.close()

  const dbPath = join(root, 'server.db')
  const store = new SessionRepository(await openTestDatabase(dbPath))
  try {
    const session = await store.createSession({
      sessionId: 'session-1',
      transcriptSessionId: 'session-1',
      transcriptPath: join(root, 'session-1.jsonl'),
      userId: 'user-1',
      orgId: 'org-1',
      role: 'user',
      scopes: ['sessions:create'],
      cwd: root,
      runtime: {
        backend: 'docker',
        dockerImage: 'moss-runtime:test',
        profileDir: join(root, 'profile'),
        transcriptDir: join(root, 'transcripts'),
        workspaceDir: root,
      },
      status: 'creating',
      desiredState: 'active',
      advancedSettings: {
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
        moss_tool_result_budget_chars: 300_000,
        moss_mcp_output_token_limit: 40_000,
        moss_file_read_max_size_bytes: 512_000,
        moss_file_read_max_tokens: 50_000,
        moss_request_attribution_enabled: false,
        moss_context_compaction_strategy: 'reactive',
        moss_workflows_enabled: false,
      },
      autoMemory: {
        enabled: true,
        extractionEnabled: true,
        extractionIntervalTurns: 2,
        pastContextSearchEnabled: true,
        dreamEnabled: true,
        dreamMinHours: 12,
        dreamMinSessions: 3,
      },
      sessionMemory: {
        enabled: true,
        compactEnabled: true,
        minimumMessageTokensToInit: 100,
        minimumTokensBetweenUpdate: 50,
        toolCallsBetweenUpdates: 2,
        compactMinTokens: 1000,
        compactMinTextBlockMessages: 3,
        compactMaxTokens: 4000,
      },
      runtimeOptions: {
        customSystemPrompt: 'persistent instructions',
        allowedTools: ['Read'],
        model: 'desktop-model',
        fastModel: 'desktop-fast-model',
        url: 'https://model.example.test',
        apiKey: 'secret',
        thinkingConfig: { type: 'enabled', budgetTokens: 4096 },
      },
    })
    assert.deepEqual(session.advancedSettings, {
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
      moss_tool_result_budget_chars: 300_000,
      moss_mcp_output_token_limit: 40_000,
      moss_file_read_max_size_bytes: 512_000,
      moss_file_read_max_tokens: 50_000,
      moss_request_attribution_enabled: false,
      moss_context_compaction_strategy: 'reactive',
      moss_session_debug_logging: false,
      moss_tool_loading: {},
      moss_workflows_enabled: false,
    })
    assert.deepEqual(session.autoMemory, {
      enabled: true,
      extractionEnabled: true,
      extractionIntervalTurns: 2,
      pastContextSearchEnabled: true,
      dreamEnabled: true,
      dreamMinHours: 12,
      dreamMinSessions: 3,
    })
    assert.deepEqual(session.sessionMemory, {
      enabled: true,
      compactEnabled: true,
      minimumMessageTokensToInit: 100,
      minimumTokensBetweenUpdate: 50,
      toolCallsBetweenUpdates: 2,
      compactMinTokens: 1000,
      compactMinTextBlockMessages: 3,
      compactMaxTokens: 4000,
    })
    assert.deepEqual(session.runtimeOptions, {
      customSystemPrompt: 'persistent instructions',
      allowedTools: ['Read'],
    })
  } finally {
    await store.close()
  }

  if (!process.env.MOSS_TEST_MYSQL && process.platform !== 'win32') {
    assert.equal((await stat(dbPath)).mode & 0o777, 0o600)
  }

  const reopened = new SessionRepository(await openTestDatabase(dbPath))
  try {
    assert.equal(
      (await reopened.getSession('session-1'))?.runtimeOptions?.customSystemPrompt,
      'persistent instructions',
    )
  } finally {
    await reopened.close()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
