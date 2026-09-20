import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { toolMatchesName } from '../../Tool.js'
import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { SEND_MESSAGE_TOOL_NAME } from '../../tools/SendMessageTool/constants.js'
import { TEAM_CREATE_TOOL_NAME } from '../../tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '../../tools/TeamDeleteTool/constants.js'
import { WORKFLOW_TOOL_NAMES } from '../../tools/WorkflowTool/constants.js'
import {
  createActivityDescriptionResolver,
  createProgressTracker,
  getTokenCountFromTracker,
  updateProgressFromMessage,
} from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type {
  AgentDefinition,
  BuiltInAgentDefinition,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getLastToolUseName } from '../../tools/AgentTool/agentToolUtils.js'
import { runAgent } from '../../tools/AgentTool/runAgent.js'
import {
  createSyntheticOutputTool,
  SYNTHETIC_OUTPUT_TOOL_NAME,
} from '../../tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { assembleToolPool } from '../../tools.js'
import type { Message } from '../../types/message.js'
import { asAgentId } from '../../types/ids.js'
import { createAbortController } from '../abortController.js'
import {
  createUserMessage,
  extractTextContent,
  filterOrphanedThinkingOnlyMessages,
  filterUnresolvedToolUses,
  filterWhitespaceOnlyAssistantMessages,
} from '../messages.js'
import { getAgentTranscript } from '../sessionStorage.js'
import { createAgentId } from '../uuid.js'
import type { AgentMetadata } from '../sessionStorage.js'
import {
  WORKFLOW_SUBAGENT_PROMPT,
  WORKFLOW_SUBAGENT_TYPE,
  workflowStructuredOutputNote,
  workflowStructuredSubagentPrompt,
} from './constants.js'
import type { WorkflowAgentOptions } from './types.js'
import { parseStructuredAgentText } from './structuredOutput.js'

const NESTED_ORCHESTRATION_TOOLS = [
  AGENT_TOOL_NAME,
  ...WORKFLOW_TOOL_NAMES,
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
]

/**
 * The agent definition every workflow subagent runs under.
 *
 * Workflow nodes deliberately inherit the owning session's permission mode.
 * Approving a Definition is not blanket approval for every tool call it makes.
 */
function buildWorkflowAgentDefinition(schemaToolName: string | undefined): BuiltInAgentDefinition {
  return {
    agentType: WORKFLOW_SUBAGENT_TYPE,
    whenToUse: 'Internal subagent for structured workflow nodes.',
    tools: ['*'],
    source: 'built-in',
    baseDir: 'built-in',
    getSystemPrompt: () =>
      schemaToolName
        ? workflowStructuredSubagentPrompt(schemaToolName)
        : WORKFLOW_SUBAGENT_PROMPT,
  }
}


export type WorkflowAgentRunParams = {
  prompt: string
  opts?: WorkflowAgentOptions
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  runId: string
  /** Agent transcript that launched this workflow; persisted on each worker. */
  ownerAgentId?: string
  /** Workflow/phase provenance stamped onto the agent's sidecar metadata. */
  workflow?: AgentMetadata['workflow']
  /** Per-agent controller so the user can skip or restart a single agent. */
  abortController: AbortController
  /** Existing logical-node conversation. Re-entering a cyclic node continues it. */
  conversation?: { agentId: string; messages: Message[] }
  /** Lazy transcript fallback used when a persisted run is resumed. */
  resumeAgentId?: string
  /** Called once the agent id is known, before the first model request. */
  onAgentId: (agentId: string) => void
  /** Called on every assistant message with the running token/tool totals. */
  onProgress: (progress: {
    tokens: number
    toolCalls: number
    lastToolName?: string
  }) => void
}

export type WorkflowAgentRunResult = {
  agentId: string
  /** Structured output object when a schema was given, otherwise the final text. */
  value: unknown
  tokens: number
  toolCalls: number
  conversationMessages?: Message[]
  worktreePath?: string
}

