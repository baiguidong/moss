// TypeScript port of Codex 9ef9cb1d9f ext/image-generation/src/tool.rs.
// Moss adapters: filesystem permissions, Messages image blocks and workspace artifacts.
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolUseContext } from '../../Tool.js'
import { getSessionId } from '../../bootstrap/state.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { imageMediaType, MAX_IMAGE_BYTES, requestImage, resolveImageConnection, supportsImageOperation } from '../../services/imageGeneration.js'
import { getCwd } from '../../utils/cwd.js'
import { checkReadPermissionForTool, checkWritePermissionForTool, matchingRuleForInput } from '../../utils/permissions/filesystem.js'
import { getPathsForPermissionCheck } from '../../utils/fsOperations.js'
import { maybeResizeAndDownsampleImageBuffer } from '../../utils/imageResizer.js'
import { getImageProcessor } from '../FileReadTool/imageProcessor.js'
import { recentImages } from './imageReferences.js'

// Keep this contract aligned with Codex ImagegenArgs (tool.rs:87).
const inputSchema = z.strictObject({
  prompt: z.string().min(1).describe('Detailed description of the image to generate or the edit to apply.'),
  transparent_background: z.boolean().default(false).describe('Whether the output should have a transparent background. Defaults to false.'),
  referenced_image_paths: z.array(z.string().refine(isAbsolute, 'Use an absolute image path')).max(5).nullable().optional(),
  num_last_images_to_include: z.number().int().min(1).max(5).nullable().optional(),
})
type ImageInput = z.input<typeof inputSchema>
type ImageOutput = {
  ok: boolean
  status: 'completed' | 'failed'
  fileKind?: 'image'
  filePath?: string
  filePaths?: string[]
  mediaType?: 'image/png' | 'image/jpeg' | 'image/webp'
  image?: { base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' }
  transparentBackground?: boolean
  generationId?: string
  requestId?: string
  error?: string
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function resolveWorkspaceImagePath(input: string): Promise<string> {
  const cwd = resolve(getCwd()), path = resolve(cwd, input), root = await realpath(cwd)
  if (!isInside(cwd, path) && !isInside(root, path)) throw new Error('生成图片必须保存在当前工作区')
  let ancestor = path
  while (true) {
    try { await lstat(ancestor); break }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ancestor = dirname(ancestor) }
  }
  const resolved = resolve(await realpath(ancestor), relative(ancestor, path))
  if (!isInside(root, resolved)) throw new Error('生成图片目录不能通过符号链接指向工作区外')
  return resolved
}

const callIds = new WeakMap<ToolUseContext, string>()
function artifactPath(context: ToolUseContext): string {
  const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180) || 'image'
  if (!context.toolUseId && !callIds.has(context)) callIds.set(context, randomUUID())
  return resolve(getCwd(), 'generated_images', sanitize(getSessionId()), `${sanitize(context.toolUseId || callIds.get(context)!)}.png`)
}

async function validate(input: ImageInput, context: ToolUseContext) {
  const args = inputSchema.parse(input)
  if (args.referenced_image_paths?.length && args.num_last_images_to_include != null) throw new Error('referenced_image_paths 与 num_last_images_to_include 只能选择一个')
  const output = await resolveWorkspaceImagePath(artifactPath(context))
  const permissions = context.getAppState().toolPermissionContext
  const paths: Array<[string, 'read' | 'edit']> = [[output, 'edit'], ...(args.referenced_image_paths || []).map(path => [path, 'read'] as [string, 'read'])]
  for (const [path, operation] of paths) {
    for (const candidate of getPathsForPermissionCheck(path)) {
      if (matchingRuleForInput(candidate, permissions, operation, 'deny')) throw new Error(`Permission to ${operation} ${path} has been denied`)
    }
  }
  return { args, output }
}

