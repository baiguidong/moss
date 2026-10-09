import { z } from 'zod/v4'
import {
  buildTool,
  getGlobalAppEventBridge,
  type MossAppEvent,
  type MossAppEventResult,
  type ToolInputJSONSchema,
  type ToolDef,
  type ToolUseContext,
} from '../../Tool.js'
import { getTaskScopeContext } from '../../utils/sessionIdContext.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getProjectConnectorScopeError } from '../AgentTool/projectResourceScope.js'
import type { MossToolName } from './toolLoading.js'

const mossOutputSchema = z.object({
  ok: z.boolean(),
  app: z.unknown().optional(),
  apps: z.array(z.unknown()).optional(),
  versions: z.array(z.unknown()).optional(),
  fileKind: z.literal('image').optional(),
  filePath: z.string().optional(),
  buildDir: z.string().optional(),
  filePaths: z.array(z.string()).optional(),
  previewUrl: z.string().optional(),
  previewMarkdown: z.string().optional(),
  mediaType: z.string().optional(),
  metadataPath: z.string().optional(),
  htmlPath: z.string().optional(),
  connector: z.unknown().optional(),
  connected: z.boolean().optional(),
  setupStatus: z.string().optional(),
  version: z.string().optional(),
  authorizationUrlOpened: z.boolean().optional(),
  authorizationHost: z.string().optional(),
  auth: z.unknown().optional(),
  steps: z.array(z.unknown()).optional(),
  browser: z.unknown().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
})

export type MossOutput = z.infer<typeof mossOutputSchema>

type MossInputSchema = z.ZodType<Record<string, unknown>>

type MossToolConfig<InputSchema extends MossInputSchema> = {
  name: MossToolName
  description: string
  prompt?: string
  searchHint: string
  inputSchema: InputSchema
  inputJSONSchema?: ToolInputJSONSchema
  event: (input: z.infer<InputSchema>) => MossAppEvent
  readOnly?: boolean
  supportedEnvironments?: readonly ('desktop' | 'server')[]
  userFacingName?: string
  repeatKey?: (input: z.infer<InputSchema>) => string
  maxCallsPerTurn?: number
}

type RepeatedToolCall = {
  count: number
  result?: { data: MossOutput }
  pending?: Promise<{ data: MossOutput }>
}

const repeatedToolCallsByTurn = new WeakMap<AbortController, Map<string, RepeatedToolCall>>()

