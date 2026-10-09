// App-owned resources can prepare an ordinary composer without creating a session.
// The Host supplies identity/workspace; Apps supply bounded display and prompt data.
export function createAppComposer({ getRuntime, getSession }) {
  function source({ sessionId, workspace } = {}) {
    const record = sessionId ? getSession(sessionId) : null
    if (record?.agentMode === 'remote-direct') throw new Error('App 资源需要本地普通会话')
    return { surface: 'tool', ...(record ? { sessionId: record.id } : {}), workspace: record?.workspace || workspace || undefined }
  }
  async function invoke(provider, action, input, invocation) {
    const runtime = getRuntime()
    const instance = runtime.resolveContributionInstance(provider.appId)
    return runtime.invoke(provider.appId, instance.id, action, input, { invocation })
  }
  const text = (value, max = 512) => typeof value === 'string' ? value.slice(0, max) : ''
  function route(value) { return typeof value === 'string' && /^#\/[a-zA-Z0-9/_?=&.%+-]*$/.test(value) ? value : '' }
  return {
    async list(options = {}) {
      const runtime = getRuntime()
      if (!runtime) return { items: [], providers: [] }
      const invocation = source(options)
      const { resourceProviders } = await runtime.listContributions({ kinds: ['resourceProviders'] })
      const providers = resourceProviders.filter(p => p.listAction)
      const items = []
      for (const provider of providers) {
        const result = await invoke(provider, provider.listAction, { query: text(options.query), offset: Math.max(0, Math.trunc(options.offset || 0)), limit: 20 }, invocation)
        for (const item of (Array.isArray(result) ? result : result.items || []).slice(0, 20)) {
          if (!item.ref || JSON.stringify(item.ref).length > 4096) continue
          items.push({ providerId: provider.id, appId: provider.appId, title: text(item.title), description: text(item.description), ref: item.ref, route: route(item.route), scope: text(item.scope), workspace: invocation.workspace })
        }
      }
      return { items, providers: providers.map(p => ({ id: p.id, title: p.title || p.appDisplayName })) }
    },
    async resolve(context, options = {}) {
      if (!context || !['create', 'edit', 'use'].includes(context.intent) || JSON.stringify(context).length > 8192) throw new Error('App 资源选择无效')
      const runtime = getRuntime()
      const provider = await runtime.requireContribution('resourceProviders', context.providerId)
      if (!provider.listAction) throw new Error('App 未提供会话资源')
      const invocation = source(options)
      const result = await invoke(provider, provider.resolveAction, { intent: context.intent, ...(context.ref ? { ref: context.ref } : {}) }, invocation)
      if (!result || typeof result.instruction !== 'string' || result.instruction.length > 32000) throw new Error('App 会话上下文无效')
      const contributions = await runtime.listContributions({ appId: provider.appId, kinds: ['tools'] })
      const tools = contributions.tools.filter(t => (result.tools || []).includes(t.localId)).map(t => t.name)
      if (!tools.length) throw new Error('App 工具不可用，请检查 App 是否已启用')
      return { title: text(result.title), prompt: text(result.prompt, 4000), instruction: result.instruction, ref: result.ref, route: route(result.route), workspace: invocation.workspace, tools }
    },
  }
}
