import { ImageGenTool } from '../ImageTool/ImageTool.js'
import { describe, expect, test } from 'bun:test'
import type { MossAppEvent, ToolUseContext } from '../../Tool.js'
import { MOSS_RUNTIME_ADVANCED_SETTINGS_ENV } from '../../services/advancedSettings.js'
import { asSessionId } from '../../types/ids.js'
import { runWithSessionIdContext } from '../../utils/sessionIdContext.js'
import { isDeferredTool } from '../ToolSearchTool/prompt.js'
import {
  ConnectorCliSetupTool,
  MossBrowserOpenTool,
  ConnectorMcpAuthenticateTool,
  MossTools,
  MossPresentTool,
} from './MossTool.js'
import { MOSS_TOOL_GROUPS } from './toolLoading.js'

describe('split Moss host tools', () => {
  test('presentation carries immutable turn identity and preserves the structured host result', async () => {
    const emitted: MossAppEvent[] = [];
    const result = { ok: true, schema: 'moss.presentation-result/v1', items: [{ input_index: 0, artifact_id: 'artifact-a', revision: 'v1' }], presentation: { state: 'pending', target: 'right' } };
    const context = { options: {}, toolUseId: 'use-a', abortController: new AbortController(), emitAppEvent: async (event: MossAppEvent) => { emitted.push(event); return { ok: true, presentationResult: result }; } } as unknown as ToolUseContext;
    const output = await runWithSessionIdContext(asSessionId('session-a'), undefined, async () => {
      await Promise.resolve();
      return MossPresentTool.call({ items: [{ path: 'report.pdf' }] }, context);
    }, undefined, undefined, { presentationTurn: { id: 'turn-a', sessionId: 'session-a' } });
    expect(emitted[0]).toMatchObject({ type: 'present', presentationContext: { turnId: 'turn-a', sessionId: 'session-a', toolUseId: 'use-a' } });
    expect(output.data.presentationResult).toEqual(result);
    expect(JSON.parse(MossPresentTool.mapToolResultToToolResultBlockParam(output.data, 'use-a').content as string)).toEqual(result);
    expect(MossPresentTool.inputSchema.safeParse({ items: [{ path: 'a', artifact_id: 'b' }] }).success).toBe(false);
    expect(MossPresentTool.inputSchema.safeParse({ items: [{ path: 'a' }], sessionId: 'forged' }).success).toBe(false);
  });
  test('registers one named tool per action', () => {
    expect(MossTools.map(tool => tool.name)).toEqual([
      'moss_present',
      'moss_browser_open',
      'connector_cli_setup',
      'connector_mcp_authenticate',
    ])
    const mossToolNames = new Set(MossTools.map(tool => tool.name))
    expect(Object.values(MOSS_TOOL_GROUPS).flat().filter(name => mossToolNames.has(name)))
      .toEqual(MossTools.map(tool => tool.name))
  })

  test('a worker cannot present into its parent conversation', async () => {
    let calls = 0
    const context = { agentId: 'document-worker', emitAppEvent: async () => { calls++; return { ok: true } } } as unknown as ToolUseContext
    await expect(MossPresentTool.call({ items: [{ path: 'report.pdf' }] }, context)).rejects.toThrow('main conversation')
    expect(calls).toBe(0)
  })

  test('uses action-specific schemas with required fields', () => {
    expect(ImageGenTool.inputSchema.safeParse({ prompt: 'hero', transparent_background: true }).success).toBe(true)
    expect(ImageGenTool.inputSchema.safeParse({}).success).toBe(false)
    expect(MossBrowserOpenTool.inputSchema.safeParse({}).success).toBe(false)
    expect(
      MossBrowserOpenTool.inputSchema.safeParse({ url: 'https://example.com' }).success,
    ).toBe(true)
    expect(
      MossBrowserOpenTool.inputSchema.safeParse({ url: 'https://example.com', target: 'chrome' }).success,
    ).toBe(false)
    expect(ConnectorMcpAuthenticateTool.inputSchema.safeParse({}).success).toBe(false)
    expect(
      ConnectorMcpAuthenticateTool.inputSchema.safeParse({ connector_id: 'example' }).success,
    ).toBe(true)
  })

  test('uses provider-compatible top-level JSON schemas', () => {
    const unsupportedTopLevelKeywords = [
      'oneOf',
      'anyOf',
      'allOf',
      'enum',
      'const',
      'not',
    ]

    for (const tool of MossTools) {
      const schema = tool.inputJSONSchema
      if (!schema) continue
      expect(schema.type).toBe('object')
      for (const keyword of unsupportedTopLevelKeywords) {
        expect(schema).not.toHaveProperty(keyword)
      }
    }
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

    const first = await MossBrowserOpenTool.call(input, context)
    const second = await MossBrowserOpenTool.call(input, context)

    expect(first.data.ok).toBe(true)
    expect(second.data.message).toContain('already succeeded')
    expect(emitted).toEqual([{ type: 'browser_open', input }])
    await expect(MossBrowserOpenTool.call(input, context)).rejects.toThrow(
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

    const first = await MossBrowserOpenTool.call({ url: 'https://example.com' }, context)
    const second = await MossBrowserOpenTool.call({ url: 'https://example.com/' }, context)

    expect(first.data).toMatchObject({ ok: false, error: 'page load failed' })
    expect(second.data).toMatchObject({ ok: false, error: 'page load failed' })
    expect(emitted).toHaveLength(2)
    await expect(
      MossBrowserOpenTool.call({ url: 'HTTPS://EXAMPLE.COM:443/' }, context),
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

    const first = MossBrowserOpenTool.call({ url: 'https://www.baidu.com' }, context)
    const second = MossBrowserOpenTool.call({ url: 'HTTPS://WWW.BAIDU.COM:443/' }, context)
    expect(emitted).toHaveLength(1)
    finishOpen?.({ ok: true, previewUrl: 'https://www.baidu.com/' })

    await expect(first).resolves.toMatchObject({ data: { ok: true } })
    await expect(second).resolves.toMatchObject({
      data: { ok: true, message: expect.stringContaining('already succeeded') },
    })
    expect(emitted).toHaveLength(1)
  })

  test('keeps generated-image intents separate from screenshots', async () => {
    expect(await ImageGenTool.prompt()).toContain('Never replace real screenshots with generated images')
  })

  test.each(['moss_browser_open', 'browser_open'])('applies defaults and per-session loading overrides from %s', browserSettingName => {
    expect(isDeferredTool(MossBrowserOpenTool)).toBe(false)
    expect(isDeferredTool(ConnectorCliSetupTool)).toBe(true)

    runWithSessionIdContext(
      asSessionId('tool-loading-test'),
      undefined,
      () => {
        expect(isDeferredTool(MossBrowserOpenTool)).toBe(true)
        expect(isDeferredTool(ConnectorCliSetupTool)).toBe(false)
      },
      undefined,
      {
        [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
          moss_tool_loading: {
            [browserSettingName]: 'deferred',
            connector_cli_setup: 'always',
          },
        }),
      },
    )
  })
})