/**
 * Run one Agent node to completion and return its value to the executor.
 *
 * With a `schema`, the agent is forced through `StructuredOutput` and the
 * validated object is returned — validation happens at the tool-call layer so
 * the model retries a bad shape itself instead of downstream nodes parsing prose.
 */
export async function runWorkflowAgent(
  params: WorkflowAgentRunParams,
): Promise<WorkflowAgentRunResult> {
  const {
    prompt,
    opts,
    toolUseContext,
    canUseTool,
    runId,
    ownerAgentId,
    workflow,
    abortController,
    conversation,
    resumeAgentId,
    onAgentId,
    onProgress,
  } = params

  const resolvedAgentDefinition = resolveAgentDefinition(toolUseContext, opts)
  const agentDefinition = resolvedAgentDefinition
  const schemaTool = buildSchemaTool(opts?.schema)
  if (schemaTool && 'error' in schemaTool) {
    throw new Error(`agent({schema}): ${schemaTool.error}`)
  }

  const appState = toolUseContext.getAppState()
  // Workflow Agents use the same permission context as the owning session.
  // The Definition itself is not permission to edit files or run commands.
  const workerPermissionContext = appState.toolPermissionContext
  const basePool = assembleToolPool(workerPermissionContext, appState.mcp.tools)
    .filter(tool => !NESTED_ORCHESTRATION_TOOLS.some(name => toolMatchesName(tool, name)))
  // A parent StructuredOutput (from --json-schema) carries a different schema;
  // leaving it in would let the agent satisfy the wrong contract.
  const availableTools: Tool[] = schemaTool
    ? [
        ...basePool.filter(
          tool => !toolMatchesName(tool, SYNTHETIC_OUTPUT_TOOL_NAME),
        ),
        schemaTool.tool,
      ]
    : [...basePool]

  const resumedMessages = conversation?.messages ?? await loadConversation(resumeAgentId)
  const agentId = asAgentId(conversation?.agentId ?? resumeAgentId ?? createAgentId())
  onAgentId(agentId)

  const promptText = schemaTool
    ? `${prompt}${workflowStructuredOutputNote(SYNTHETIC_OUTPUT_TOOL_NAME)}`
    : prompt

  const tracker = createProgressTracker()
  const resolveActivity = createActivityDescriptionResolver(
    toolUseContext.options.tools,
  )
  const messages: Message[] = []
  const promptMessages = [
    ...resumedMessages,
    createUserMessage({ content: promptText }),
  ]
  let structuredOutput: unknown

  const iterator = runAgent({
        agentDefinition,
        promptMessages,
        persistedMessageCount: resumedMessages.length,
        stopAfterStructuredOutput: Boolean(schemaTool),
        toolUseContext: {
          ...toolUseContext,
          abortController,
          agentId,
          agentType: agentDefinition.agentType,
          options: {
            ...toolUseContext.options,
            tools: availableTools,
          },
        },
        canUseTool,
        isAsync: false,
        canShowPermissionPrompts: true,
        querySource: 'workflow_agent',
        availableTools,
        description: opts?.label ?? prompt.slice(0, 60),
        ...(ownerAgentId ? { ownerAgentId } : {}),
        ...(workflow ? { workflow } : {}),
        override: { agentId, abortController },
      })
  for await (const message of iterator) {
    messages.push(message)
    if (
      message.type === 'attachment' &&
      message.attachment.type === 'structured_output'
    ) {
      structuredOutput = message.attachment.data
      continue
    }
    if (message.type !== 'assistant') continue
    updateProgressFromMessage(
      tracker,
      message,
      resolveActivity,
      toolUseContext.options.tools,
    )
    onProgress({
      tokens: getTokenCountFromTracker(tracker),
      toolCalls: tracker.toolUseCount,
      lastToolName: getLastToolUseName(message),
    })
  }

  if (schemaTool && structuredOutput === undefined) {
    const fallback = parseStructuredAgentText(extractFinalText(messages), opts?.schema)
    if (!fallback.ok) {
      throw new Error(
        `agent({schema}): no valid structured output was returned (${fallback.error})`,
      )
    }
    structuredOutput = fallback.value
  }

  const value = schemaTool ? structuredOutput : extractFinalText(messages)

  return {
    agentId,
    value: value ?? null,
    tokens: getTokenCountFromTracker(tracker),
    toolCalls: tracker.toolUseCount,
    // Keep exactly the model-visible conversation. Runtime-only attachments
    // are not transcript messages and must not be replayed on the next visit.
    conversationMessages: [
      ...promptMessages,
      ...messages.filter(message => message.type !== 'attachment'),
    ],
  }
}

