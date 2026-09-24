import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { asSessionId } from '../../types/ids.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { runWithSessionIdContext, type SessionRuntime } from '../../utils/sessionIdContext.js'
import { ImageEditTool, ImageGenerateTool, resolveWorkspaceImagePath } from './ImageTool.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ze0AAAAASUVORK5CYII=', 'base64')
let root: string
let server: ReturnType<typeof Bun.serve>
const requests: Array<{ path: string; token: string | null; body?: unknown }> = []
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'moss-native-image-')))
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const path = new URL(req.url).pathname
    const entry = { path, token: req.headers.get('authorization'), body: undefined as unknown }
    requests.push(entry)
    if (path === '/download') return new Response(png)
    if (path === '/v1/images/edits') {
      const form = await req.formData()
      entry.body = { prompt: form.get('prompt'), model: form.get('model'), size: form.get('size'), image: Buffer.from(await (form.get('image') as File).arrayBuffer()) }
      return Response.json({ data: [{ url: `${server.url}download` }] })
    }
    entry.body = await req.json()
    if (path === '/error/images/generations') return Response.json({ error: { message: 'model rejected request' } }, { status: 400 })
    if (path === '/invalid/images/generations') return Response.json({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] })
    if (path === '/slow/images/generations') await new Promise(resolve => setTimeout(resolve, 150))
    return Response.json(path === '/minimax' ? { data: { image_base64: [png.toString('base64')] } } : { data: [{ b64_json: png.toString('base64') }] })
  } })
})
afterAll(async () => {
  server.stop(true)
  await rm(root, { recursive: true, force: true })
})

function context(controller = new AbortController()): ToolUseContext {
  return {
    abortController: controller,
    emitAppEvent: () => { throw new Error('Images must not use the desktop bridge') },
  } as unknown as ToolUseContext
}
async function session<T>(id: string, fn: () => T, options: Partial<SessionRuntime> = {}): Promise<Awaited<T>> {
  const cwd = join(root, id)
  await mkdir(cwd, { recursive: true })
  return await runWithCwdOverride(cwd, () => runWithSessionIdContext(asSessionId(id), null, fn, undefined, undefined, {
    executionEnvironment: 'server',
    image: { provider: 'openai', url: `${server.url}v1`, model: id, apiKey: `${id}-key` },
    ...options,
  }))
}

