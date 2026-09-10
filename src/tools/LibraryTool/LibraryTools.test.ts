import { describe, expect, test } from 'bun:test'
import type { MossAppEvent, ToolUseContext } from '../../Tool.js'
import {
  LibraryListTool,
  LibraryReadTool,
  LibrarySearchTool,
  LibraryTools,
  LibraryWriteTool,
} from './LibraryTools.js'

function contextWith(
  handler: (event: MossAppEvent) => Promise<{ ok: true; [key: string]: unknown }>,
): ToolUseContext {
  return {
    emitAppEvent: handler,
  } as unknown as ToolUseContext
}

describe('Moss Library native tools', () => {
  test('exposes four first-party in-process tools with an explicit write boundary', async () => {
    expect(LibraryTools.map(tool => tool.name)).toEqual([
      'library_list',
      'library_search',
      'library_read',
      'library_write',
    ])
    for (const tool of [LibraryListTool, LibrarySearchTool, LibraryReadTool]) {
      expect(tool.isMcp).not.toBe(true)
      expect(tool.isReadOnly({} as never)).toBe(true)
      expect(tool.isConcurrencySafe({} as never)).toBe(true)
    }
    expect(LibraryWriteTool.isMcp).not.toBe(true)
    expect(LibraryWriteTool.isReadOnly({} as never)).toBe(false)
    expect(LibraryWriteTool.isConcurrencySafe({} as never)).toBe(false)
    expect(await LibrarySearchTool.prompt()).toContain('retry at most twice')
    expect(await LibraryWriteTool.prompt()).toContain('only after the user has confirmed')
  })

  test('search calls the in-process host bridge and returns structured items', async () => {
    let emitted: MossAppEvent | null = null
    const result = await LibrarySearchTool.call(
      { query: 'shareone', mode: 'all', limit: 5 },
      contextWith(async event => {
        emitted = event
        return { ok: true, items: [{ title: 'ShareOne' }] }
      }),
    )

    expect(emitted).toEqual({
      type: 'library_search',
      input: { query: 'shareone', mode: 'all', limit: 5 },
    })
    expect(result.data).toEqual({ ok: true, items: [{ title: 'ShareOne' }] })
  })

  test('list and read preserve their separate native tool contracts', async () => {
    const events: MossAppEvent[] = []
    const context = contextWith(async event => {
      events.push(event)
      return event.type === 'library_list'
        ? { ok: true, items: [{ name: 'Research' }] }
        : { ok: true, resource: { resourceId: 'resource-1', chunks: [] } }
    })

    const listed = await LibraryListTool.call({ kind: 'collections' }, context)
    const read = await LibraryReadTool.call({ resource: 'resource-1' }, context)

    expect(events).toEqual([
      { type: 'library_list', input: { kind: 'collections' } },
      { type: 'library_read', input: { resource: 'resource-1' } },
    ])
    expect(listed.data.items).toEqual([{ name: 'Research' }])
    expect(read.data.resource).toEqual({ resourceId: 'resource-1', chunks: [] })
  })

  test('returns a normal tool error when the host rejects the request', async () => {
    const result = await LibraryReadTool.call(
      { resource: 'missing-resource' },
      contextWith(async () => ({ ok: false, error: 'Library resource not found.' }) as never),
    )

    expect(result.data).toEqual({ ok: false, error: 'Library resource not found.' })
  })

  test('write sends confirmed workspace files through the app event bridge', async () => {
    let emitted: MossAppEvent | null = null
    const result = await LibraryWriteTool.call(
      {
        collection: 'personal-1',
        files: [{
          path: '工作/方案.md',
          categoryKey: 'work',
          subcategory: '客户方案',
          reason: '长期项目资料',
        }],
        sourceName: '资料整理 · 工作目录',
      },
      contextWith(async event => {
        emitted = event
        return {
          ok: true,
          libraryWrite: {
            sourceId: 'source-1',
            collectionName: '个人资料',
            written: [{ path: '工作/方案.md', copied: true }],
            failed: [],
            job: { id: 'job-1' },
          },
        }
      }),
    )

    expect(emitted).toEqual({
      type: 'library_write',
      input: {
        collection: 'personal-1',
        files: [{
          path: '工作/方案.md',
          categoryKey: 'work',
          subcategory: '客户方案',
          reason: '长期项目资料',
        }],
        sourceName: '资料整理 · 工作目录',
      },
    })
    expect(result.data).toEqual({
      ok: true,
      sourceId: 'source-1',
      collectionName: '个人资料',
      written: [{ path: '工作/方案.md', copied: true }],
      failed: [],
      jobId: 'job-1',
    })
  })
})
