import { describe, expect, it } from 'bun:test'
import type { MossAppEvent, ToolUseContext } from '../../Tool.js'
import {
  createAppContributionTool,
  createAppContributionTools,
  type AppToolContributionDescriptor,
} from './AppContributionTool.js'

function descriptor(
  effect: AppToolContributionDescriptor['effect'] = 'read',
): AppToolContributionDescriptor {
  return {
    id: 'example.catalog/search',
    name: 'app__example_catalog__search',
    title: 'Search Catalog',
    description: 'Search the example catalog.',
    appId: 'example.catalog',
    appDisplayName: 'Example Catalog',
    effect,
    inputSchemaDocument: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    },
  }
}

function contextWith(
  handler: (event: MossAppEvent) => Promise<any>,
): ToolUseContext {
  return {
    emitAppEvent: handler,
    toolUseId: 'tool-use-1',
    abortController: new AbortController(),
  } as unknown as ToolUseContext
}

describe('App Contribution Tool', () => {
  it('uses the declared JSON schema and invokes the qualified contribution', async () => {
    let emitted: MossAppEvent | null = null
    const context = contextWith(async (event) => {
      emitted = event
      return { ok: true, result: { matches: 2 } }
    })
    const tool = createAppContributionTool(descriptor())

    expect(tool.inputJSONSchema).toEqual(descriptor().inputSchemaDocument)
    expect(tool.isReadOnly({ query: 'moss' })).toBe(true)
    expect(tool.isConcurrencySafe({ query: 'moss' })).toBe(true)
    expect(await tool.validateInput?.({ query: '' }, context)).toMatchObject({ result: false })
    expect(await tool.call({ query: 'moss' }, context, null as never, null as never))
      .toEqual({ data: { matches: 2 } })
    expect(emitted).toMatchObject({
      type: 'app_tool_invoke',
      input: {
        contributionId: 'example.catalog/search',
        input: { query: 'moss' },
        requestId: 'tool:tool-use-1',
      },
    })
    expect((emitted as Extract<MossAppEvent, { type: 'app_tool_invoke' }>).signal)
      .toBe(context.abortController.signal)
  })

  it('maps write and destructive effects into the Core permission policy', async () => {
    const context = contextWith(async () => ({ ok: true, result: null }))
    const writeTool = createAppContributionTool(descriptor('write'))
    const destructiveTool = createAppContributionTool({
      ...descriptor('destructive'),
      id: 'example.catalog/delete',
      name: 'app__example_catalog__delete',
      title: 'Delete Catalog Entry',
    })

    expect(writeTool.isReadOnly({ query: 'moss' })).toBe(false)
    expect(writeTool.isDestructive?.({ query: 'moss' })).toBe(false)
    expect(await writeTool.checkPermissions({ query: 'moss' }, context)).toMatchObject({
      behavior: 'ask',
      suggestions: [{ rules: [{ toolName: writeTool.name }] }],
    })
    expect(destructiveTool.isDestructive?.({ query: 'moss' })).toBe(true)
    expect(await destructiveTool.checkPermissions({ query: 'moss' }, context)).toMatchObject({
      behavior: 'ask',
    })
  })

  it('rejects invalid descriptors and duplicate generated names', () => {
    expect(() => createAppContributionTool({
      ...descriptor(),
      inputSchemaDocument: { type: 'array' },
    })).toThrow(/must describe an object/)
    expect(() => createAppContributionTools([descriptor(), {
      ...descriptor(),
      id: 'another.app/search',
    }])).toThrow(/Duplicate App Tool name/)
  })
})