export const ImageGenTool = buildTool({
  name: 'image_gen',
  searchHint: 'generate edit images photos illustrations transparent reference 图片生成 编辑',
  inputSchema,
  maxResultSizeChars: 10_000,
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  interruptBehavior: () => 'cancel' as const,
  isEnabled: supportsImageOperation,
  userFacingName: () => '图片生成',
  getActivityDescription: () => '正在生成图片',
  renderToolUseMessage: () => null,
  async description() { return 'Generate or edit an image in the conversation. With no references, generate a new image. With up to five absolute image paths OR the last 1–5 conversation images, edit using those references. Automatically saves and returns the image for visual inspection. Uses the main session connection and configured image model (default gpt-image-2).' },
  async prompt() { return 'Use image_gen for raster image generation and editing. Provide prompt, optional transparent_background, and at most one reference method: referenced_image_paths OR num_last_images_to_include. Never invent out_path, aspect_ratio, mask, quality or model parameters. Size and quality are automatic; describe composition in the prompt. Inspect the returned image. It is already displayed in the main conversation: do not duplicate it in your final response. Use the returned absolute path for precise follow-up edits or copy it into a project, preserving the original. Never replace real screenshots with generated images.' },
  async validateInput(input, context) {
    try { await validate(input, context); return { result: true as const } }
    catch (error) { return { result: false as const, message: (error as Error).message, errorCode: 1 } }
  },
  async checkPermissions(input: ImageInput, context): Promise<PermissionResult> {
    const args = inputSchema.parse(input)
    const permissions = context.getAppState().toolPermissionContext
    const decisions = [checkWritePermissionForTool({ ...ImageGenTool, getPath: () => artifactPath(context) }, args, permissions),
      ...(args.referenced_image_paths || []).map(path => checkReadPermissionForTool({ ...ImageGenTool, getPath: () => path }, args, permissions))]
    const denied = decisions.find(decision => decision.behavior === 'deny')
    if (denied) return denied
    const ask = decisions.find(decision => decision.behavior !== 'allow')
    return ask ? { behavior: 'ask', message: `生成图片并读取参考图：${(args.referenced_image_paths || []).join('、') || '当前会话图片'}。${ask.message || ''}` } : { behavior: 'allow', updatedInput: args }
  },
  async call(input, context) {
    try {
      const { args, output } = await validate(input, context)
      try { await lstat(output); throw new Error('本次调用的图片已经保存，请使用新的工具调用，避免覆盖原图') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const images = args.num_last_images_to_include != null ? recentImages(context.messages, args.num_last_images_to_include) : []
      for (const path of args.referenced_image_paths || []) {
        if ((await stat(path)).size > MAX_IMAGE_BYTES) throw new Error('参考图超过 32 MB')
        let bytes: Buffer = await readFile(path, { signal: context.abortController.signal })
        let mediaType: ImageOutput['mediaType']
        try { mediaType = imageMediaType(bytes) }
        catch {
          const sharp = await getImageProcessor()
          bytes = await sharp(bytes).png().toBuffer()
          mediaType = 'image/png'
        }
        if (bytes.length > MAX_IMAGE_BYTES) throw new Error('参考图超过 32 MB')
        images.push({ image_url: `data:${mediaType};base64,${bytes.toString('base64')}` })
      }
      const result = await requestImage(resolveImageConnection(), { ...args, images }, context.abortController.signal)
      // Decode and normalize once, so invalid bytes never become saved artifacts.
      const sharp = await getImageProcessor()
      const metadata = await sharp(result.bytes).metadata()
      if (metadata.width * metadata.height > 64_000_000) throw new Error('生成图片超过 6400 万像素')
      const bytes = await sharp(result.bytes).png().toBuffer()
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('生成图片超过 32 MB')
      const preview = await maybeResizeAndDownsampleImageBuffer(bytes, bytes.length, 'png')
      context.abortController.signal.throwIfAborted()
      await resolveWorkspaceImagePath(output)
      await mkdir(dirname(output), { recursive: true })
      // Publish only a complete image. An aborted write leaves no broken artifact;
      // link also refuses to overwrite a previous call's result.
      const temporary = `${output}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600, signal: context.abortController.signal })
        context.abortController.signal.throwIfAborted()
        await resolveWorkspaceImagePath(output)
        await link(temporary, output)
      } finally { await rm(temporary, { force: true }) }
      const data: ImageOutput = { ok: true, status: 'completed', fileKind: 'image', filePath: output, filePaths: [output], mediaType: 'image/png',
        image: { base64: preview.buffer.toString('base64'), mediaType: `image/${preview.mediaType}` as ImageOutput['mediaType'] & string },
        transparentBackground: result.transparentBackground, generationId: result.generationId, requestId: result.requestId }
      return { data }
    } catch (error) {
      if (context.abortController.signal.aborted) throw error
      return { data: { ok: false, status: 'failed', error: (error as Error).message } as ImageOutput }
    }
  },
  mapToolResultToToolResultBlockParam(data: ImageOutput, tool_use_id: string) {
    const { image, ...metadata } = data
    return { type: 'tool_result' as const, tool_use_id, is_error: !data.ok,
      content: image ? [
        { type: 'image' as const, source: { type: 'base64' as const, data: image.base64, media_type: image.mediaType } },
        { type: 'text' as const, text: JSON.stringify(metadata) },
      ] : JSON.stringify(metadata) }
  },
})

export const ImageTools = [ImageGenTool] as const
