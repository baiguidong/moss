import { describe, expect, it } from 'bun:test'
import { appToolName } from '../../../packages/app-runtime/src/index.mjs'
import {
  getEmptyToolPermissionContext,
  type MossAppEvent,
  type ToolPermissionContext,
  type ToolUseContext,
} from '../../Tool.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import { toolToAPISchema } from '../../utils/api.js'
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

  it('sends the declared schema unchanged, including nested constraints and keyword-named fields', async () => {
    const declaredSchema = {
      type: 'object',
      properties: {
        query: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        mode: { type: 'string', enum: ['exact', 'prefix'] },
        filter: {
          type: 'object',
          properties: { not: { type: 'string' }, kind: { const: 'name' } },
          additionalProperties: false,
        },
      },
      required: ['query', 'mode'],
      additionalProperties: false,
    }
    const originalSchema = structuredClone(declaredSchema)
    const tool = createAppContributionTool({
      ...descriptor(),
      inputSchemaDocument: declaredSchema,
    })
    const rendered = await toolToAPISchema(tool, {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      tools: [tool],
      agents: [],
    })

    expect(tool.inputJSONSchema).toBe(declaredSchema)
    expect(rendered.input_schema).toBe(declaredSchema)
    expect(declaredSchema).toEqual(originalSchema)

    const context = contextWith(async () => ({ ok: true, result: null }))
    for (const input of [
      { query: null, mode: 'exact' },
      { query: 'moss', mode: 'prefix', filter: { not: 'exclude', kind: 'name' } },
    ]) {
      expect(await tool.validateInput?.(input, context)).toMatchObject({ result: true })
    }
    for (const input of [
      {},
      { query: 42, mode: 'exact' },
      { query: '', mode: 'exact' },
      { query: 'moss', mode: 'invalid' },
      { query: 'moss', mode: 'exact', filter: { kind: 'invalid' } },
    ]) {
      expect(await tool.validateInput?.(input, context)).toMatchObject({ result: false })
    }
  })

  it.each([
    ['oneOf', [{ properties: { query: { const: 'moss' } } }]],
    ['anyOf', [{ properties: { query: { const: 'moss' } } }]],
    ['allOf', [{ properties: { query: { const: 'moss' } } }]],
    ['enum', [{ query: 'moss' }]],
    ['const', { query: 'moss' }],
    ['not', { properties: { query: { const: 'invalid' } } }],
  ] as const)('rejects top-level %s at registration instead of rewriting the schema', (keyword, constraint) => {
    const declaredSchema = { ...descriptor().inputSchemaDocument, [keyword]: constraint }
    const originalSchema = structuredClone(declaredSchema)
    expect(() => createAppContributionTool({ ...descriptor(), inputSchemaDocument: declaredSchema }))
      .toThrow(`App Tool example.catalog/search input schema must not declare top-level ${keyword}`)
    expect(declaredSchema).toEqual(originalSchema)
  })

  it('rejects schemas with arguments defined only inside a root combinator', () => {
    expect(() => createAppContributionTool({
      ...descriptor(),
      inputSchemaDocument: {
        type: 'object',
        allOf: [{
          properties: { query: { type: 'string' } },
          required: ['query'],
        }],
      },
    })).toThrow(/must not declare top-level allOf/)
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

  it.each([
    ['normalization', ['example-a', 'example.a']],
    ['truncation', [`example.${'a'.repeat(70)}b`, `example.${'a'.repeat(70)}c`]],
  ] as const)('rejects tool name collisions caused by %s', (_reason, appIds) => {
    const descriptors = appIds.map(appId => ({
      ...descriptor(),
      id: `${appId}/search`,
      appId,
      name: appToolName(appId, 'search'),
    }))
    expect(() => createAppContributionTools(descriptors)).toThrow(
      `Duplicate App Tool name: ${descriptors[0]!.name}`,
    )
  })

  it('requests destructive confirmation through the Host permission pipeline without persistent allow suggestions', async () => {
    const tool = createAppContributionTool({
      ...descriptor('destructive'),
      id: 'example.catalog/delete',
      name: 'app__example_catalog__delete',
      title: 'Delete Catalog Entry',
    })
    const decide = (overrides: Partial<ToolPermissionContext> = {}) => {
      const toolPermissionContext = { ...getEmptyToolPermissionContext(), ...overrides }
      const context = {
        ...contextWith(async () => { throw new Error('Permission checking must not invoke the App') }),
        getAppState: () => ({ toolPermissionContext }),
      } as ToolUseContext
      return hasPermissionsToUseTool(tool, { query: 'entry' }, context, undefined as never, 'app-delete-permission')
    }
    for (const mode of ['default', 'acceptEdits', 'plan'] as const) {
      const result = await decide({ mode })
      expect(result.behavior).toBe('ask')
      expect(result).toMatchObject({ message: expect.stringContaining('Delete Catalog Entry') })
      expect('suggestions' in result).toBe(false)
    }
    expect((await decide({ mode: 'dontAsk' })).behavior).toBe('deny')
    expect((await decide({ mode: 'bypassPermissions' })).behavior).toBe('allow')
    expect((await decide({ mode: 'bypassPermissions', alwaysAskRules: { session: [tool.name] } })).behavior).toBe('ask')
    expect((await decide({ alwaysDenyRules: { session: [tool.name] } })).behavior).toBe('deny')
  })
})
