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
import { filterToolsForAgent } from '../AgentTool/agentToolUtils.js'
import { applyCoordinatorToolFilter } from '../../utils/toolPool.js'
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
    name: 'search',
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
  it('preserves native image/error results and full instructions through the generic tool', async () => {
    const tool = createAppContributionTool({ ...descriptor('write'), instructionsText: 'Full observation instructions', hostPermissionManaged: true })
    expect(await tool.prompt({} as any)).toContain('Full observation instructions')
    expect(await tool.checkPermissions!({ query: 'test' } as any, {} as any)).toMatchObject({ behavior: 'allow' })
    expect(tool.isReadOnly({} as any)).toBe(false)
    expect(applyCoordinatorToolFilter([tool])).toEqual([tool])
    expect(filterToolsForAgent({tools:[tool],isBuiltIn:true})).toEqual([])
    const output = tool.mapToolResultToToolResultBlockParam({ format:'moss.tool-result/v1', isError:true,
      content:[{type:'text',text:'Observe again'}, {type:'image',mimeType:'image/png',data:'base64'}] }, 'native-1')
    expect(output).toMatchObject({ is_error:true, content:[{type:'text',text:'Observe again'}, {type:'image',source:{type:'base64',media_type:'image/png',data:'base64'}}] })
    let called = false
    await expect(tool.call({query:'test'}, {agentId:'worker', emitAppEvent:() => { called = true }} as any, null as any, null as any)).rejects.toThrow('main session')
    expect(called).toBe(false)
  })
  it('checks the exact build command through the ordinary Agent permission callback and rejects substitutions', async () => {
    const tool = createAppContributionTool(descriptor('write'))
    let authorize: ((command: string) => Promise<void>) | undefined
    const context = contextWith(async event => {
      if (event.type === 'app_tool_invoke') authorize = event.authorizeCommand
      return { ok: true, result: {} }
    })
    const parent = { type: 'assistant', message: { content: [] } } as any
    const decisions: unknown[] = []
    const policy = async (commandTool: any, input: any, source: any, message: any) => {
      decisions.push({ name: commandTool.name, input, source, message })
      return { behavior: 'allow', updatedInput: input } as const
    }
    await tool.call({ query: 'build' }, context, policy as any, parent)
    await authorize!("cd '/workspace/app' && npm run build")
    expect(decisions).toMatchObject([{ name: 'Bash', input: { command: "cd '/workspace/app' && npm run build" }, source: context, message: parent }])
    await tool.call({ query: 'build' }, context, (async () => ({ behavior: 'deny' })) as any, parent)
    await expect(authorize!('npm run build')).rejects.toThrow('denied')
    await tool.call({ query: 'build' }, context, (async () => ({ behavior: 'allow', updatedInput: { command: 'different' } })) as any, parent)
    await expect(authorize!('npm run build')).rejects.toThrow('changed')
    await tool.call({ query: 'build' }, context, null as any, parent)
    await expect(authorize!('npm run build')).rejects.toThrow('unavailable')
  })
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
      name: 'delete',
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

  it('prefixes external App names in the API and retains internal routing without aliases', async () => {
    const tool = createAppContributionTool({ ...descriptor(), name: appToolName('example.catalog', 'search') })
    expect(tool.name).toBe('catalog_search')
    expect(tool.aliases).toBeUndefined()
    expect(tool.appInfo).toMatchObject({ appId: 'example.catalog', contributionId: 'example.catalog/search' })
    const schema = await toolToAPISchema(tool, { tools: [tool], agents: [], getToolPermissionContext: async () => getEmptyToolPermissionContext() })
    expect(schema.name).toBe('catalog_search')
    expect(createAppContributionTools([descriptor(), descriptor()])).toHaveLength(1)
  })

  it('separates Apps with the same local tool name and rejects normalized collisions', () => {
    const separate = ['example.one', 'example.two'].map(appId => ({ ...descriptor(), appId, id: `${appId}/search`, name: appToolName(appId, 'search') }))
    expect(createAppContributionTools(separate).map(tool => tool.name)).toEqual(['one_search', 'two_search'])
    for (const ids of [['example.one/search.data', 'example.one/search_data'], ['example.one/search', 'another.one/search']]) {
      const descriptors = ids.map(id => {
        const [appId, localId] = id.split('/')
        return { ...descriptor(), id, appId: appId!, name: appToolName(appId!, localId!) }
      })
      expect(() => createAppContributionTools(descriptors)).toThrow('Duplicate App Tool name')
    }
    expect(appToolName('example.' + 'a'.repeat(80), 'visualize_create')).toHaveLength(64)
    expect(appToolName('moss.visualize', 'visualize_create')).toBe('visualize_create')
  })

  it('requests destructive confirmation through the Host permission pipeline without persistent allow suggestions', async () => {
    const tool = createAppContributionTool({
      ...descriptor('destructive'),
      id: 'example.catalog/delete',
      name: 'delete',
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
