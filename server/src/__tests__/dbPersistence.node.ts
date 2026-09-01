import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DirectConnectStore } from '../db.js'

const root = await mkdtemp(join(tmpdir(), 'moss-server-db-'))

try {
  const dbPath = join(root, 'server.db')
  const store = new DirectConnectStore(dbPath)
  try {
    const session = store.createSession({
      sessionId: 'session-1',
      transcriptSessionId: 'session-1',
      transcriptPath: join(root, 'session-1.jsonl'),
      userId: 'user-1',
      orgId: 'org-1',
      role: 'user',
      scopes: ['sessions:create'],
      cwd: root,
      runtime: {
        backend: 'host',
        profileMode: 'user',
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
  } finally {
    store.close()
  }

  const legacyDb = new DatabaseSync(dbPath)
  legacyDb.exec('ALTER TABLE sessions DROP COLUMN advanced_settings_json')
  legacyDb.exec('ALTER TABLE sessions DROP COLUMN auto_memory_json')
  legacyDb.exec('ALTER TABLE sessions DROP COLUMN session_memory_json')
  legacyDb.close()

  const migratedStore = new DirectConnectStore(dbPath)
  try {
    const columns = migratedStore.db
      .prepare('PRAGMA table_info(sessions)')
      .all() as Array<{ name: string }>
    assert.equal(
      columns.some(column => column.name === 'advanced_settings_json'),
      true,
    )
    assert.equal(
      columns.some(column => column.name === 'auto_memory_json'),
      true,
    )
    assert.equal(
      columns.some(column => column.name === 'session_memory_json'),
      true,
    )
    assert.equal(migratedStore.getSession('session-1')?.advancedSettings, undefined)
    assert.equal(migratedStore.getSession('session-1')?.autoMemory, undefined)
    assert.equal(migratedStore.getSession('session-1')?.sessionMemory, undefined)
  } finally {
    migratedStore.close()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
