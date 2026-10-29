import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { getEmptyToolPermissionContext, type Tool, type ToolUseContext } from '../../Tool.js'
import { asSessionId } from '../../types/ids.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { runWithSessionIdContext, type SessionRuntime } from '../../utils/sessionIdContext.js'
import { runWithSessionApiOverrides } from '../../utils/sessionApiOverrides.js'
import { normalizeToolImagesForModel } from '../../services/api/toolImageCompatibility.js'
import { imageEndpoint, resolveImageConnection } from '../../services/imageGeneration.js'
import { ImageGenTool, resolveWorkspaceImagePath } from './ImageTool.js'
import { recentImages } from './imageReferences.js'

let root: string, png: Buffer
let server: ReturnType<typeof Bun.serve>
const requests: Array<{ path: string; token: string | null; body: any; multipart: boolean }> = []
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'moss-codex-image-')))
  png = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 30, g: 100, b: 220, alpha: 0.5 } } }).png().toBuffer()
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const path = new URL(req.url).pathname
    const entry = { path, token: req.headers.get('authorization'), body: null as any, multipart: req.headers.get('content-type')?.startsWith('multipart/') || false }
    requests.push(entry)
    if (path === '/download') return new Response(new Uint8Array(png))
    if (entry.multipart) {
      const form = await req.formData()
      entry.body = { prompt: form.get('prompt'), model: form.get('model'), background: form.get('background'), images: await Promise.all(form.getAll('image[]').map(async file => Buffer.from(await (file as File).arrayBuffer()))) }
    } else entry.body = await req.json()
    const prompt = entry.body.prompt
    if (prompt === 'multipart' && !entry.multipart) return Response.json({ error: { message: 'multipart/form-data required' } }, { status: 415 })
    if (prompt === 'failure') return Response.json({ error: { message: 'provider unavailable' } }, { status: 503 })
    if (prompt === 'auth') return Response.json({ error: { message: 'invalid key ' + req.headers.get('authorization') } }, { status: 401 })
    if (prompt === 'invalid') return Response.json({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] })
    if (prompt === 'empty') return Response.json({ data: [] })
    if (prompt === 'slow') await new Promise(resolve => setTimeout(resolve, 150))
    return Response.json({ background: entry.body.background, data: [prompt === 'url' ? { url: `${server.url}download` } : { b64_json: png.toString('base64'), generation_id: 'generation-test' }] }, { headers: { 'x-request-id': 'request-test' } })
  } })
})
afterAll(async () => { server.stop(true); await rm(root, { recursive: true, force: true }) })

function context(id: string, messages: unknown[] = [], controller = new AbortController()): ToolUseContext {
  return { toolUseId: id, messages, abortController: controller,
    getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }),
    emitAppEvent: () => { throw new Error('Images must not depend on desktop-only bridges') },
  } as unknown as ToolUseContext
}
async function session<T>(id: string, fn: () => T, options: Partial<SessionRuntime> = {}): Promise<Awaited<T>> {
  const cwd = join(root, id); await mkdir(cwd, { recursive: true })
  return await runWithCwdOverride(cwd, () => runWithSessionIdContext(asSessionId(id), null, fn, undefined, undefined, {
    executionEnvironment: 'server', modelConnection: { url: `${server.url}gateway/v1`, apiKey: `${id}-main-key` },
    image: { model: '' }, ...options,
  }))
}
function invoke(input: Record<string, unknown>, ctx: ToolUseContext) {
  return ImageGenTool.call(input, ctx, undefined as never, undefined as never)
}

const imageBlock = (data: string) => ({ type: 'image', source: { type: 'base64', data, media_type: 'image/png' } })