/**
 * Resolve `opts.agentType` against the session's active agents.
 *
 * A named agent keeps its own system prompt and tool list — the workflow only
 * supplies the prompt — so a script can reuse `code-reviewer` or a custom
 * Agent instead of the generic workflow subagent.
 */
function resolveAgentDefinition(
  toolUseContext: ToolUseContext,
  opts: WorkflowAgentOptions | undefined,
): AgentDefinition {
  const requested = opts?.agentType
  const schemaToolName = opts?.schema ? SYNTHETIC_OUTPUT_TOOL_NAME : undefined
  if (requested == null) return buildWorkflowAgentDefinition(schemaToolName)

  const activeAgents = toolUseContext.options.agentDefinitions.activeAgents
  const match = activeAgents.find(agent => agent.agentType === requested)
  if (!match) {
    const available = activeAgents.map(agent => agent.agentType).join(', ')
    throw new Error(
      `agent({agentType}): agent type '${requested}' not found. Available agents: ${available}`,
    )
  }
  if (!schemaToolName) {
    return match
  }
  // Custom agent + schema: keep its prompt but append the StructuredOutput
  // instruction so the two contracts don't fight.
  const basePrompt = match.getSystemPrompt({
    toolUseContext: { options: toolUseContext.options },
  } as never)
  return {
    ...match,
    getSystemPrompt: () =>
      `${basePrompt}\n${workflowStructuredOutputNote(schemaToolName)}`,
  } as AgentDefinition
}

async function loadConversation(agentId: string | undefined): Promise<Message[]> {
  if (!agentId) return []
  const transcript = await getAgentTranscript(asAgentId(agentId))
  if (!transcript) return []
  return filterWhitespaceOnlyAssistantMessages(
    filterOrphanedThinkingOnlyMessages(
      filterUnresolvedToolUses(transcript.messages),
    ),
  )
}

function buildSchemaTool(
  schema: unknown,
): { tool: Tool } | { error: string } | undefined {
  if (schema == null) return undefined
  if (typeof schema !== 'object' || Array.isArray(schema)) {
    return { error: 'schema must be a JSON Schema object' }
  }
  return createSyntheticOutputTool(schema as Record<string, unknown>) as
    | { tool: Tool }
    | { error: string }
}

/**
 * The agent's final text. Falls back to the last assistant message that had
 * any text, so a run that ended on a bare tool_use block still returns
 * something instead of an empty string.
 */
function extractFinalText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type !== 'assistant') continue
    const text = extractTextContent(message.message.content, '\n').trim()
    if (text !== '') return text
  }
  return ''
}

/** Exposed so the harness can create per-agent controllers consistently. */
export function createWorkflowAgentController(
  parent: AbortSignal | undefined,
): AbortController {
  const controller = createAbortController()
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason)
    else {
      const onParentAbort = () => controller.abort(parent.reason)
      const detach = () => parent.removeEventListener('abort', onParentAbort)
      parent.addEventListener('abort', onParentAbort, { once: true })
      controller.signal.addEventListener('abort', detach, { once: true })
    }
  }
  return controller
}
