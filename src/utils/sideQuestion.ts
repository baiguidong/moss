/**
 * Side Question ("/btw") feature - allows asking quick questions without
 * interrupting the main agent context.
 *
 * Uses runForkedAgent to leverage prompt caching from the parent context
 * while keeping the side question response separate from main conversation.
 */

import { formatAPIError } from '../services/api/errorUtils.js'
import type { NonNullableUsage } from '../services/api/logging.js'
import type { Message, SystemAPIErrorMessage } from '../types/message.js'
import { type CacheSafeParams, runForkedAgent } from './forkedAgent.js'
import { createUserMessage, extractTextContent } from './messages.js'
import { queryModelWithStreaming, accumulateUsage, updateUsage } from '../services/api/claude.js'
import { EMPTY_USAGE } from '../services/api/logging.js'
import { utf8Prefix } from './boundedToolOutput.js'
import { asSystemPrompt, stripMainSessionSystemPrompt } from './systemPromptType.js'

// Pattern to detect "/btw" at start of input (case-insensitive, word boundary)
const BTW_PATTERN = /^\/btw\b/gi

/**
 * Find positions of "/btw" keyword at the start of text for highlighting.
 * Similar to findThinkingTriggerPositions in thinking.ts.
 */
export function findBtwTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  const matches = text.matchAll(BTW_PATTERN)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

export type SideQuestionResult = {
  response: string | null
  usage: NonNullableUsage
  status?: 'completed' | 'empty' | 'truncated' | 'tool_unavailable' | 'failed'
}

/** Keep completed receipts unchanged; an unfinished tool is not a failed or successful tool. */
export function snapshotSideQuestionMessages(messages: Message[]): Message[] {
  type Block = { type: string; id?: string; tool_use_id?: string }
  const snapshot = structuredClone(messages)
  const answered = new Set(snapshot.flatMap(message => message.type === 'user' && Array.isArray(message.message.content)
    ? message.message.content.flatMap((block: Block) => block.type === 'tool_result' ? [block.tool_use_id] : []) : []))
  return snapshot.flatMap(message => {
    const pending = message.type === 'assistant' ? message.message.content.filter((block: Block) => block.type === 'tool_use' && typeof block.id === 'string' && !answered.has(block.id)) : []
    return [message, ...(pending.length ? [createUserMessage({ isMeta: true, content: pending.map((block: Block) => ({
      type: 'tool_result' as const, tool_use_id: (block as { id: string }).id,
      content: '[Side-question snapshot: no result has been received for this tool. It may be executing or waiting for approval. Its completion and outcome are unknown.]',
    })) })] : [])]
  })
}

/** Providers may reject historical tool blocks when the request declares no tools. */
export function sideQuestionApiMessages(messages: Message[]): Message[] {
  return snapshotSideQuestionMessages(messages).map(message => {
    if ((message.type !== 'assistant' && message.type !== 'user') || !Array.isArray(message.message.content)) return message
    const content = message.message.content.flatMap((block: { type: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }) => {
      if (block.type === 'tool_use') return [{ type: 'text', text: `[Main conversation tool request ${block.id}: ${block.name}]\n${JSON.stringify(block.input)}` }]
      if (block.type === 'tool_result') {
        const result = typeof block.content === 'string' ? [{ type: 'text', text: block.content }]
          : Array.isArray(block.content) ? block.content.filter(item => item.type === 'text' || item.type === 'image') : []
        return [{ type: 'text', text: `[Main conversation tool receipt ${block.tool_use_id}${block.is_error ? ', reported error' : ''}]` }, ...result]
      }
      return [block]
    })
    return { ...message, message: { ...message.message, content } }
  })
}

/**
 * Run a side question using a forked agent.
 * Shares the parent's prompt cache — no thinking override, no cache write.
 * All tools are blocked and we cap at 1 turn.
 */
