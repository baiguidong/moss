import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { imageMediaType, requestImage, supportsImageOperation } from '../../services/imageGeneration.js'
import { getCwd } from '../../utils/cwd.js'
import { checkReadPermissionForTool, checkWritePermissionForTool, matchingRuleForInput } from '../../utils/permissions/filesystem.js'
import { getSessionRuntimeContext } from '../../utils/sessionIdContext.js'

const aspectRatio = z.enum(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'])
const outputPath = z.string().min(1).describe('Output image path inside the current workspace. Use a new file path.')
const generateSchema = z.strictObject({
  prompt: z.string().min(1).describe('Description of the image to synthesize.'),
  out_path: outputPath,
  aspect_ratio: aspectRatio.optional(),
  subject_reference: z.array(z.strictObject({
    type: z.literal('character'), image_file: z.string().url(),
  })).optional().describe('Optional character reference images (MiniMax only).'),
})
const editSchema = z.strictObject({
  prompt: z.string().min(1).describe('Requested image edit.'),
  source_path: z.string().min(1).describe('Source image path inside the current workspace.'),
  out_path: outputPath,
  aspect_ratio: aspectRatio.optional(),
})
const outputSchema = z.object({
  ok: z.boolean(),
  fileKind: z.literal('image').optional(),
  filePath: z.string().optional(),
  filePaths: z.array(z.string()).optional(),
  mediaType: z.string().optional(),
  error: z.string().optional(),
})
type ImageOutput = z.infer<typeof outputSchema>
type ImageInput = z.infer<typeof generateSchema> & { source_path?: string }

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Check existing ancestors too, so a workspace symlink cannot redirect image I/O outside it. */
export async function resolveWorkspaceImagePath(input: string): Promise<string> {
  const cwd = resolve(getCwd())
  const path = resolve(cwd, input)
  const root = await realpath(cwd)
  if (!isInside(cwd, path) && !isInside(root, path)) {
    throw new Error('Image paths must be files inside the current workspace')
  }
  let ancestor = path
  while (true) {
    try {
      await lstat(ancestor)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      ancestor = dirname(ancestor)
    }
  }
  const resolved = resolve(await realpath(ancestor), relative(ancestor, path))
  if (!isInside(root, resolved)) throw new Error('Image paths must be files inside the current workspace')
  return resolved
}

async function validatePaths(input: ImageInput, context: ToolUseContext) {
  try {
    const paths: Array<[string, 'read' | 'edit']> = [[input.out_path, 'edit']]
    if (input.source_path) paths.push([input.source_path, 'read'])
    for (const [path, operation] of paths) {
      const resolved = await resolveWorkspaceImagePath(path)
      // Like Read/Write, enforce explicit path denials even if a blanket tool
      // allow rule would otherwise skip checkPermissions().
      for (const candidate of [resolve(getCwd(), path), resolved]) {
        if (matchingRuleForInput(candidate, context.getAppState().toolPermissionContext, operation, 'deny')) {
          throw new Error(`Permission to ${operation} ${path} has been denied`)
        }
      }
    }
    return { result: true as const }
  } catch (error) {
    return { result: false as const, message: (error as Error).message, errorCode: 1 }
  }
}

async function createImage(input: ImageInput, context: ToolUseContext): Promise<{ data: ImageOutput }> {
  try {
    const settings = getSessionRuntimeContext()?.image
    if (!settings) throw new Error('Image provider is not configured for this session')
    const filePath = await resolveWorkspaceImagePath(input.out_path)
    const sourcePath = input.source_path ? await resolveWorkspaceImagePath(input.source_path) : undefined
    // Avoid spending a model request on a path that would overwrite an existing file.
    try {
      await lstat(filePath)
      throw new Error('out_path already exists; choose a new image path')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const bytes = await requestImage(settings, { ...input, sourcePath }, context.abortController.signal)
    context.abortController.signal.throwIfAborted()
    await resolveWorkspaceImagePath(input.out_path)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, bytes, { flag: 'wx', signal: context.abortController.signal })
    return { data: { ok: true, fileKind: 'image', filePath, filePaths: [filePath], mediaType: imageMediaType(bytes) } }
  } catch (error) {
    if (context.abortController.signal.aborted) throw error
    return { data: { ok: false, error: (error as Error).message } }
  }
}

const common = {
  maxResultSizeChars: 10_000,
  outputSchema,
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  interruptBehavior: () => 'cancel' as const,
  renderToolUseMessage: () => null,
  getPath: (input: { out_path: string }) => resolve(getCwd(), input.out_path),
  validateInput: validatePaths,
  call: createImage,
  mapToolResultToToolResultBlockParam: (data: ImageOutput, tool_use_id: string) => ({
    type: 'tool_result' as const, tool_use_id, content: JSON.stringify(data), is_error: !data.ok,
  }),
}

export const ImageGenerateTool = buildTool({
  ...common,
  name: 'image_generate',
  searchHint: 'generate create synthetic image',
  inputSchema: generateSchema,
  isEnabled: (runtime = getSessionRuntimeContext()) => supportsImageOperation(runtime?.image),
  userFacingName: () => '图片生成',
  async description() { return 'Synthesize a new image from a prompt and save it in the current workspace.' },
  async prompt() {
    return 'Use only for synthesizing a new image. Never use this tool to recreate or approximate a browser or application screenshot. Saves directly in the current workspace. Reference the returned filePath to show the result.'
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    return checkWritePermissionForTool(ImageGenerateTool, input, context.getAppState().toolPermissionContext)
  },
})

export const ImageEditTool = buildTool({
  ...common,
  name: 'image_edit',
  searchHint: 'edit transform workspace image',
  inputSchema: editSchema,
  isEnabled: (runtime = getSessionRuntimeContext()) => supportsImageOperation(runtime?.image, true),
  userFacingName: () => '图片编辑',
  async description() { return 'Edit an existing workspace image and save the result to a new workspace path.' },
  async prompt() { return 'Edit source_path according to the prompt. Both source_path and out_path must stay inside the current workspace. Reference the returned filePath to show the result.' },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const permissions = context.getAppState().toolPermissionContext
    const read = checkReadPermissionForTool({ ...ImageEditTool, getPath: () => resolve(getCwd(), input.source_path) }, input, permissions)
    const write = checkWritePermissionForTool(ImageEditTool, input, permissions)
    if (read.behavior === 'deny') return read
    if (write.behavior !== 'allow') return write
    return read.behavior === 'allow' ? { behavior: 'allow', updatedInput: input } : read
  },
})

export const ImageTools = [ImageGenerateTool, ImageEditTool] as const
