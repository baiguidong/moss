import { parseAppServiceKey } from '../../../packages/app-sdk/src/tool-services.mjs'
import { APP_ERROR_CODES } from '../../../packages/app-sdk/src/errors.mjs'
// App-owned resources can prepare an ordinary composer without creating a session.
// The Host supplies identity/workspace; Apps supply bounded display and prompt data.
export function createAppComposer({ getRuntime, getSession }) {
  function source({ sessionId, workspace } = {}) {
    const record = sessionId ? getSession(sessionId) : null
    if (record?.agentMode === 'remote-direct') throw new Error('App 资源需要本地普通会话')
    return { surface: 'app', origin: 'composer', ...(record ? { sessionId: record.id } : {}), workspace: record?.workspace || workspace || undefined }
  }
  async function invoke(provider, action, input, invocation) {
    const runtime = getRuntime()
    const instance = runtime.resolveContributionInstance(provider.appId)
    return runtime.invoke(provider.appId, instance.id, action, input, { invocation })
  }
  async function listProvider(provider, input, invocation) {
    // Listing resources is read-only. Wait behind lifecycle changes already in
    // progress, then resolve the current provider/action and instance. Do not
    // hold the lifecycle queue while the Backend handles the list request.
    for (let attempt = 0; attempt < 2; attempt++) {
      const runtime = getRuntime()
      await runtime.transitionApp?.(provider.appId, () => {})
      const { resourceProviders } = await runtime.listContributions({ appId: provider.appId, kinds: ['resourceProviders'] })
      const current = resourceProviders.find(item => item.id === provider.id && item.appId === provider.appId && item.listAction)
      if (!current) return null // The App/provider may have been disabled or removed.
      try {
        const instance = runtime.resolveContributionInstance(current.appId)
        const result = await runtime.invoke(current.appId, instance.id, current.listAction, input, { invocation })
        return { provider: current, result }
      } catch (error) {
        // A restart can begin after the wait above. Retry this read once, while
        // retaining stale-generation rejection for all ordinary action calls.
        if (error?.code !== APP_ERROR_CODES.staleGeneration || attempt > 0) throw error
      }
    }
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
      const items = [], listedProviders = []
      for (const provider of providers) {
        const page = await listProvider(provider, { query: text(options.query), offset: Math.max(0, Math.trunc(options.offset || 0)), limit: 20 }, invocation)
        if (!page) continue
        const { provider: current, result } = page
        listedProviders.push({ id: current.id, title: current.title || current.appDisplayName })
        for (const item of (Array.isArray(result) ? result : result.items || []).slice(0, 20)) {
          if (!item.ref || JSON.stringify(item.ref).length > 4096) continue
          items.push({ providerId: current.id, appId: current.appId, title: text(item.title), description: text(item.description), ref: item.ref, route: route(item.route), scope: text(item.scope), workspace: invocation.workspace })
        }
      }
      return { items, providers: listedProviders }
    },
    async resolve(context, options = {}) {
      if (!context || !['create', 'edit', 'use'].includes(context.intent) || JSON.stringify(context).length > 8192) throw new Error('App 资源选择无效')
      const runtime = getRuntime()
      const provider = await runtime.requireContribution('resourceProviders', context.providerId)
      if (!provider.listAction) throw new Error('App 未提供会话资源')
      const invocation = source(options)
      const selectedSession = options.requireSelected ? getSession(options.sessionId) : null
      const selected = selectedSession?.appIds?.includes(provider.appId) || selectedSession?.appServiceIds?.some(id => parseAppServiceKey(id)?.appId === provider.appId)
      if (options.requireSelected && provider.toolScope !== 'global' && !selected) throw new Error('请先把资源所属 App 加入会话')
      const result = await invoke(provider, provider.resolveAction, { intent: context.intent, ...(context.ref ? { ref: context.ref } : {}) }, invocation)
      if (!result || typeof result.instruction !== 'string' || result.instruction.length > 32000) throw new Error('App 会话上下文无效')
      const contributions = await runtime.listContributions({ appId: provider.appId, kinds: ['tools'] })
      const tools = contributions.tools.filter(t => (result.tools || []).includes(t.localId)).map(t => t.name)
      if (!tools.length) throw new Error('App 工具不可用，请检查 App 是否已启用')
      return { title: text(result.title), prompt: text(result.prompt, 4000), instruction: result.instruction, ref: result.ref, route: route(result.route), workspace: invocation.workspace, tools }
    },
  }
}
