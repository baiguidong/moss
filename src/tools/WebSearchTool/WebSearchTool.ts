import type {
  BetaContentBlock,
  BetaWebSearchTool20250305,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import { z } from 'zod/v4'
import { getAdvancedSetting } from '../../services/advancedSettings.js'
import { queryModelWithStreaming } from '../../services/api/claude.js'
import {
  buildTool,
  type ToolCallProgress,
  type ToolDef,
  type ToolUseContext,
} from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { createUserMessage } from '../../utils/messages.js'
import { getMainLoopModel, getSmallFastModel } from '../../utils/model/model.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import {
  getApiKeyForProvider,
  getConfiguredWebSearchSettings,
  getWebSearchCandidates,
  isWebSearchEnabledForModel,
  makeWebSearchUnavailableOutput,
  markNativeWebSearchUnsupported,
  searchWithExternalProvider,
  shouldFallbackFromNativeError,
} from './backend.js'
import { getWebSearchPrompt, WEB_SEARCH_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(2).describe('The search query to use'),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe('Only include search results from these domains'),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe('Never include search results from these domains'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export type Input = z.infer<InputSchema>

const searchResultSchema = lazySchema(() => {
  const searchHitSchema = z.object({
    title: z.string().describe('The title of the search result'),
    url: z.string().describe('The URL of the search result'),
    snippet: z.string().optional().describe('A relevant result excerpt'),
  })

  return z.object({
    tool_use_id: z.string().describe('ID of the tool use'),
    content: z.array(searchHitSchema).describe('Array of search hits'),
  })
})

export type SearchResult = z.infer<ReturnType<typeof searchResultSchema>>

const outputSchema = lazySchema(() =>
  z.object({
    query: z.string().describe('The search query that was executed'),
    results: z
      .array(z.union([searchResultSchema(), z.string()]))
      .describe('Search results and/or text commentary from the model'),
    durationSeconds: z
      .number()
      .describe('Time taken to complete the search operation'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Re-export WebSearchProgress from centralized types to break import cycles
export type { WebSearchProgress } from '../../types/tools.js'

import type { WebSearchProgress } from '../../types/tools.js'

function makeToolSchema(input: Input): BetaWebSearchTool20250305 {
  return {
    type: 'web_search_20250305',
    name: 'web_search',
    allowed_domains: input.allowed_domains,
    blocked_domains: input.blocked_domains,
    max_uses: 8, // Hardcoded to 8 searches maximum
  }
}

function makeOutputFromSearchResponse(
  result: BetaContentBlock[],
  query: string,
  durationSeconds: number,
): Output {
  // The result is a sequence of these blocks:
  // - text to start -- always?
  // [
  //    - server_tool_use
  //    - web_search_tool_result
  //    - text and citation blocks intermingled
  //  ]+  (this block repeated for each search)

  const results: (SearchResult | string)[] = []
  let textAcc = ''
  let inText = true

  for (const block of result) {
    if (block.type === 'server_tool_use') {
      if (inText) {
        inText = false
        if (textAcc.trim().length > 0) {
          results.push(textAcc.trim())
        }
        textAcc = ''
      }
      continue
    }

    if (block.type === 'web_search_tool_result') {
      // Handle error case - content is a WebSearchToolResultError
      if (!Array.isArray(block.content)) {
        const errorMessage = `Web search error: ${block.content.error_code}`
        logError(new Error(errorMessage))
        results.push(errorMessage)
        continue
      }
      // Success case - add results to our collection
      const hits = block.content.map(r => ({ title: r.title, url: r.url }))
      results.push({
        tool_use_id: block.tool_use_id,
        content: hits,
      })
    }

    if (block.type === 'text') {
      if (inText) {
        textAcc += block.text
      } else {
        inText = true
        textAcc = block.text
      }
    }
  }

  if (textAcc.length) {
    results.push(textAcc.trim())
  }

  return {
    query,
    results,
    durationSeconds,
  }
}

async function callNativeWebSearch(
  input: Input,
  context: ToolUseContext,
  onProgress: ToolCallProgress<WebSearchProgress> | undefined,
  startTime: number,
) {
  const { query } = input
  const userMessage = createUserMessage({
    content: 'Perform a web search for the query: ' + query,
  })
  const useFastWebSearch = getAdvancedSetting('moss_fast_web_search')
  const appState = context.getAppState()
  const queryStream = queryModelWithStreaming({
    messages: [userMessage],
    systemPrompt: asSystemPrompt([
      'You are an assistant for performing a web search tool use',
    ]),
    thinkingConfig: useFastWebSearch
      ? { type: 'disabled' as const }
      : context.options.thinkingConfig,
    tools: [],
    signal: context.abortController.signal,
    options: {
      getToolPermissionContext: async () => appState.toolPermissionContext,
      model: useFastWebSearch ? getSmallFastModel() : context.options.mainLoopModel,
      toolChoice: useFastWebSearch ? { type: 'tool', name: 'web_search' } : undefined,
      isNonInteractiveSession: context.options.isNonInteractiveSession,
      hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
      extraToolSchemas: [makeToolSchema(input)],
      querySource: 'web_search_tool',
      agents: context.options.agentDefinitions.activeAgents,
      mcpTools: [],
      agentId: context.agentId,
      effortValue: appState.effortValue,
    },
  })

  const allContentBlocks: BetaContentBlock[] = []
  let currentToolUseId: string | null = null
  let currentToolUseJson = ''
  let progressCounter = 0
  const toolUseQueries = new Map<string, string>()

  for await (const event of queryStream) {
    if (event.type === 'assistant') {
      allContentBlocks.push(...event.message.content)
      continue
    }
    if (
      event.type === 'stream_event'
      && event.event?.type === 'content_block_start'
    ) {
      const contentBlock = event.event.content_block
      if (contentBlock?.type === 'server_tool_use') {
        currentToolUseId = contentBlock.id
        currentToolUseJson = ''
        continue
      }
      if (contentBlock?.type === 'web_search_tool_result') {
        const actualQuery = toolUseQueries.get(contentBlock.tool_use_id) || query
        progressCounter += 1
        onProgress?.({
          toolUseID: contentBlock.tool_use_id || `search-progress-${progressCounter}`,
          data: {
            type: 'search_results_received',
            resultCount: Array.isArray(contentBlock.content) ? contentBlock.content.length : 0,
            query: actualQuery,
          },
        })
      }
    }
    if (
      currentToolUseId
      && event.type === 'stream_event'
      && event.event?.type === 'content_block_delta'
    ) {
      const delta = event.event.delta
      if (delta?.type !== 'input_json_delta' || !delta.partial_json) continue
      currentToolUseJson += delta.partial_json
      try {
        const queryMatch = currentToolUseJson.match(/"query"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        if (!queryMatch?.[1]) continue
        const actualQuery = jsonParse('"' + queryMatch[1] + '"')
        if (toolUseQueries.get(currentToolUseId) === actualQuery) continue
        toolUseQueries.set(currentToolUseId, actualQuery)
        progressCounter += 1
        onProgress?.({
          toolUseID: `search-progress-${progressCounter}`,
          data: { type: 'query_update', query: actualQuery },
        })
      } catch {}
    }
  }

  return {
    data: makeOutputFromSearchResponse(
      allContentBlocks,
      query,
      (performance.now() - startTime) / 1000,
    ),
  }
}

export const WebSearchTool = buildTool({
  name: WEB_SEARCH_TOOL_NAME,
  searchHint: 'search the web for current information',
  maxResultSizeChars: 100_000,
  async description(input) {
    return `Claude wants to search the web for: ${input.query}`
  },
  userFacingName() {
    return 'Web Search'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Searching for ${summary}` : 'Searching the web'
  },
  isEnabled() {
    return isWebSearchEnabledForModel(getMainLoopModel())
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async checkPermissions(_input): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: 'WebSearchTool requires permission.',
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: WEB_SEARCH_TOOL_NAME }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ],
    }
  },
  async prompt() {
    return getWebSearchPrompt()
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  extractSearchText() {
    // renderToolResultMessage shows only "Did N searches in Xs" chrome —
    // the results[] content never appears on screen. Heuristic would index
    // string entries in results[] (phantom match). Nothing to search.
    return ''
  },
  async validateInput(input) {
    const { query, allowed_domains, blocked_domains } = input
    if (!query.length) {
      return {
        result: false,
        message: 'Error: Missing query',
        errorCode: 1,
      }
    }
    if (allowed_domains?.length && blocked_domains?.length) {
      return {
        result: false,
        message:
          'Error: Cannot specify both allowed_domains and blocked_domains in the same request',
        errorCode: 2,
      }
    }
    return { result: true }
  },
  async call(input, context, _canUseTool, _parentMessage, onProgress) {
    const startTime = performance.now()
    const settings = getConfiguredWebSearchSettings(context.options.mainLoopModel)
    const candidates = getWebSearchCandidates(context.options.mainLoopModel, settings)
    const failures: string[] = []

    for (const provider of candidates) {
      try {
        if (provider === 'native') {
          return await callNativeWebSearch(input, context, onProgress, startTime)
        }
        const apiKey = getApiKeyForProvider(provider, settings)
        if (!apiKey) continue
        const data = await searchWithExternalProvider(
          provider,
          input,
          apiKey,
          context.abortController.signal,
        )
        onProgress?.({
          toolUseID: `${provider}-web-search`,
          data: {
            type: 'search_results_received',
            resultCount: typeof data.results[1] === 'object'
              ? data.results[1].content.length
              : 0,
            query: input.query,
          },
        })
        return { data }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`${provider}: ${message}`)
        if (provider === 'native' && shouldFallbackFromNativeError(error)) {
          markNativeWebSearchUnsupported(context.options.mainLoopModel)
        }
        if (settings.mode !== 'auto') throw error
      }
    }

    return {
      data: makeWebSearchUnavailableOutput(
        input.query,
        (performance.now() - startTime) / 1000,
        failures.length > 0
          ? `Web search failed: ${failures.join('; ')}`
          : 'Web search is not configured for this model endpoint.',
      ),
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const { query, results } = output

    let formattedOutput = `Web search results for query: "${query}"\n\n`

    // Process the results array - it can contain both string summaries and search result objects.
    // Guard against null/undefined entries that can appear after JSON round-tripping
    // (e.g., from compaction or transcript deserialization).
    ;(results ?? []).forEach(result => {
      if (result == null) {
        return
      }
      if (typeof result === 'string') {
        // Text summary
        formattedOutput += result + '\n\n'
      } else {
        // Search result with links
        if (result.content?.length > 0) {
          formattedOutput += `Links: ${jsonStringify(result.content)}\n\n`
        } else {
          formattedOutput += 'No links found.\n\n'
        }
      }
    })

    formattedOutput +=
      '\nREMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.'

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: formattedOutput.trim(),
    }
  },
} satisfies ToolDef<InputSchema, Output, WebSearchProgress>)
