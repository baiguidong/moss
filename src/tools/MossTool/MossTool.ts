import { z } from 'zod/v4'
import { buildTool, getGlobalAppEventBridge, type ToolDef } from '../../Tool.js'
import type { MossAppEvent, MossAppEventResult, ToolUseContext } from '../../Tool.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const MOSS_TOOL_NAME = 'moss'

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

const mossActionSchema = z.strictObject({
  action: z.enum(['app_build', 'app_preview', 'app_publish', 'app_launch', 'app_update', 'app_extract_to_workspace', 'app_get_versions', 'browser_open', 'image_generate', 'image_edit']),
  kind: z.literal('plugin-app').optional().describe('App kind. Only plugin-app is supported.'),
  name: z.string().optional().describe('App slug/name. Required for app_build, app_publish, app_launch, app_update, app_extract_to_workspace, and app_get_versions.'),
  title: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  resizable: z.boolean().optional(),
  prd: z.string().optional(),
  versionId: z.string().optional(),
  buildDir: z.string().optional().describe('Path to an App build directory, usually apps/{name}/build. Used by app_preview, app_publish, and app_update.'),
  version: z.string().optional(),
  reason: z.string().optional(),
  prompt: z.string().optional().describe('Prompt for image generation. Required for image_generate.'),
  url: z.string().optional().describe('URL to open in the Moss right-side browser. For browser_open, provide either url or query.'),
  query: z.string().optional().describe('Search query to open in the Moss right-side browser. For browser_open, provide either url or query.'),
  engine: z.enum(['baidu', 'google', 'bing']).optional().describe('Search engine used when browser_open receives query. Defaults to baidu for Chinese search requests.'),
  aspect_ratio: imageAspectRatioSchema.optional().describe('Aspect ratio for generated images. Optional for image_generate; defaults in the main process if omitted.'),
  subject_reference: z.array(subjectReferenceSchema).optional().describe('Reference images for image generation. Optional for image_generate.'),
  source_path: z.string().optional().describe('Relative source image path inside the current session workspace. Required for image_edit.'),
  out_path: z.string().optional().describe('Relative output path inside the current session workspace for image output. Required for image_generate and image_edit.'),
})

type MossActionInput = z.infer<typeof mossActionSchema>

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
  error: z.string().optional(),
})

type MossOutput = z.infer<typeof mossOutputSchema>

