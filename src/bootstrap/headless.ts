import { init } from '../entrypoints/init.js'
import { initBundledSkills } from '../skills/bundled/index.js'
import { initBuiltinPlugins } from '../plugins/bundled/index.js'
import { setProjectRoot, setOriginalCwd, setCwdState } from './state.js'
import { findGitRoot } from '../utils/git.js'
import { getMemoryFiles } from '../utils/claudemd.js'
import { createSystemMessage } from '../utils/messages.js'
import type { Message } from '../types/message.js'
import { setCwd } from '../utils/Shell.js'
import { getAllMcpConfigs } from '../services/mcp/config.js'
import { prefetchAllMcpResources } from '../services/mcp/client.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Tool } from '../Tool.js'
import type { Command } from '../commands.js'

let globalInitDone = false

export interface BootstrapResult {
  initialMessages: Message[]
  mcp: {
    clients: MCPServerConnection[]
    tools: Tool[]
    commands: Command[]
  }
}

/**
 * Performs a unified headless initialization, ensuring both the CLI and SDK
 * have full feature parity (Skills, Plugins, CLAUDE.md, MCP, etc.).
 *
 * @param cwd The working directory for the session
 * @returns Initialization results to pass to the QueryEngine and AppState
 */
export async function bootstrapHeadless(cwd: string): Promise<BootstrapResult> {
  // 1. Global one-time initialization
  if (!globalInitDone) {
    globalInitDone = true
    await init()
    initBundledSkills()
    initBuiltinPlugins()
  }

  // 2. Set context for the current session
  setCwd(cwd)
  setOriginalCwd(cwd)
  setCwdState(cwd)

  const gitRoot = await findGitRoot(cwd)
  if (gitRoot) {
    setProjectRoot(gitRoot)
  } else {
    setProjectRoot(cwd)
  }

  // 3. Load MCP configurations and prefetch resources
  const { servers: mcpConfigs } = await getAllMcpConfigs()
  const mcpResources = await prefetchAllMcpResources(mcpConfigs)

  // 4. Load CLAUDE.md and project rules as initial messages
  const memoryFiles = await getMemoryFiles(cwd)
  const initialMessages: Message[] = memoryFiles.map(file =>
    createSystemMessage(file.content, { filePath: file.filePath })
  )

  return {
    initialMessages,
    mcp: mcpResources,
  }
}