export async function runSideQuestion({
  question,
  cacheSafeParams,
  abortController,
  isolated = false,
}: {
  question: string
  cacheSafeParams: CacheSafeParams
  abortController?: AbortController
  isolated?: boolean
}): Promise<SideQuestionResult> {
  // Wrap the question with instructions to answer without tools
  const wrappedQuestion = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- This side question does not interrupt, start, or change the main task; it may be running, waiting, or idle
- Use only the states recorded in this snapshot; a pending tool is not evidence of completion
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>

${question}`

  if (isolated) {
    // Desktop/Web side questions use only the model adapter. No query loop,
    // hooks, tool executor, task mutations, or main transcript writes run here.
    const { prependUserContext, appendSystemContext } = await import('./api.js')
    const context = cacheSafeParams.toolUseContext
    const signal = (abortController ?? new AbortController()).signal
    signal.throwIfAborted()
    const output: Message[] = []
    let usage = { ...EMPTY_USAGE }
    let truncated = false
    for await (const message of queryModelWithStreaming({
      messages: prependUserContext([...sideQuestionApiMessages(cacheSafeParams.forkContextMessages), createUserMessage({ content: wrappedQuestion })], cacheSafeParams.userContext),
      systemPrompt: asSystemPrompt(appendSystemContext(
        stripMainSessionSystemPrompt(cacheSafeParams.systemPrompt, context.options.mainSessionSystemPrompt),
        cacheSafeParams.systemContext,
      )),
      tools: [], thinkingConfig: context.options.thinkingConfig, signal,
      options: { model: context.options.mainLoopModel, isNonInteractiveSession: true,
        querySource: 'side_question', agents: [], mcpTools: [], hasAppendSystemPrompt: false,
        maxOutputTokensOverride: 4096, skipCacheWrite: true,
        effortValue: context.getAppState().effortValue,
        getToolPermissionContext: async () => context.getAppState().toolPermissionContext },
    })) {
      if (message.type === 'stream_event') {
        if (message.event.type === 'message_delta') {
          usage = accumulateUsage(usage, updateUsage({ ...EMPTY_USAGE }, message.event.usage))
          truncated ||= message.event.delta.stop_reason === 'max_tokens'
        }
      } else output.push(message)
    }
    signal.throwIfAborted()
    const failed = output.some(message => message.type === 'assistant' && message.isApiErrorMessage)
    const response = extractSideQuestionResponse(output.filter(message => !(message.type === 'assistant' && message.isApiErrorMessage)))
      ?? (failed ? extractSideQuestionResponse(output) : null)
    const limited = response ? utf8Prefix(response, 32_000) : null
    const usedTool = output.some(message => message.type === 'assistant' && message.message.content.some((block: { type: string }) => block.type === 'tool_use'))
    return { response: limited, usage, status: truncated && response ? 'truncated' : failed ? 'failed' : usedTool ? 'tool_unavailable' : !response ? 'empty' : limited !== response ? 'truncated' : 'completed' }
  }

  const agentResult = await runForkedAgent({
    promptMessages: [createUserMessage({ content: wrappedQuestion })],
    // Do NOT override thinkingConfig — thinking is part of the API cache key,
    // and diverging from the main thread's config busts the prompt cache.
    // Adaptive thinking on a quick Q&A has negligible overhead.
    cacheSafeParams,
    canUseTool: async () => ({
      behavior: 'deny' as const,
      message: 'Side questions cannot use tools',
      decisionReason: { type: 'other' as const, reason: 'side_question' },
    }),
    querySource: 'side_question',
    forkLabel: 'side_question',
    maxTurns: 1, // Single turn only - no tool use loops
    // No future request shares this suffix; skip writing cache entries.
    skipCacheWrite: true,
  })

  return {
    response: extractSideQuestionResponse(agentResult.messages),
    usage: agentResult.totalUsage,
  }
}

/**
 * Extract a display string from forked agent messages.
 *
 * IMPORTANT: claude.ts yields one AssistantMessage PER CONTENT BLOCK, not one
 * per API response. With adaptive thinking enabled (inherited from the main
 * thread to preserve the cache key), a thinking response arrives as:
 *   messages[0] = assistant { content: [thinking_block] }
 *   messages[1] = assistant { content: [text_block] }
 *
 * The old code used `.find(m => m.type === 'assistant')` which grabbed the
 * first (thinking-only) message, found no text block, and returned null →
 * "No response received". Repos with large context (many skills, big AGENTS.md)
 * trigger thinking more often, which is why this reproduced in the monorepo
 * but not here.
 *
 * Secondary failure modes also surfaced as "No response received":
 *   - Model attempts tool_use → content = [thinking, tool_use], no text.
 *     Rare — the system-reminder usually prevents this, but handled here.
 *   - API error exhausts retries → query yields system api_error + user
 *     interruption, no assistant message at all.
 */
function extractSideQuestionResponse(messages: Message[]): string | null {
  // Flatten all assistant content blocks across the per-block messages.
  const assistantBlocks = messages.flatMap(m =>
    m.type === 'assistant' ? m.message.content : [],
  )

  if (assistantBlocks.length > 0) {
    // Concatenate all text blocks (there's normally at most one, but be safe).
    const text = extractTextContent(assistantBlocks, '\n\n').trim()
    if (text) return text

    // No text — check if the model tried to call a tool despite instructions.
    const toolUse = assistantBlocks.find(b => b.type === 'tool_use')
    if (toolUse) {
      const toolName = 'name' in toolUse ? toolUse.name : 'a tool'
      return `(The model tried to call ${toolName} instead of answering directly. Try rephrasing or ask in the main conversation.)`
    }
  }

  // No assistant content — likely API error exhausted retries. Surface the
  // first system api_error message so the user sees what happened.
  const apiErr = messages.find(
    (m): m is SystemAPIErrorMessage =>
      m.type === 'system' && 'subtype' in m && m.subtype === 'api_error',
  )
  if (apiErr) {
    return `(API error: ${formatAPIError(apiErr.error)})`
  }

  return null
}
