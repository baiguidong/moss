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
import {
  shouldDeferMossTool,
  type MossToolName,
} from './toolLoading.js'

const imageAspectRatioSchema = z.enum([
  '1:1',
  '16:9',
  '4:3',
  '3:2',
  '2:3',
  '3:4',
  '9:16',
  '21:9',
])

const subjectReferenceSchema = z.strictObject({
  type: z.literal('character'),
  image_file: z.string().url(),
})

const tabIdField = {
  tab_id: z.string().optional().describe('Browser tab id. Omit to use the active tab in the current Moss session.'),
}

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
  browserPermission?: boolean
  userFacingName?: string
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
    searchHint: config.searchHint,
    maxResultSizeChars: 100_000,
    shouldDefer: () => shouldDeferMossTool(config.name),
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
      if (config.browserPermission) {
        return {
          behavior: 'ask' as const,
          message: 'Browser automation requires access to the current Moss browser page.',
        }
      }
      return { behavior: 'allow' as const, updatedInput: input }
    },
    async call(input: z.infer<InputSchema>, context: ToolUseContext) {
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
  searchHint: 'build compile desktop app',
  inputSchema: appBuildSchema,
  event: input => ({ type: 'app_build', input: { kind: 'app', name: input.name } }),
  userFacingName: 'App 构建',
})

const appPreviewSchema = z.strictObject({
  buildDir: z.string().min(1).describe('Path to the App build directory, usually apps/{name}/build.'),
})

export const AppPreviewTool = createMossTool({
  name: 'app_preview',
  description: 'Preview a built Moss App in the desktop application.',
  searchHint: 'preview built desktop app',
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
  searchHint: 'publish release desktop app',
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
  url: z.string().min(1).optional().describe('URL to open in the Moss right-side browser.'),
  query: z.string().min(1).optional().describe('Search query to open in the Moss right-side browser.'),
  engine: z.enum(['baidu', 'google', 'bing']).optional().describe('Search engine for query. Defaults to baidu for Chinese searches.'),
}).refine(input => Boolean(input.url || input.query), {
  message: 'Provide either url or query.',
})

export const BrowserOpenTool = createMossTool({
  name: 'browser_open',
  description: 'Open a URL or search query in the Moss right-side browser panel and bring it into view.',
  prompt: 'Open a URL or search query in the Moss right-side browser. Provide either url or query. Use engine "baidu" when the user asks for Baidu or requests a Chinese search without naming another engine. When this returns ok, do not repeat the call merely because the user cannot see the panel; explain that the browser panel is on the right and provide the exact URL.',
  searchHint: 'open website search browser',
  inputSchema: browserOpenSchema,
  inputJSONSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        minLength: 1,
        description: 'URL to open in the Moss right-side browser.',
      },
      query: {
        type: 'string',
        minLength: 1,
        description: 'Search query to open in the Moss right-side browser.',
      },
      engine: {
        type: 'string',
        enum: ['baidu', 'google', 'bing'],
        description: 'Search engine for query. Defaults to baidu for Chinese searches.',
      },
    },
    anyOf: [
      { required: ['url'] },
      { required: ['query'] },
    ],
    additionalProperties: false,
  },
  event: input => ({ type: 'browser_open', input }),
  readOnly: true,
  userFacingName: '浏览器',
})

const browserSnapshotSchema = z.strictObject({
  ...tabIdField,
  full_page: z.boolean().optional().describe('Capture the full page instead of the visible viewport.'),
})

export const BrowserSnapshotTool = createMossTool({
  name: 'browser_snapshot',
  description: 'Inspect the active Moss browser tab, capture its actual rendered pixels, save the screenshot, and return page text and stable element refs.',
  prompt: 'Use this tool whenever the user asks to screenshot, capture, or show the current browser, page, or HTML. Never use image_generate to recreate or approximate a screenshot. The actual capture is saved in the workspace and attached to the conversation without inlining image bytes into model context. If visual analysis is needed, read the returned filePath; image reads are resized/compressed to the model image budget. Prefer viewport screenshots; use full_page only when the complete layout matters. Take a new snapshot after navigation or scrolling.',
  searchHint: 'inspect screenshot browser page',
  inputSchema: browserSnapshotSchema,
  event: input => ({ type: 'browser_snapshot', input }),
  readOnly: true,
  browserPermission: true,
  userFacingName: '浏览器',
})

const browserClickSchema = z.strictObject({
  ...tabIdField,
  snapshot_id: z.string().min(1).describe('Snapshot id returned by browser_snapshot.'),
  ref: z.string().min(1).describe('Element reference such as e1 returned by browser_snapshot.'),
  click_count: z.union([z.literal(1), z.literal(2)]).optional().describe('Click count. Defaults to 1.'),
})

export const BrowserClickTool = createMossTool({
  name: 'browser_click',
  description: 'Click an element from the latest Moss browser snapshot using its stable reference.',
  prompt: 'Call browser_snapshot first, then pass its snapshot id and element ref. Take a new snapshot after navigation. Do not use JavaScript or CSS selectors.',
  searchHint: 'click browser element',
  inputSchema: browserClickSchema,
  event: input => ({ type: 'browser_click', input }),
  browserPermission: true,
  userFacingName: '浏览器',
})

const browserTypeSchema = z.strictObject({
  ...tabIdField,
  snapshot_id: z.string().min(1).describe('Snapshot id returned by browser_snapshot.'),
  ref: z.string().min(1).describe('Input element reference returned by browser_snapshot.'),
  text: z.string().describe('Text to enter.'),
  clear: z.boolean().optional().describe('Clear the field first. Defaults to true.'),
  submit: z.boolean().optional().describe('Press Enter after typing.'),
})