function normalizeBrowserOpenRepeatKey(
  input: { url?: string; query?: string; engine?: 'baidu' | 'google' | 'bing' },
): string {
  if (input.url) {
    const rawUrl = input.url.trim()
    try {
      const url = new URL(
        /^[a-z][a-z\d+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`,
      )
      return `url:${url.href}`
    } catch {
      return `url:${rawUrl}`
    }
  }

  const query = input.query?.trim().replace(/\s+/g, ' ') ?? ''
  return `query:${input.engine ?? 'baidu'}:${query}`
}

async function callMossHost(
  event: MossAppEvent,
  context: ToolUseContext,
): Promise<{ data: MossOutput }> {
  if (event.type === 'connector_cli_setup' || event.type === 'connector_mcp_authenticate') {
    const scopeError = getProjectConnectorScopeError(getTaskScopeContext(), {
      connectorId: event.input.connector_id,
      serverName: event.type === 'connector_mcp_authenticate'
        ? event.input.server_name
        : undefined,
    })
    if (scopeError) return { data: { ok: false, error: scopeError } }
  }

  const emitAppEvent = context.emitAppEvent ?? getGlobalAppEventBridge()
  if (!emitAppEvent) {
    const querySource = context.options.querySource ?? 'unknown'
    const agentId = context.agentId ?? 'main'
    return {
      data: {
        ok: false,
        error: `Moss host tools are not available in this context. Missing emitAppEvent bridge. querySource=${querySource} agentId=${agentId}`,
      },
    }
  }

  const result: MossAppEventResult = await emitAppEvent(event)
  if (!result.ok) return { data: { ok: false, error: result.error } }

  return {
    data: {
      ok: true,
      app: result.app,
      apps: result.apps,
      versions: result.versions,
      filePath: result.filePath,
      buildDir: (result as { buildDir?: string }).buildDir,
      filePaths: result.filePaths,
      fileKind: result.fileKind,
      previewUrl: result.previewUrl,
      previewMarkdown: result.previewMarkdown,
      mediaType: result.mediaType,
      metadataPath: result.metadataPath,
      htmlPath: result.htmlPath,
      connector: result.connector,
      connected: result.connected,
      setupStatus: result.setupStatus,
      version: result.version,
      authorizationUrlOpened: result.authorizationUrlOpened,
      authorizationHost: result.authorizationHost,
      auth: result.auth,
      steps: result.steps,
      browser: result.browser,
      message: result.message,
    },
  }
}

function createMossTool<InputSchema extends MossInputSchema>(
  config: MossToolConfig<InputSchema>,
) {
  return buildTool({
    name: config.name,
    requiresDesktop: true,
    supportedEnvironments: config.supportedEnvironments ?? ['desktop'],
    searchHint: config.searchHint,
    maxResultSizeChars: 100_000,
    async description() {
      return config.description
    },
    async prompt() {
      return config.prompt ?? config.description
    },
    get inputSchema(): InputSchema {
      return config.inputSchema
    },
    ...(config.inputJSONSchema ? { inputJSONSchema: config.inputJSONSchema } : {}),
    get outputSchema() {
      return mossOutputSchema
    },
    userFacingName() {
      return config.userFacingName ?? config.name
    },
    isConcurrencySafe() {
      return false
    },
    isReadOnly() {
      return config.readOnly === true
    },
    async checkPermissions(input: z.infer<InputSchema>) {
      return { behavior: 'allow' as const, updatedInput: input }
    },
    async call(input: z.infer<InputSchema>, context: ToolUseContext) {
      const turnKey = context.abortController
      const repeatKey = config.repeatKey?.(input)
      const maxCalls = config.maxCallsPerTurn ?? 0
      if (turnKey && repeatKey && maxCalls > 0) {
        let calls = repeatedToolCallsByTurn.get(turnKey)
        if (!calls) {
          calls = new Map()
          repeatedToolCallsByTurn.set(turnKey, calls)
        }
        let repeatedCall = calls.get(repeatKey)
        if (!repeatedCall) {
          repeatedCall = { count: 0 }
          calls.set(repeatKey, repeatedCall)
        }

        repeatedCall.count += 1
        if (repeatedCall.count >= maxCalls) {
          const error = new Error(
            `${config.name} was called repeatedly with the same input; stopped a repeated tool-call loop.`,
          )
          context.abortController.abort(error)
          throw error
        }

        if (repeatedCall.pending) {
          try {
            await repeatedCall.pending
          } catch {
            // A sequential duplicate gets one real retry after a failed call.
          }
        }

        if (repeatedCall.result?.data.ok) {
          return {
            data: {
              ...repeatedCall.result.data,
              message: `${config.name} already succeeded with the same input. Reused the previous result; do not call it again.`,
            },
          }
        }

        if (context.abortController.signal.aborted) {
          throw context.abortController.signal.reason instanceof Error
            ? context.abortController.signal.reason
            : new Error('Request interrupted.')
        }

        const pending = callMossHost(config.event(input), context)
        repeatedCall.pending = pending
        try {
          const result = await pending
          repeatedCall.result = result
          return result
        } finally {
          if (repeatedCall.pending === pending) {
            repeatedCall.pending = undefined
          }
        }
      }
      return callMossHost(config.event(input), context)
    },
    mapToolResultToToolResultBlockParam(content: MossOutput, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: jsonStringify(content),
      }
    },
  } satisfies ToolDef<InputSchema, MossOutput>)
}

const appBuildSchema = z.strictObject({
  name: z.string().min(1).describe('App slug/name. The manifest must exist at apps/{name}/app.moss.json.'),
})

export const AppBuildTool = createMossTool({
  name: 'app_build',
  description: 'Build a Moss App from apps/{name}/app.moss.json in the current session workspace and return its build directory.',
  searchHint: 'build compile Moss app',
  inputSchema: appBuildSchema,
  event: input => ({ type: 'app_build', input: { kind: 'app', name: input.name } }),
  userFacingName: 'App 构建',
})

const appPreviewSchema = z.strictObject({
  buildDir: z.string().min(1).describe('Path to the App build directory, usually apps/{name}/build.'),
})

export const AppPreviewTool = createMossTool({
  name: 'app_preview',
  description: 'Preview a built Moss App.',
  searchHint: 'preview built Moss app',
  inputSchema: appPreviewSchema,
  event: input => ({ type: 'app_preview', input: { kind: 'app', buildDir: input.buildDir } }),
  readOnly: true,
  userFacingName: 'App 预览',
})

const appPublishSchema = z.strictObject({
  name: z.string().min(1).describe('App slug/name.'),
  buildDir: z.string().min(1).describe('Path to the App build directory.'),
  description: z.string().min(1).describe('Published App description.'),
  reason: z.string().optional().describe('Optional release reason.'),
})

export const AppPublishTool = createMossTool({
  name: 'app_publish',
  description: 'Publish a built Moss App to the local App list as a versioned package.',
  searchHint: 'publish release Moss app',
  inputSchema: appPublishSchema,
  event: input => ({ type: 'app_publish', input: { kind: 'app', ...input } }),
  userFacingName: 'App 发布',
})

const appLaunchSchema = z.strictObject({
  name: z.string().min(1).describe('Installed App slug/name.'),
})

export const AppLaunchTool = createMossTool({
  name: 'app_launch',
  description: 'Open an installed Moss App.',
  searchHint: 'open launch installed app',
  inputSchema: appLaunchSchema,
  event: input => ({ type: 'app_launch', input }),
  readOnly: true,
  userFacingName: 'App 打开',
})

const appUpdateSchema = z.strictObject({
  name: z.string().min(1).describe('Installed App slug/name.'),
  buildDir: z.string().min(1).describe('Path to the new App build directory.'),
  description: z.string().optional().describe('Updated App description.'),
  reason: z.string().optional().describe('Reason for this update.'),
})

export const AppUpdateTool = createMossTool({
  name: 'app_update',
  description: 'Publish a new version of an installed Moss App from a build directory.',
  searchHint: 'update release installed app',
  inputSchema: appUpdateSchema,
  event: input => ({ type: 'app_update', input: { kind: 'app', ...input } }),
  userFacingName: 'App 更新',
})

const appExtractSchema = z.strictObject({
  name: z.string().min(1).describe('Installed App slug/name.'),
  versionId: z.string().optional().describe('Specific App version to extract. Defaults to the active version.'),
})

export const AppExtractToWorkspaceTool = createMossTool({
  name: 'app_extract_to_workspace',
  description: 'Extract an installed Moss App version into the current session workspace.',
  searchHint: 'extract app source workspace',
  inputSchema: appExtractSchema,
  event: input => ({ type: 'app_extract_to_workspace', input: { kind: 'app', ...input } }),
  userFacingName: 'App 提取',
})

const appGetVersionsSchema = z.strictObject({
  name: z.string().min(1).describe('Installed App slug/name.'),
})

export const AppGetVersionsTool = createMossTool({
  name: 'app_get_versions',
  description: 'List the version history of an installed Moss App.',
  searchHint: 'list app version history',
  inputSchema: appGetVersionsSchema,
  event: input => ({ type: 'app_get_versions', input }),
  readOnly: true,
  userFacingName: 'App 版本',
})

const browserOpenSchema = z.strictObject({
  url: z.string().min(1).optional().describe('URL to open only in the Moss embedded browser for manual viewing.'),
  query: z.string().min(1).optional().describe('Search query to open only in the Moss embedded browser for manual viewing.'),
  engine: z.enum(['baidu', 'google', 'bing']).optional().describe('Search engine for query. Defaults to baidu for Chinese searches.'),
}).refine(input => Boolean(input.url || input.query), {
  message: 'Provide either url or query.',
})

export const MossBrowserOpenTool = createMossTool({
  name: 'moss_browser_open',
  supportedEnvironments: ['desktop', 'server'],
  description: 'Open a URL or search query ONLY in the Moss embedded browser panel for the user to view and interact with manually. For automated navigation, screenshots, clicks, or typing, use the playwright-cdp MCP tools.',
  prompt: [
    'Open a URL or search query ONLY in the Moss embedded right-side browser for manual viewing. Provide either url or query.',
    'This tool cannot open system Chrome, enable CDP, read page contents, take screenshots, click, or type. Moss browser tabs are separate from the browser controlled by playwright-cdp; opening a Moss tab does not make it available to CDP tools.',
    'For browser automation, use ToolSearch to discover browser_navigate from the playwright-cdp MCP service and use that service for navigation and all subsequent page operations. Never call moss_browser_open to prepare a page for CDP. If the browser MCP service is unavailable, report that it needs to be enabled; this tool is not an automation fallback.',
    'Use engine "baidu" when the user asks for Baidu or requests a Chinese search without naming another engine.',
    'When this returns ok, do not repeat the call merely because the user cannot see the panel; explain that the Moss browser panel is on the right and provide the exact URL.',
  ].join(' '),
  searchHint: 'open moss embedded browser manual viewing preview',
  inputSchema: browserOpenSchema,
  // Some OpenAI-compatible providers reject combinators at the schema root.
  // The Zod refinement above still enforces that url or query is present.
  inputJSONSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        minLength: 1,
        description: 'URL to open only in the Moss embedded browser for manual viewing.',
      },
      query: {
        type: 'string',
        minLength: 1,
        description: 'Search query to open only in the Moss embedded browser for manual viewing.',
      },
      engine: {
        type: 'string',
        enum: ['baidu', 'google', 'bing'],
        description: 'Search engine for query. Defaults to baidu for Chinese searches.',
      },
    },
    additionalProperties: false,
  },
  event: input => ({ type: 'browser_open', input }),
  repeatKey: normalizeBrowserOpenRepeatKey,
  maxCallsPerTurn: 3,
  readOnly: true,
  userFacingName: 'Moss 内置浏览器',
})

const connectorCliSetupSchema = z.strictObject({
  connector_id: z.string().min(1).describe('Installed marketplace connector id.'),
})

export const ConnectorCliSetupTool = createMossTool({
  name: 'connector_cli_setup',
  description: 'Install or upgrade an installed connector CLI, complete its authorization flow, and verify its status.',
  prompt: 'Use this instead of running connector CLI init, auth, or status commands manually. It reads cli.json, opens OAuth when needed, waits for completion, and returns a redacted status summary.',
  searchHint: 'setup authenticate connector CLI',
  inputSchema: connectorCliSetupSchema,
  event: input => ({ type: 'connector_cli_setup', input }),
  userFacingName: '连接器',
})

const connectorMcpAuthenticateSchema = z.strictObject({
  connector_id: z.string().min(1).optional().describe('Installed marketplace connector id.'),
  server_name: z.string().min(1).optional().describe('MCP server name.'),
}).refine(input => Boolean(input.connector_id || input.server_name), {
  message: 'Provide either connector_id or server_name.',
})

export const ConnectorMcpAuthenticateTool = createMossTool({
  name: 'connector_mcp_authenticate',
  description: 'Authenticate an installed marketplace connector MCP server.',
  prompt: 'Use this when connector MCP tools are missing, empty, or report that authorization is required. Never ask the user to type /mcp. When status is authenticated, tell the user the connector is ready and continue the original request on their next message after tools refresh.',
  searchHint: 'authorize connector MCP server',
  inputSchema: connectorMcpAuthenticateSchema,
  // Keep the provider-facing root schema free of combinators. The Zod
  // refinement above enforces that one of these identifiers is present.
  inputJSONSchema: {
    type: 'object',
    properties: {
      connector_id: {
        type: 'string',
        minLength: 1,
        description: 'Installed marketplace connector id.',
      },
      server_name: {
        type: 'string',
        minLength: 1,
        description: 'MCP server name.',
      },
    },
    additionalProperties: false,
  },
  event: input => ({ type: 'connector_mcp_authenticate', input }),
  userFacingName: '连接器',
})

export const MossTools = [
  MossBrowserOpenTool,
  AppBuildTool,
  AppPreviewTool,
  AppPublishTool,
  AppLaunchTool,
  AppUpdateTool,
  AppExtractToWorkspaceTool,
  AppGetVersionsTool,
  ConnectorCliSetupTool,
  ConnectorMcpAuthenticateTool,
] as const