describe('native image tools', () => {
  test('the tool catalog can evaluate image availability without an active session', () => {
    const runtime: SessionRuntime = { executionEnvironment: 'desktop', image: { provider: 'openai', url: '', apiKey: 'catalog-key', model: 'catalog-model' } }
    expect(ImageGenerateTool.isEnabled(runtime)).toBe(true)
    expect(ImageEditTool.isEnabled(runtime)).toBe(true)
    expect(ImageGenerateTool.isEnabled()).toBe(false)
  })

  test('concurrent desktop/server sessions call their own model and write their own workspace without a bridge', async () => {
    const results = await Promise.all([
      session('desktop', () => ImageGenerateTool.call({ prompt: 'desktop', out_path: 'images/result.png', aspect_ratio: '16:9' }, context()), { executionEnvironment: 'desktop' }),
      session('server', () => ImageGenerateTool.call({ prompt: 'server', out_path: 'images/result.png' }, context())),
    ])
    for (const [i, id] of ['desktop', 'server'].entries()) {
      expect(results[i]!.data).toEqual({ ok: true, fileKind: 'image', filePath: join(root, id, 'images/result.png'), filePaths: [join(root, id, 'images/result.png')], mediaType: 'image/png' })
      expect(await readFile(results[i]!.data.filePath!)).toEqual(png)
      expect(requests.find(req => req.token === `Bearer ${id}-key`)?.body).toMatchObject({ model: id, prompt: id })
      expect(JSON.stringify(results[i])).not.toContain(`${id}-key`)
    }
  })

  test('editing uploads the source from this workspace and downloads the result without forwarding credentials', async () => {
    await session('edit', async () => {
      await writeFile(join(root, 'edit/source.png'), png)
      const result = await ImageEditTool.call({ prompt: 'make blue', source_path: 'source.png', out_path: 'edited.png', aspect_ratio: '9:16' }, context())
      expect(result.data.ok).toBe(true)
      expect(await readFile(result.data.filePath!)).toEqual(png)
      expect(requests.find(req => req.path === '/v1/images/edits')?.body).toEqual({ prompt: 'make blue', model: 'edit', size: '1024x1536', image: png })
      expect(requests.find(req => req.path === '/download')?.token).toBeNull()
    })
  })

  test('MiniMax only exposes generation; unconfigured sessions expose neither operation', async () => {
    await session('minimax', async () => {
      expect(ImageGenerateTool.isEnabled()).toBe(true)
      expect(ImageEditTool.isEnabled()).toBe(false)
      const result = await ImageGenerateTool.call({ prompt: 'cat', out_path: 'cat.png' }, context())
      expect(result.data.ok).toBe(true)
    }, { image: { provider: 'minimax', url: `${server.url}minimax`, apiKey: 'minimax-key', model: 'minimax' } })
    await session('unconfigured', () => {
      expect(ImageGenerateTool.isEnabled()).toBe(false)
      expect(ImageEditTool.isEnabled()).toBe(false)
    }, { image: undefined })
  })

  test('rejects traversal, symlink escapes and overwrites before contacting the model', async () => {
    await session('boundaries', async () => {
      await symlink(root, join(root, 'boundaries/escape'))
      await writeFile(join(root, 'boundaries/existing.png'), png)
      const before = requests.length
      for (const out_path of ['../outside.png', 'escape/outside.png', 'existing.png']) {
        const result = await ImageGenerateTool.call({ prompt: 'cat', out_path }, context())
        expect(result.data.ok).toBe(false)
      }
      const result = await ImageEditTool.call({ prompt: 'cat', source_path: '../desktop/images/result.png', out_path: 'new.png' }, context())
      expect(result.data.ok).toBe(false)
      expect(requests.length).toBe(before)
      expect(await readFile(join(root, 'boundaries/existing.png'))).toEqual(png)
    })
  })

  test('provider errors and invalid output leave no result files', async () => {
    for (const endpoint of ['error', 'invalid']) {
      await session(endpoint, async () => {
        const result = await ImageGenerateTool.call({ prompt: 'cat', out_path: 'result.png' }, context())
        expect(result.data.ok).toBe(false)
        await expect(lstat(join(root, endpoint, 'result.png'))).rejects.toThrow()
      }, { image: { provider: 'openai', url: `${server.url}${endpoint}`, apiKey: 'test', model: 'test' } })
    }
  })

  test('canonical result paths can be reused when the workspace itself is a symlink', async () => {
    await session('canonical', async () => {
      const alias = join(root, 'workspace-alias')
      await symlink(join(root, 'canonical'), alias)
      await runWithCwdOverride(alias, async () => {
        const output = await resolveWorkspaceImagePath('image.png')
        expect(output).toBe(join(root, 'canonical/image.png'))
        expect(await resolveWorkspaceImagePath(output)).toBe(output)
      })
    })
  })

  test('uses filesystem read/write permission rules for both image paths', async () => {
    await session('permissions', async () => {
      for (const rule of ['Read(**)', 'Edit(**)']) {
        const permissions = { ...getEmptyToolPermissionContext(), alwaysDenyRules: { session: [rule] } }
        const ctx = { getAppState: () => ({ toolPermissionContext: permissions }) } as ToolUseContext
        const result = await ImageEditTool.checkPermissions({ prompt: 'cat', source_path: 'source.png', out_path: 'output.png' }, ctx)
        expect(result.behavior).toBe('deny')
        expect((await ImageEditTool.validateInput({ prompt: 'cat', source_path: 'source.png', out_path: 'output.png' }, ctx)).result).toBe(false)
      }
    })
  })

  test('cancellation stops the request and does not write an output', async () => {
    await session('cancel', async () => {
      const controller = new AbortController()
      const pending = ImageGenerateTool.call({ prompt: 'cat', out_path: 'result.png' }, context(controller))
      const timer = setTimeout(() => controller.abort(), 30)
      try { await expect(pending).rejects.toThrow() } finally { clearTimeout(timer) }
      await expect(lstat(join(root, 'cancel/result.png'))).rejects.toThrow()
    }, { image: { provider: 'openai', url: `${server.url}slow`, apiKey: 'test', model: 'test' } })
  })
})