export const BrowserTypeTool = createMossTool({
  name: 'browser_type',
  description: 'Enter text into an element from the latest Moss browser snapshot.',
  prompt: 'Call browser_snapshot first, then pass its snapshot id and element ref. Use submit to press Enter after typing. Do not use JavaScript or CSS selectors.',
  searchHint: 'type fill browser input',
  inputSchema: browserTypeSchema,
  event: input => ({ type: 'browser_type', input }),
  browserPermission: true,
  userFacingName: '浏览器',
})

const browserPressSchema = z.strictObject({
  ...tabIdField,
  key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Space']).describe('Keyboard key to press.'),
})

export const BrowserPressTool = createMossTool({
  name: 'browser_press',
  description: 'Press a supported keyboard key in the active Moss browser tab.',
  searchHint: 'keyboard key browser page',
  inputSchema: browserPressSchema,
  event: input => ({ type: 'browser_press', input }),
  browserPermission: true,
  userFacingName: '浏览器',
})

const browserScrollSchema = z.strictObject({
  ...tabIdField,
  delta_x: z.number().int().min(-4000).max(4000).optional().describe('Horizontal scroll delta.'),
  delta_y: z.number().int().min(-4000).max(4000).optional().describe('Vertical scroll delta. Defaults to 600.'),
})

export const BrowserScrollTool = createMossTool({
  name: 'browser_scroll',
  description: 'Scroll the active Moss browser tab by bounded pixel deltas.',
  prompt: 'Scroll the active browser tab, then call browser_snapshot again because previous element references are stale.',
  searchHint: 'scroll browser page viewport',
  inputSchema: browserScrollSchema,
  event: input => ({ type: 'browser_scroll', input }),
  browserPermission: true,
  userFacingName: '浏览器',
})

const browserWaitSchema = z.strictObject({
  ...tabIdField,
  text: z.string().optional().describe('Text to wait for.'),
  url_contains: z.string().optional().describe('URL substring to wait for.'),
  timeout_ms: z.number().int().min(100).max(15_000).optional().describe('Maximum wait in milliseconds.'),
})

export const BrowserWaitTool = createMossTool({
  name: 'browser_wait',
  description: 'Wait for text, a URL change, or page settling in the active Moss browser tab.',
  searchHint: 'wait browser text navigation',
  inputSchema: browserWaitSchema,
  event: input => ({ type: 'browser_wait', input }),
  readOnly: true,
  browserPermission: true,
  userFacingName: '浏览器',
})

const browserReloadSchema = z.strictObject({ ...tabIdField })

export const BrowserReloadTool = createMossTool({
  name: 'browser_reload',
  description: 'Reload the active Moss browser tab.',
  searchHint: 'refresh reload browser page',
  inputSchema: browserReloadSchema,
  event: input => ({ type: 'browser_reload', input }),
  browserPermission: true,
  userFacingName: '浏览器',
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
    anyOf: [
      { required: ['connector_id'] },
      { required: ['server_name'] },
    ],
    additionalProperties: false,
  },
  event: input => ({ type: 'connector_mcp_authenticate', input }),
  userFacingName: '连接器',
})

const imageGenerateSchema = z.strictObject({
  prompt: z.string().min(1).describe('Description of the image to synthesize.'),
  out_path: z.string().min(1).describe('Relative output path inside the current session workspace.'),
  aspect_ratio: imageAspectRatioSchema.optional().describe('Requested output aspect ratio.'),
  subject_reference: z.array(subjectReferenceSchema).optional().describe('Optional character reference images.'),
})

export const ImageGenerateTool = createMossTool({
  name: 'image_generate',
  description: 'Synthesize a new image from a prompt and save it in the current session workspace.',
  prompt: 'Use only for synthesizing a new image. Never use this tool to recreate or approximate a browser or application screenshot; use browser_snapshot for screenshots. out_path must be relative to the current session workspace. On success, prefer previewMarkdown when referencing the result.',
  searchHint: 'generate create synthetic image',
  inputSchema: imageGenerateSchema,
  event: input => ({ type: 'image_generate', input }),
  userFacingName: '图片生成',
})

const imageEditSchema = z.strictObject({
  prompt: z.string().min(1).describe('Requested image edit.'),
  source_path: z.string().min(1).describe('Relative source image path inside the current session workspace.'),
  out_path: z.string().min(1).describe('Relative output path inside the current session workspace.'),
  aspect_ratio: imageAspectRatioSchema.optional().describe('Optional output aspect ratio.'),
})

export const ImageEditTool = createMossTool({
  name: 'image_edit',
  description: 'Edit a workspace image and save the result to a new workspace path.',
  searchHint: 'edit transform workspace image',
  inputSchema: imageEditSchema,
  event: input => ({ type: 'image_edit', input }),
  userFacingName: '图片编辑',
})

export const MossTools = [
  BrowserOpenTool,
  BrowserSnapshotTool,
  BrowserClickTool,
  BrowserTypeTool,
  BrowserPressTool,
  BrowserScrollTool,
  BrowserWaitTool,
  BrowserReloadTool,
  AppBuildTool,
  AppPreviewTool,
  AppPublishTool,
  AppLaunchTool,
  AppUpdateTool,
  AppExtractToWorkspaceTool,
  AppGetVersionsTool,
  ConnectorCliSetupTool,
  ConnectorMcpAuthenticateTool,
  ImageGenerateTool,
  ImageEditTool,
] as const
