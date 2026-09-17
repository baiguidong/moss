import type {
  BetaContentBlock,
  BetaWebSearchTool20250305,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { queryModelWithStreaming } from '../../services/api/claude.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { createUserMessage } from '../../utils/messages.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'

export type NativeWebSearchProbeResult = {
  status: 'supported' | 'compatible' | 'unsupported' | 'unknown'
  format: 'structured' | 'compatible-text' | null
  reasonCode: string | null
}

const PROBE_TOOL: BetaWebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 1,
  allowed_domains: ['example.com'],
}

function classifyProbeError(error: unknown): NativeWebSearchProbeResult {
  const message = String(error instanceof Error ? error.message : error)
  if (/\b(401|403)\b|auth|credential|api key/i.test(message)) {
    return { status: 'unknown', format: null, reasonCode: 'authentication-failed' }
  }
  if (/\b429\b|rate.?limit/i.test(message)) {
    return { status: 'unknown', format: null, reasonCode: 'rate-limited' }
  }
  if (/abort|timeout|timed out/i.test(message)) {
    return { status: 'unknown', format: null, reasonCode: 'timeout' }
  }
  if (/\b(400|422)\b/.test(message)
    || /unknown tool|unsupported (?:server )?tool|tool schema|input_schema|extra input/i.test(message)
    || /(?:web_search|server tool).{0,80}(?:unsupported|unknown|invalid|not (?:allowed|supported))/i.test(message)) {
    return { status: 'unsupported', format: null, reasonCode: 'unsupported-tool-schema' }
  }
  return { status: 'unknown', format: null, reasonCode: 'request-failed' }
}

export async function probeNativeWebSearch(
  model: string,
  { timeoutMs = 20_000 }: { timeoutMs?: number } = {},
): Promise<NativeWebSearchProbeResult> {
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), timeoutMs)
  timer.unref?.()
  const blocks: BetaContentBlock[] = []

  try {
    const stream = queryModelWithStreaming({
      messages: [createUserMessage({
        content: 'Search the web for the IANA Example Domain on example.com.',
      })],
      systemPrompt: asSystemPrompt([
        'This request only verifies whether the configured endpoint can execute its web search server tool.',
      ]),
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal: abortController.signal,
      options: {
        getToolPermissionContext: async () => getEmptyToolPermissionContext(),
        model,
        toolChoice: { type: 'tool', name: 'web_search' },
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        extraToolSchemas: [PROBE_TOOL],
        maxOutputTokensOverride: 256,
        querySource: 'web_search_tool',
        agents: [],
        mcpTools: [],
      },
    })

    for await (const event of stream) {
      if (event.type === 'assistant') blocks.push(...event.message.content)
    }
  } catch (error) {
    return classifyProbeError(error)
  } finally {
    clearTimeout(timer)
  }

  const sawServerUse = blocks.some(block => (
    block.type === 'server_tool_use' && block.name === 'web_search'
  ))
  const searchResults = blocks.filter(block => block.type === 'web_search_tool_result')
  const structuredHits = searchResults.reduce((count, block) => (
    count + (Array.isArray(block.content) ? block.content.length : 0)
  ), 0)
  const sawText = blocks.some(block => block.type === 'text' && block.text.trim().length > 0)
  const sawResultError = searchResults.some(block => !Array.isArray(block.content))

  if (sawServerUse && structuredHits > 0) {
    return { status: 'supported', format: 'structured', reasonCode: null }
  }
  if (sawServerUse && searchResults.length > 0 && sawText && !sawResultError) {
    return { status: 'compatible', format: 'compatible-text', reasonCode: null }
  }
  if (sawServerUse || searchResults.length > 0) {
    return { status: 'unknown', format: null, reasonCode: 'search-service-unavailable' }
  }
  return { status: 'unknown', format: null, reasonCode: 'no-server-tool-evidence' }
}
