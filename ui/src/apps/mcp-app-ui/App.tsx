import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Loader2, RefreshCw, Search, Settings2, Workflow, Wrench } from 'lucide-react'
import type { AppManifestV2, AppUiInfo } from '../../../../packages/app-sdk/src/index.mjs'
import type { McpCatalog } from '../../../../packages/app-sdk/src/mcp/index.mjs'
import { client, request } from './client'
import { SettingsEditor } from './settings-editor'
import { normalizeAppToolName } from '../../../../packages/app-sdk/src/tool-names.mjs'

export function App() {
  const [info, setInfo] = useState<AppUiInfo | null>(null), [manifest, setManifest] = useState<AppManifestV2 | null>(null)
  const [catalog, setCatalog] = useState<McpCatalog | null>(null), [scope, setScope] = useState<'session' | 'global'>('session')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [route, setRoute] = useState(() => location.hash)
  const management = route.startsWith('#/manage'), editor = route === '#/settings' || route === '#/manage/settings'
  const [query, setQuery] = useState(''), [unavailable, setUnavailable] = useState(false)
  const mounted = useRef(true), working = useRef(false), revision = useRef(0)
  const reload = useCallback(async () => {
    if (!client) throw new Error('请在 Moss 中打开此应用。')
    const current = ++revision.current
    const [installation, range, result] = await Promise.all([client.app.getInstallationState(), client.host.request('moss.host/v1', 'tools.scope.get', {}), request('servers.list', {})])
    if (!mounted.current || current !== revision.current) return result
    setManifest(installation?.manifest as AppManifestV2)
    setUnavailable((installation?.installation as { enabled?: boolean })?.enabled === false)
    setScope(range.scope); setCatalog(result)
    return result
  }, [])
  const operate = useCallback(async (work: () => Promise<void>) => {
    if (working.current || !mounted.current) return
    working.current = true; ++revision.current; setBusy(true); setError('')
    try { await work() } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '操作失败，请重试。') }
    finally { working.current = false; if (mounted.current) setBusy(false) }
  }, [])
  useEffect(() => {
    mounted.current = true
    void operate(async () => {
      if (!client) throw new Error('请在 Moss 中打开此应用。')
      const identity = await client.app.getInfo()
      if (!mounted.current) return
      setInfo(identity); document.title = `${identity.displayName}设置`
      await reload()
    })
    const refresh = () => { if (!working.current) void operate(async () => { await reload() }) }
    const off = client?.events.on('runtime', refresh)
    return () => { mounted.current = false; ++revision.current; off?.() }
  }, [operate, reload])
  useEffect(() => {
    const onHashChange = () => setRoute(location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  const title = info?.displayName || '正在读取应用', presentation = manifest?.mcpApp?.presentation
  const inspect = () => operate(async () => {
    const current = await reload()
    for (const server of current?.servers || []) if (server.enabled && mounted.current) {
      const result = await request('servers.inspect', { name: server.name }); if (mounted.current) setCatalog(result)
    }
  })
  const failed = error || catalog?.servers.find(server => server.enabled && server.check?.state === 'failed')?.check?.error
  const enabled = catalog?.servers.filter(server => server.enabled) || []
  const checked = enabled.length > 0 && enabled.every(server => server.check?.state === 'connected')
  const needsAuth = enabled.some(server => server.check?.state === 'needs-auth')
  const label = unavailable ? 'App 未启用' : busy ? '正在加载' : failed ? '检查失败' : !catalog ? '正在读取状态' : !enabled.length ? '服务已停用' : needsAuth ? '需要授权' : checked ? '检查通过' : '使用时连接'
  const allTools = (catalog?.servers || []).flatMap(server => (server.check?.tools || []).map(tool => ({ ...tool, name: manifest ? normalizeAppToolName(tool.name, manifest.id) : tool.name, server: server.name, disabled: server.config.disabledTools?.includes(tool.name) })))
  const tools = allTools.filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()))
  const examples = presentation?.examples || []
  const closeEditor = () => {
    location.hash = management ? '#/manage' : '#/'
  }
  return <main className="app-shell" aria-label={`${title}工作区`}><div className="service-workspace">
    <h1 className="service-title-accessible">{title}</h1>
    <section className="service-card connection-card" data-app-primary aria-label={`${title}服务状态`} aria-busy={busy}>
      <div className="connection-top" data-app-toolbar><span className={`service-status ${failed || unavailable ? 'failure' : checked ? 'ready' : ''}`} role="status">{busy ? <Loader2 size={16} className="spin" /> : failed || unavailable ? <CircleAlert size={16} /> : checked ? <Check size={16} /> : <Wrench size={16} />}{label}</span><div className="connection-actions">{management && <button className="button" onClick={() => { location.hash = '#/manage/settings' }} disabled={busy || unavailable || !catalog}><Settings2 size={15} />连接设置</button>}<button id="inspect" className="button" onClick={() => void inspect()} disabled={busy || unavailable}><RefreshCw size={15} className={busy ? 'spin' : ''} />检查服务</button></div></div>
      <h2>{management ? '连接与工具' : presentation?.headline || `在对话中使用${title}`}</h2>
      {failed && <p className="service-error" role="alert">{failed}</p>}
      {unavailable && <p className="service-error" role="alert">请在 Moss 应用管理中启用{title}并检查权限。</p>}
      <div className="service-target"><Workflow size={16} /><p>{!enabled.length && catalog ? '请在应用管理中启用此 App。' : scope === 'global' ? '各会话均可直接使用，描述你要完成的任务即可。' : `在对话中选择${title}，再描述你要完成的任务。`}</p>{checked && <small>{allTools.length} 项工具</small>}</div>
      <p className="service-note">检查服务会验证连接和工具可用性。</p>
    </section>
    {!management && <div className="service-guides"><section className="service-card"><h3>试试这些任务</h3><ul className="example-list">{(examples.length ? examples : [`使用${title}帮我完成任务`]).map(example => <li key={example}>{example}</li>)}</ul></section><section className="service-card"><h3>使用说明</h3><p>{presentation?.usage || `选择${title}后，可在对话中调用它提供的工具。`}</p><p className="service-note">在插件详情页调整工具使用范围，在连接设置中管理连接参数。</p></section></div>}
    {(checked || allTools.length > 0) && <details className="service-card service-tools" open={management || undefined}><summary><Wrench size={16} /><span>工具详情</span><small>{allTools.length} 项</small><ChevronDown size={15} /></summary><div className="service-tools-body"><div className="search-field"><Search size={15} /><input aria-label="搜索工具" placeholder="查找工具" value={query} onChange={event => setQuery(event.target.value)} /></div>{tools.map(tool => <article className="tool-row" key={`${tool.server}/${tool.name}`}><Wrench size={15} /><div><h4>{tool.name}{tool.disabled && <small className="service-note"> · 已排除</small>}</h4><p>{tool.description || '此工具未提供描述。'}</p></div></article>)}{!tools.length && <p className="service-note">{query ? '没有匹配的工具。' : '服务已连接，目前没有提供工具。'}</p>}{catalog?.servers.map(server => <p className="service-note" key={server.name}>{server.check?.serverInfo ? `${server.check.serverInfo.name} ${server.check.serverInfo.version}` : server.name}{server.check?.truncated ? ' · 当前展示部分工具' : ''}</p>)}</div></details>}
    {management && presentation?.usage && <details className="service-card"><summary>使用说明</summary><p className="service-note">{presentation.usage}</p></details>}
  </div>{editor && catalog && <SettingsEditor title={title} catalog={catalog} onClose={closeEditor} onSaved={async () => { await reload() }} />}</main>
}
