import { init } from '../entrypoints/init.js'
import {
  setAdditionalDirectoriesForMossMd,
  setProjectRoot,
  setOriginalCwd,
  setCwdState,
} from './state.js'
import { findGitRoot } from '../utils/git.js'
import { processSessionStartHooks } from '../utils/sessionStart.js'
import type { Message } from '../types/message.js'
import {
  hasCwdOverrideContext,
  setCurrentAdditionalDirectoriesOverride,
  setCurrentOriginalCwdOverride,
  setCurrentProjectRootOverride,
} from '../utils/cwdContext.js'
import { setCwd } from '../utils/Shell.js'
import { getAllMcpConfigs } from '../services/mcp/config.js'
import { captureHooksConfigSnapshot } from '../utils/hooks/hooksConfigSnapshot.js'
import { prefetchAllMcpResources } from '../services/mcp/client.js'
import type { MCPServerConnection, ScopedMcpServerConfig } from '../services/mcp/types.js'
import type { Tool } from '../Tool.js'
import type { Command } from '../commands.js'
import { getAgentDefinitionsWithOverrides, type AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import { initializeLspServerManager } from '../services/lsp/manager.js'
import {
  logForDiagnosticsNoPII,
  withDiagnosticsTiming,
} from '../utils/diagLogs.js'

let globalInitPromise: Promise<void> | null = null

function ensureHeadlessGlobalInit(): {
  promise: Promise<void>
  started: boolean
} {
  if (globalInitPromise) {
    return { promise: globalInitPromise, started: false }
  }

  globalInitPromise = (async () => {
    await withDiagnosticsTiming('bootstrap_headless_global_init', () => init())
    // Note: initBundledSkills() is called at
    // module initialization time in electron-direct.ts to ensure bundled
    // skills are registered before any memoized getCommands() call.
    // This matches the pattern in main.tsx:2004.

    // Initialize LSP manager (non-blocking)
    initializeLspServerManager()
  })().catch(error => {
    globalInitPromise = null
    throw error
  })

  return { promise: globalInitPromise, started: true }
}

export async function prewarmHeadlessGlobalInit(): Promise<void> {
  logForDiagnosticsNoPII('info', 'bootstrap_headless_global_init_prewarm_started')
  const start = Date.now()
  const { promise, started } = ensureHeadlessGlobalInit()
  await promise
  logForDiagnosticsNoPII('info', 'bootstrap_headless_global_init_prewarm_completed', {
    duration_ms: Date.now() - start,
    started,
  })
}

export interface BootstrapResult {
  initialMessages: Message[]
  mcp: {
    clients: MCPServerConnection[]
    tools: Tool[]
    commands: Command[]
  }
  agents: AgentDefinition[]
  // Session's git root (or cwd when not a git repo). Callers running
  // multiple concurrent sessions pass this into the per-session ALS
  // context instead of relying on the process-global project root.
  projectRoot: string
}

/**
 * Performs a unified headless initialization, ensuring both the CLI and SDK
 * have full feature parity (Skills, MOSS.md, MCP, etc.).
 *
 * @param cwd The working directory for the session
 * @returns Initialization results to pass to the QueryEngine and AppState
 */
export async function bootstrapHeadless(
  cwd: string,
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> = {},
  addDirs: string[] = [],
): Promise<BootstrapResult> {
  const bootstrapStart = Date.now()
  let globalInitRan = false
  logForDiagnosticsNoPII('info', 'bootstrap_headless_started')

  // 1. Global one-time initialization
  const globalInit = ensureHeadlessGlobalInit()
  globalInitRan = globalInit.started
  await globalInit.promise

  // 2. Set context for the current session.
  // When bootstrap runs inside a per-session ALS context (the embedded
  // desktop runtime always wraps send() in runWithCwdOverride), write ONLY
  // that session's ALS slot — never the process globals. Concurrent sessions
  // each carry their own cwd/originalCwd/projectRoot, so one session's
  // bootstrap (or a mid-session model error) can never repoint another
  // session at the wrong workspace. The CLI (no ALS context) still writes
  // the globals, preserving its single-session semantics exactly.
  const inSessionContext = hasCwdOverrideContext()

  const gitRoot = await withDiagnosticsTiming(
    'bootstrap_headless_find_git_root',
    () => findGitRoot(cwd),
    result => ({ is_git_repo: result !== null }),
  )
  const projectRoot = gitRoot || cwd

  if (inSessionContext) {
    // setCwd() prefers the ALS override (setCurrentCwdOverride) already.
    setCwd(cwd)
    setCurrentOriginalCwdOverride(cwd)
    setCurrentProjectRootOverride(projectRoot)
    setCurrentAdditionalDirectoriesOverride(addDirs)
  } else {
    setCwd(cwd)
    setOriginalCwd(cwd)
    setCwdState(cwd)
    setProjectRoot(projectRoot)
    setAdditionalDirectoriesForMossMd(addDirs)
  }

  // 3. Load MCP configurations and prefetch resources
  const { servers: mcpConfigs } = await withDiagnosticsTiming(
    'bootstrap_headless_mcp_configs',
    () => getAllMcpConfigs(dynamicMcpConfig),
    result => ({ server_count: result.servers.length }),
  )
  const mcpResources = await withDiagnosticsTiming(
    'bootstrap_headless_mcp_prefetch',
    () => prefetchAllMcpResources(mcpConfigs),
    result => ({
      client_count: result.clients.length,
      tool_count: result.tools.length,
      command_count: result.commands.length,
    }),
  )

  // 4. Load agent definitions (supports .moss/agents/*.md)
  const agentDefinitions = await withDiagnosticsTiming(
    'bootstrap_headless_agent_definitions',
    () => getAgentDefinitionsWithOverrides(cwd),
    result => ({
      active_agent_count: result.activeAgents.length,
      all_agent_count: result.allAgents.length,
    }),
  )

  // 5. Load SessionStart hooks (includes MOSS.md and plugin hooks)
  // This must run after context is set and MCP is initialized.
  const hookSnapshotStart = Date.now()
  captureHooksConfigSnapshot()
  logForDiagnosticsNoPII('info', 'bootstrap_headless_hooks_snapshot_completed', {
    duration_ms: Date.now() - hookSnapshotStart,
  })
  const hookMessages = await withDiagnosticsTiming(
    'bootstrap_headless_session_start_hooks',
    () => processSessionStartHooks('startup'),
    result => ({ message_count: result.length }),
  )

  logForDiagnosticsNoPII('info', 'bootstrap_headless_completed', {
    duration_ms: Date.now() - bootstrapStart,
    global_init_ran: globalInitRan,
  })

  return {
    initialMessages: hookMessages,
    mcp: mcpResources,
    agents: agentDefinitions.activeAgents,
    projectRoot,
  }
}