export const MossTool = buildTool({
  name: MOSS_TOOL_NAME,
  searchHint: 'Moss desktop app management (save, launch, update, versions)',
  maxResultSizeChars: 100_000,
  async description() {
    return `Moss tool for managing desktop apps. Supports:
- app_build: Build an App from apps/{name}/app.moss.json in the current session workspace. Returns buildDir.
- app_preview: Preview an App build directory
- app_publish: Publish an App build directory to the app list with version. Requires name, buildDir, and description.
- app_launch: Open an installed app
- app_update: Publish a new App version from buildDir.
- app_extract_to_workspace: Extract an installed App into the current session workspace.
- app_get_versions: Get version history of an app
- browser_open: Open a URL or search query in the Moss right-side browser panel for the current desktop session and bring that panel into view. Use this when the user asks to open a browser, open a webpage, or search/query something in a browser, for example "打开浏览器，百度查询 今日新闻".
- image_generate: Generate one or more images via the main-process image handler and write them into the current session workspace
- image_edit: Edit a workspace image via the main-process image handler and write the result into the current session workspace`
  },
  async prompt() {
    return `Use moss tool to manage desktop apps.

Parameter requirements:
- app_build requires \`name\`; it builds from apps/{name}/app.moss.json in the current workspace and does not accept html
- app_preview requires \`buildDir\`
- app_publish requires \`name\`, \`buildDir\`, and \`description\`
- app_launch requires \`name\`
- app_update requires \`name\` and \`buildDir\`; \`reason\` is recommended
- app_extract_to_workspace requires \`name\`
- app_get_versions requires \`name\`
- browser_open requires either \`url\` or \`query\`; use \`query\` plus \`engine: "baidu"\` when the user says 百度查询/百度搜索 or asks in Chinese without naming another engine
- When browser_open returns \`ok: true\`, treat the URL/query as delivered to the Moss desktop browser panel. Do not call browser_open again for the same URL just because the user says they cannot see it; instead explain that the browser panel should be visible on the right and give the exact URL/path to check.
- In Docker or remote sessions, do not start a container-local HTTP server and open \`http://localhost:PORT\` unless that port is known to be published to the desktop host. Prefer opening the existing file URL or a host-reachable URL.
- image_generate requires \`prompt\` and \`out_path\`; \`out_path\` must be a relative path inside the current session workspace, for example \`images/hero.png\`; optionally accepts \`aspect_ratio\` and \`subject_reference\`
- image_edit requires \`prompt\`, \`source_path\`, and \`out_path\`; both paths must be relative paths inside the current session workspace
- image_generate and image_edit return image-specific fields including \`fileKind: "image"\`, \`previewUrl\`, and \`previewMarkdown\`
- After image generation or editing succeeds, if you reference the image in markdown, prefer \`previewMarkdown\` or use \`moss-media://local/<encoded-absolute-path>\` directly`
  },
  get inputSchema() {
    return mossActionSchema
  },
  get outputSchema() {
    return mossOutputSchema
  },
  userFacingName() {
    return 'Moss'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input: MossActionInput) {
    return input.action === 'app_launch' || input.action === 'app_get_versions' || input.action === 'app_preview' || input.action === 'browser_open'
  },
  async call(input: MossActionInput, context: ToolUseContext): Promise<{ data: MossOutput }> {
    const emitAppEvent = context.emitAppEvent ?? getGlobalAppEventBridge()

    // Check if emitAppEvent is available
    if (!emitAppEvent) {
      const querySource = context.options.querySource ?? 'unknown'
      const agentId = context.agentId ?? 'main'
      return {
        data: {
          ok: false,
          error: `MossTool is not available in this context. Missing emitAppEvent bridge. querySource=${querySource} agentId=${agentId}`,
        },
      }
    }

    // Build the event based on action
    let event: MossAppEvent

    switch (input.action) {
      case 'app_build':
        if (!input.name) {
          return { data: { ok: false, error: 'name is required for app_build' } }
        }
        event = {
          type: 'app_build',
          input: {
            kind: 'plugin-app',
            name: input.name,
          },
        }
        break

      case 'app_preview':
        if (!input.buildDir) {
          return { data: { ok: false, error: 'buildDir is required for app_preview' } }
        }
        event = {
          type: 'app_preview',
          input: { kind: 'plugin-app', buildDir: input.buildDir },
        }
        break

      case 'app_publish':
        if (!input.name) {
          return { data: { ok: false, error: 'name is required for app_publish. Pass the target app slug/name in the name field.' } }
        }
        if (!input.buildDir) {
          return { data: { ok: false, error: 'buildDir is required for app_publish' } }
        }
        if (!input.description) {
          return { data: { ok: false, error: 'description is required for app_publish. Pass the published app description in the description field.' } }
        }
        event = {
          type: 'app_publish',
          input: {
            kind: 'plugin-app',
            name: input.name,
            buildDir: input.buildDir,
            description: input.description,
            reason: input.reason,
          },
        }
        break

      case 'app_launch':
        if (!input.name) {
          return { data: { ok: false, error: 'name is required for app_launch' } }
        }
        event = {
          type: 'app_launch',
          input: { name: input.name },
        }
        break

      case 'app_update':
        if (!input.name) {
          return { data: { ok: false, error: 'name is required for app_update' } }
        }
        if (!input.buildDir) {
          return { data: { ok: false, error: 'buildDir is required for app_update' } }
        }
        event = {
          type: 'app_update',
          input: {
            kind: 'plugin-app',
            name: input.name,
            description: input.description,
            buildDir: input.buildDir,
            reason: input.reason,
          },
        }
        break

      case 'app_extract_to_workspace':
        if (!input.name) {
          return { data: { ok: false, error: 'name is required for app_extract_to_workspace' } }
        }
        event = {
          type: 'app_extract_to_workspace',
          input: {
            kind: input.kind,
            name: input.name,
            versionId: input.versionId,
          },
        }
        break

      case 'app_get_versions':
        if (!input.name) {
          return { data: { ok: false, error: 'name is required for app_get_versions' } }
        }
        event = {
          type: 'app_get_versions',
          input: { name: input.name },
        }
        break

      case 'browser_open':
        if (!input.url && !input.query) {
          return { data: { ok: false, error: 'url or query is required for browser_open' } }
        }
        event = {
          type: 'browser_open',
          input: {
            url: input.url,
            query: input.query,
            engine: input.engine,
          },
        }
        break

      case 'image_generate':
        if (!input.prompt) {
          return { data: { ok: false, error: 'prompt is required for image_generate' } }
        }
        if (!input.out_path) {
          return { data: { ok: false, error: 'out_path is required for image_generate' } }
        }
        event = {
          type: 'image_generate',
          input: {
            prompt: input.prompt,
            aspect_ratio: input.aspect_ratio,
            subject_reference: input.subject_reference,
            out_path: input.out_path,
          },
        }
        break

      case 'image_edit':
        if (!input.prompt) {
          return { data: { ok: false, error: 'prompt is required for image_edit' } }
        }
        if (!input.source_path) {
          return { data: { ok: false, error: 'source_path is required for image_edit' } }
        }
        if (!input.out_path) {
          return { data: { ok: false, error: 'out_path is required for image_edit' } }
        }
        event = {
          type: 'image_edit',
          input: {
            prompt: input.prompt,
            source_path: input.source_path,
            aspect_ratio: input.aspect_ratio,
            out_path: input.out_path,
          },
        }
        break

      default:
        return { data: { ok: false, error: `Unknown action: ${input.action}` } }
    }

    // Emit event and wait for result (blocking)
    const result: MossAppEventResult = await emitAppEvent(event)

    if (result.ok) {
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
        },
      }
    } else {
      return {
        data: {
          ok: false,
          error: result.error,
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: MossOutput, toolUseID: string) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: jsonStringify(content),
    }
  },
} satisfies ToolDef<typeof mossActionSchema, MossOutput>)
