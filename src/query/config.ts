import { getSessionId } from '../bootstrap/state.js'
import { getAdvancedSetting } from '../services/advancedSettings.js'
import type { SessionId } from '../types/ids.js'
import { isEnvTruthy } from '../utils/envUtils.js'

// -- config

// Immutable values snapshotted once at query() entry. Separating these from
// the per-iteration State struct and the mutable ToolUseContext makes future
// step() extraction tractable — a pure reducer can take (state, event, config)
// where config is plain data.
//
// Intentionally excludes feature() gates — those are tree-shaking boundaries
// and must stay inline at the guarded blocks for dead-code elimination.
export type QueryConfig = {
  sessionId: SessionId

  // Runtime gates (env/local feature values). NOT feature() gates — see above.
  gates: {
    streamingToolExecution: boolean
    emitToolUseSummaries: boolean
    fastModeEnabled: boolean
  }
}

export function buildQueryConfig(): QueryConfig {
  return {
    sessionId: getSessionId(),
    gates: {
      streamingToolExecution: getAdvancedSetting(
        'moss_streaming_tool_execution',
      ),
      emitToolUseSummaries: isEnvTruthy(
        process.env.CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES,
      ),
      // Inlined from fastMode.ts to avoid pulling its heavy module graph
      // (axios, settings, auth, model, config) into test shards that
      // didn't previously load it — changes init order and breaks unrelated tests.
      fastModeEnabled: !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FAST_MODE),
    },
  }
}
