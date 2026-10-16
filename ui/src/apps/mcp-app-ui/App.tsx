import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Loader2, RefreshCw, Search, Settings2, Workflow, Wrench } from 'lucide-react'
import type { AppManifestV2, AppUiInfo } from '../../../../packages/app-sdk/src/index.mjs'
import type { McpCatalog } from '../../../../packages/app-sdk/src/mcp/index.mjs'
import { client, request } from './client'
import { SettingsEditor } from './settings-editor'

export function App() {
  const [info, setInfo] = useState<AppUiInfo | null>(null), [manifest, setManifest] = useState<AppManifestV2 | null>(null)
  const [catalog, setCatalog] = useState<McpCatalog | null>(null), [scope, setScope] = useState<'session' | 'global'>('session')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [editor, setEditor] = useState(false)
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
      const result = await reload()
      for (const server of result?.servers || []) {
        if (!mounted.current) return
        if (server.enabled && !server.check) {
          const checked = await request('servers.inspect', { name: server.name })
          if (mounted.current) setCatalog(checked)
        }
      }
    })
    const refresh = () => { if (!working.current) void operate(async () => { await reload() }) }
    const off = client?.events.on('runtime', refresh)
    return () => { mounted.current = false; ++revision.current; off?.() }
  }, [operate, reload])
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
  const label = unavailable ? 'App 未启用' : busy ? '正在检查' : failed ? '检查失败' : !catalog ? '正在读取状态' : !enabled.length ? '服务已停用' : needsAuth ? '需要授权' : checked ? '服务可用' : '等待检查'
  const allTools = (catalog?.servers || []).flatMap(server => (server.check?.tools || []).map(tool => ({ ...tool, server: server.name })))
  const tools = allTools.filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()))
  const examples = presentation?.examples || []
  return <main className="app-shell"><div className="service-workspace">
    <header className="service-header"><h1 className="service-title-accessible">{title}</h1><button id="settings" className="button" onClick={() => setEditor(true)} disabled={!catalog || busy || unavailable}><Settings2 size={15} />连接设置</button></header>
    <section className="service-card connection-card" aria-label={`${title}服务状态`} aria-busy={busy}>
      <div className="connection-top"><span className={`service-status ${failed || unavailable ? 'failure' : checked ? 'ready' : ''}`} role="status">{busy ? <Loader2 size={16} className="spin" /> : failed || unavailable ? <CircleAlert size={16} /> : checked ? <Check size={16} /> : <Wrench size={16} />}{label}</span><button id="inspect" className="button primary" onClick={() => void inspect()} disabled={busy || unavailable}><RefreshCw size={15} className={busy ? 'spin' : ''} />检查服务</button></div>
      <h2>{presentation?.headline || `在对话中使用${title}`}</h2><p className="service-lead">{info?.description}</p>
      {failed && <p className="service-error" role="alert">{failed}</p>}
      {unavailable && <p className="service-error" role="alert">请在 Moss 应用管理中启用{title}并检查权限。</p>}
      <div className="service-target"><Workflow size={18} /><div><strong>{checked ? '已就绪，可以开始使用' : busy ? '正在连接服务并读取工具' : !enabled.length && catalog ? '请在设置中启用服务' : '检查服务后即可开始使用'}</strong><span>{scope === 'global' ? '已设为全局可用，各会话可使用此应用的工具。' : `在对话中选择${title}，再描述你要完成的任务。`}</span></div><small>{allTools.length} 项工具</small></div>
      <p className="service-note">检查服务会验证连接和工具可用性。{enabled.some(server => server.config.type === 'stdio') && '首次连接可能需要下载运行依赖。'}</p>
    </section>
    <div className="service-guides"><section className="service-card"><span className="section-kicker">开始使用</span><h3>在对话中试试这些任务</h3><ul className="example-list">{(examples.length ? examples : [`使用${title}帮我完成任务`]).map(example => <li key={example}>{example}</li>)}</ul></section><section className="service-card"><span className="section-kicker">使用范围</span><h3>{scope === 'session' ? '按需在会话中使用' : '所有会话均可使用'}</h3><p>{presentation?.usage || `选择${title}后，可在对话中调用它提供的工具。`}</p><p className="service-note">可以在设置中调整工具范围或排除工具。忙碌对话会在本轮结束后更新。</p></section></div>
    <details className="service-card service-tools"><summary><Wrench size={16} /><span>工具详情</span><small>{allTools.length} 项</small><ChevronDown size={15} /></summary><div className="service-tools-body"><div className="search-field"><Search size={15} /><input aria-label="搜索工具" placeholder="查找工具" value={query} onChange={event => setQuery(event.target.value)} /></div>{tools.map(tool => <article className="tool-row" key={`${tool.server}/${tool.name}`}><Wrench size={15} /><div><h4>{tool.name}{tool.disabled && <span className="muted-badge">已排除</span>}</h4><p>{tool.description || '此工具未提供描述。'}</p></div></article>)}{!tools.length && <p className="service-note">{query ? '没有匹配的工具。' : busy ? '正在读取工具目录…' : '服务检查完成后展示可用工具。'}</p>}{catalog?.servers.map(server => <p className="service-note" key={server.name}>{server.check?.serverInfo ? `${server.check.serverInfo.name} ${server.check.serverInfo.version}` : server.name}{server.check?.truncated ? ' · 当前展示部分工具' : ''}</p>)}</div></details>
    <footer className="service-footer">在应用管理中启用或停用{title}</footer>
  </div>{editor && catalog && <SettingsEditor title={title} catalog={catalog} scope={scope} onClose={() => setEditor(false)} onSaved={async () => { await reload() }} />}</main>
}