describe('Codex image_gen port', () => {
  test('default generation uses main-session credentials, auto size/quality and returns a real image block', async () => {
    await session('generate', async () => {
      const result = await invoke({ prompt: 'cat' }, context('first'))
      expect(result.data.ok).toBe(true)
      expect(result.data.filePath).toBe(join(root, 'generate/generated_images/generate/first.png'))
      expect((await sharp(await readFile(result.data.filePath!)).metadata()).width).toBe(64)
      expect(requests.at(-1)).toMatchObject({ path: '/gateway/v1/images/generations', token: 'Bearer generate-main-key', body: { model: 'gpt-image-2', prompt: 'cat', size: 'auto', quality: 'auto', background: 'opaque' } })
      expect(requests.at(-1)?.body).not.toHaveProperty('images')
      const mapped = ImageGenTool.mapToolResultToToolResultBlockParam(result.data, 'first')
      expect((mapped.content as any[])[0].type).toBe('image')
      expect((mapped.content as any[])[1].text).not.toContain(result.data.image!.base64)
      const wire = normalizeToolImagesForModel([{ role: 'user', content: [mapped] }], 'gpt-5.5')
      expect((wire[0]!.content as any[]).at(-1).type).toBe('image')
      expect(JSON.stringify(result)).not.toContain('main-key')
    })
  })

  test('a restored history image can be edited without a user-supplied output path', async () => {
    await session('edit', async () => {
      const first = await invoke({ prompt: 'cat' }, context('first'))
      const history = JSON.parse(JSON.stringify([{ type: 'user', message: { content: [ImageGenTool.mapToolResultToToolResultBlockParam(first.data, 'first')] } }]))
      const result = await invoke({ prompt: 'blue', num_last_images_to_include: 1, transparent_background: true }, context('second', history))
      expect(result.data.ok).toBe(true)
      expect(result.data.transparentBackground).toBe(true)
      expect(requests.at(-1)?.path).toBe('/gateway/v1/images/edits')
      expect(requests.at(-1)?.body.images).toEqual([{ image_url: `data:image/png;base64,${first.data.image!.base64}` }])
      expect(requests.at(-1)?.body.background).toBe('transparent')
      expect(result.data.filePath).not.toBe(first.data.filePath)
      expect(await readFile(first.data.filePath!)).toBeDefined()
    })
  })

  test('supports five local references, preserves order and accepts permitted paths outside workspace', async () => {
    const paths = await Promise.all(Array.from({ length: 5 }, async (_, i) => { const path = join(root, `ref-${i}.png`); await writeFile(path, png); return path }))
    await session('refs', async () => {
      const result = await invoke({ prompt: 'combine', referenced_image_paths: paths }, context('five'))
      expect(result.data.ok).toBe(true)
      expect(requests.at(-1)?.body.images).toHaveLength(5)
      expect(requests.at(-1)?.body.images[4].image_url).toBe(`data:image/png;base64,${png.toString('base64')}`)
    })
  })

  test('recent image selection includes uploaded and tool images in chronological order, not text paths', () => {
    const history = [{ type: 'user', message: { content: [imageBlock('one'), { type: 'text', text: '/fake.png' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: [imageBlock('two'), imageBlock('three')] }] } }]
    expect(recentImages(history, 2)).toEqual(['two', 'three'].map(data => ({ image_url: `data:image/png;base64,${data}` })))
    expect(() => recentImages(history, 4)).toThrow('只有 3 张')
  })

  test('invalid reference combinations and legacy arguments fail before a network call', async () => {
    await session('validation', async () => {
      const before = requests.length
      for (const args of [
        { referenced_image_paths: [join(root, 'ref-0.png')], num_last_images_to_include: 1 },
        { referenced_image_paths: Array(6).fill(join(root, 'ref-0.png')) },
        { referenced_image_paths: ['relative.png'] }, { num_last_images_to_include: 0 },
        { num_last_images_to_include: 1 }, { out_path: 'result.png' },
      ]) expect((await invoke({ prompt: 'cat', ...args } as any, context('invalid'))).data.ok).toBe(false)
      expect(requests.length).toBe(before)
    })
  })

  test('concurrent sessions and scoped API overrides cannot use another session or old image credentials', async () => {
    await Promise.all(['alpha', 'beta'].map(id => session(id, () => runWithSessionApiOverrides({ mossBaseUrl: `${server.url}${id}`, mossAuthToken: `${id}-override` }, async () => {
      const result = await invoke({ prompt: id }, context(id))
      expect(result.data.ok).toBe(true)
      expect(resolveImageConnection().model).toBe(`${id}-image-model`)
      expect(requests.find(item => item.body?.prompt === id)).toMatchObject({ path: `/${id}/v1/images/generations`, token: `Bearer ${id}-override`, body: { model: `${id}-image-model` } })
    }), { image: { model: `${id}-image-model` } })))
  })

  test('explicit multipart rejection adapts once, but provider errors are never retried', async () => {
    await session('transport', async () => {
      const source = join(root, 'ref-0.png')
      const result = await invoke({ prompt: 'multipart', referenced_image_paths: [source, source] }, context('multipart'))
      expect(result.data.ok).toBe(true)
      expect(requests.at(-1)).toMatchObject({ multipart: true, body: { images: [png, png], model: 'gpt-image-2' } })
      const before = requests.length
      const failure = await invoke({ prompt: 'failure', referenced_image_paths: [source] }, context('failure'))
      expect(failure.data.error).toContain('503')
      expect(requests.length).toBe(before + 1)
    })
  })

  test('supports URL responses without forwarding the main key to downloads', async () => {
    await session('download', async () => {
      expect((await invoke({ prompt: 'url' }, context('url'))).data.ok).toBe(true)
      expect(requests.at(-1)).toMatchObject({ path: '/download', token: null })
    })
  })

  test('invalid output, provider errors and cancellation leave no artifacts', async () => {
    await session('errors', async () => {
      for (const prompt of ['invalid', 'empty', 'failure', 'auth']) {
        const result = await invoke({ prompt }, context(prompt))
        expect(result.data.ok).toBe(false)
        expect(JSON.stringify(result)).not.toContain('errors-main-key')
        await expect(readFile(join(root, 'errors/generated_images/errors', `${prompt}.png`))).rejects.toThrow()
      }
      const controller = new AbortController()
      const pending = invoke({ prompt: 'slow' }, context('cancel', [], controller))
      const timer = setTimeout(() => controller.abort(), 25)
      try { await expect(pending).rejects.toThrow() } finally { clearTimeout(timer) }
      await expect(readFile(join(root, 'errors/generated_images/errors/cancel.png'))).rejects.toThrow()
    })
  })

  test('denied paths and output symlinks fail before billing; existing artifacts are preserved', async () => {
    await session('boundaries', async () => {
      const ctx = context('denied')
      ctx.getAppState = () => ({ toolPermissionContext: { ...getEmptyToolPermissionContext(), alwaysDenyRules: { session: ['Read(**)'] } } }) as any
      const source = join(root, 'boundaries/source.png'); await writeFile(source, png)
      const input = { prompt: 'cat', referenced_image_paths: [source] }
      expect((await ImageGenTool.checkPermissions(input, ctx)).behavior).toBe('deny')
      const before = requests.length
      expect((await invoke(input, ctx)).data.ok).toBe(false)
      await mkdir(join(root, 'outside'), { recursive: true })
      await symlink(join(root, 'outside'), join(root, 'boundaries/generated_images'))
      expect((await invoke({ prompt: 'cat' }, context('escape'))).data.ok).toBe(false)
      expect(requests.length).toBe(before)
    })
    await session('overwrite', async () => {
      const ctx = context('same'), first = await invoke({ prompt: 'cat' }, ctx)
      const original = await readFile(first.data.filePath!), before = requests.length
      expect((await invoke({ prompt: 'cat' }, ctx)).data.ok).toBe(false)
      expect(requests.length).toBe(before)
      expect(await readFile(first.data.filePath!)).toEqual(original)
    })
  })

  test('catalog uses main connection with default model and endpoints retain gateway prefixes', () => {
    expect((ImageGenTool as Tool).isEnabled({ executionEnvironment: 'desktop', modelConnection: { url: 'https://gateway.test', apiKey: 'key' } })).toBe(true)
    for (const base of ['https://gateway.test/prefix', 'https://gateway.test/prefix/v1', 'https://gateway.test/prefix/v1/messages'])
      expect(imageEndpoint(base, true)).toBe('https://gateway.test/prefix/v1/images/edits')
    expect(imageEndpoint('https://chatgpt.com/backend-api/codex', false)).toBe('https://chatgpt.com/backend-api/codex/images/generations')
  })
})
