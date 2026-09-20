import { describe, expect, test } from 'bun:test'
import type { MossAppEvent, ToolUseContext } from '../../Tool.js'
import { MOSS_RUNTIME_ADVANCED_SETTINGS_ENV } from '../../services/advancedSettings.js'
import { asSessionId } from '../../types/ids.js'
import { runWithSessionIdContext } from '../../utils/sessionIdContext.js'
import { isDeferredTool } from '../ToolSearchTool/prompt.js'
import {
  AppBuildTool,
  BrowserClickTool,
  BrowserOpenTool,
  BrowserSnapshotTool,
  ConnectorMcpAuthenticateTool,
  ImageGenerateTool,
  MossTools,
} from './MossTool.js'
import { MOSS_TOOL_GROUPS } from './toolLoading.js'

function contextWith(handler: (event: MossAppEvent) => Promise<any>): ToolUseContext {
  return { emitAppEvent: handler } as unknown as ToolUseContext
}

describe('split Moss host tools', () => {
  test('registers one named tool per action', () => {
    expect(MossTools.map(tool => tool.name)).toEqual([
      'browser_open',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_press',
      'browser_scroll',
      'browser_wait',
      'browser_reload',
      'app_build',
      'app_preview',
      'app_publish',
      'app_launch',
      'app_update',
      'app_extract_to_workspace',
      'app_get_versions',
      'connector_cli_setup',
      'connector_mcp_authenticate',
      'image_generate',
      'image_edit',
    ])
    const mossToolNames = new Set(MossTools.map(tool => tool.name))
    expect(Object.values(MOSS_TOOL_GROUPS).flat().filter(name => mossToolNames.has(name)))
      .toEqual(MossTools.map(tool => tool.name))
  })

  test('uses action-specific schemas with required fields', () => {
    expect(BrowserClickTool.inputSchema.safeParse({ snapshot_id: 's1', ref: 'e1' }).success).toBe(true)
    expect(BrowserClickTool.inputSchema.safeParse({ snapshot_id: 's1' }).success).toBe(false)
    expect(AppBuildTool.inputSchema.safeParse({ name: 'demo' }).success).toBe(true)
    expect(AppBuildTool.inputSchema.safeParse({ name: 'demo', action: 'app_build' }).success).toBe(false)
    expect(ImageGenerateTool.inputSchema.safeParse({ prompt: 'hero', out_path: 'hero.png' }).success).toBe(true)
    expect(ImageGenerateTool.inputSchema.safeParse({ prompt: 'hero' }).success).toBe(false)
    expect(BrowserOpenTool.inputJSONSchema?.anyOf).toEqual([
      { required: ['url'] },
      { required: ['query'] },
    ])
    expect(ConnectorMcpAuthenticateTool.inputJSONSchema?.anyOf).toEqual([
      { required: ['connector_id'] },
      { required: ['server_name'] },
    ])
  })

  test('forwards a browser snapshot and never inlines image bytes', async () => {
    let emitted: MossAppEvent | null = null
    const input = { tab_id: 'tab-1', full_page: true }
    expect((await BrowserSnapshotTool.checkPermissions(input)).behavior).toBe('ask')

    const result = await BrowserSnapshotTool.call(input, contextWith(async event => {
      emitted = event
      return {
        ok: true,
        browser: { snapshotId: 'snapshot-1', elements: [{ ref: 'e1' }] },
        fileKind: 'image',
        filePath: '/workspace/screenshots/browser.png',
        filePaths: ['/workspace/screenshots/browser.png'],
        previewUrl: 'moss-media://local/browser.png',
        previewMarkdown: '![browser screenshot](moss-media://local/browser.png)',
        imageBase64: 'cG5n',
        imageMediaType: 'image/png',
      }
    }))

    expect(emitted).toEqual({
      type: 'browser_snapshot',
      input: { tab_id: 'tab-1', full_page: true },
    })
    expect(result.data.filePath).toBe('/workspace/screenshots/browser.png')
    expect(JSON.stringify(result.data)).not.toContain('cG5n')
    const block = BrowserSnapshotTool.mapToolResultToToolResultBlockParam(result.data, 'tool-1')
    expect(typeof block.content).toBe('string')
    expect(block.content).not.toContain('cG5n')
  })

  test('deduplicates repeated browser opens and aborts a same-turn loop', async () => {
    const emitted: MossAppEvent[] = []
    const abortController = new AbortController()
    const context = {
      options: {},
      abortController,
      emitAppEvent: async (event: MossAppEvent) => {
        emitted.push(event)
        return { ok: true, previewUrl: 'https://www.baidu.com' }
      },
    } as unknown as ToolUseContext
    const input = { url: 'https://www.baidu.com' }

    const first = await BrowserOpenTool.call(input, context)
    const second = await BrowserOpenTool.call(input, context)

    expect(first.data.ok).toBe(true)
    expect(second.data.message).toContain('already succeeded')
    expect(emitted).toHaveLength(1)
    await expect(BrowserOpenTool.call(input, context)).rejects.toThrow(
      'stopped a repeated tool-call loop',
    )
    expect(abortController.signal.aborted).toBe(true)
    expect(emitted).toHaveLength(1)
  })

  test('allows one browser-open retry after a failure, then aborts the loop', async () => {
    const emitted: MossAppEvent[] = []
    const abortController = new AbortController()
    const context = {
      options: {},
      abortController,
      emitAppEvent: async (event: MossAppEvent) => {
        emitted.push(event)
        return { ok: false, error: 'page load failed' }
      },
    } as unknown as ToolUseContext

    const first = await BrowserOpenTool.call({ url: 'https://example.com' }, context)
    const second = await BrowserOpenTool.call({ url: 'https://example.com/' }, context)

    expect(first.data).toMatchObject({ ok: false, error: 'page load failed' })
    expect(second.data).toMatchObject({ ok: false, error: 'page load failed' })
    expect(emitted).toHaveLength(2)
    await expect(
      BrowserOpenTool.call({ url: 'HTTPS://EXAMPLE.COM:443/' }, context),
    ).rejects.toThrow('stopped a repeated tool-call loop')
    expect(abortController.signal.aborted).toBe(true)
    expect(emitted).toHaveLength(2)
  })

  test('coalesces concurrent identical browser opens', async () => {
    const emitted: MossAppEvent[] = []
    const abortController = new AbortController()
    let finishOpen: ((result: { ok: true; previewUrl: string }) => void) | undefined
    const openResult = new Promise<{ ok: true; previewUrl: string }>(resolve => {
      finishOpen = resolve
    })
    const context = {
      options: {},
      abortController,
      emitAppEvent: async (event: MossAppEvent) => {
        emitted.push(event)
        return openResult
      },
    } as unknown as ToolUseContext

    const first = BrowserOpenTool.call({ url: 'https://www.baidu.com' }, context)
    const second = BrowserOpenTool.call({ url: 'HTTPS://WWW.BAIDU.COM:443/' }, context)
    expect(emitted).toHaveLength(1)
    finishOpen?.({ ok: true, previewUrl: 'https://www.baidu.com/' })

    await expect(first).resolves.toMatchObject({ data: { ok: true } })
    await expect(second).resolves.toMatchObject({
      data: { ok: true, message: expect.stringContaining('already succeeded') },
    })
    expect(emitted).toHaveLength(1)
  })

  test('keeps screenshot and generated-image intents separate', async () => {
    expect(await BrowserSnapshotTool.prompt()).toContain('Never use image_generate')
    expect(await BrowserSnapshotTool.prompt()).toContain('without inlining image bytes')
    expect(await BrowserSnapshotTool.prompt()).toContain('resized/compressed')
    expect(await ImageGenerateTool.prompt()).toContain('Never use this tool to recreate or approximate')
  })

  test('applies defaults and per-session loading overrides', () => {
    expect(isDeferredTool(BrowserOpenTool)).toBe(false)
    expect(isDeferredTool(AppBuildTool)).toBe(true)

    runWithSessionIdContext(
      asSessionId('tool-loading-test'),
      undefined,
      () => {
        expect(isDeferredTool(BrowserOpenTool)).toBe(true)
        expect(isDeferredTool(AppBuildTool)).toBe(false)
      },
      undefined,
      {
        [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
          moss_tool_loading: {
            browser_open: 'deferred',
            app_build: 'always',
          },
        }),
      },
    )
  })
})
