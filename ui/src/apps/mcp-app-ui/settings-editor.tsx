import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import type { McpCatalog, McpConfig } from '../../../../packages/app-sdk/src/mcp/index.mjs'
import { client, request } from './client'
import { Dialog } from './dialog'

export function SettingsEditor({ title, catalog, scope, onClose, onSaved }: { title: string; catalog: McpCatalog; scope: 'session' | 'global'; onClose(): void; onSaved(): Promise<void> }) {
  const [drafts, setDrafts] = useState(() => catalog.servers.map(server => ({
    name: server.name, enabled: server.enabled, config: JSON.stringify(server.config, null, 2),
    excluded: (server.config.disabledTools || []).join('\n'),
  })))
  const [range, setRange] = useState(scope), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const update = (index: number, patch: Partial<typeof drafts[number]>) => setDrafts(current => current.map((draft, i) => i === index ? { ...draft, ...patch } : draft))
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      // Parse all drafts before sending any changes.
      const values = drafts.map(draft => {
        const config: McpConfig = JSON.parse(draft.config)
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('连接配置必须是 JSON 对象。')
        return { name: draft.name, previousName: draft.name, enabled: draft.enabled, config: { ...config, disabledTools: draft.excluded.split('\n').map(value => value.trim()).filter(Boolean) } }
      })
      setBusy(true)
      for (const value of values) await request('servers.save', value)
      if (range !== scope) await client!.host.request('moss.host/v1', 'tools.scope.set', { scope: range })
      for (const value of values) if (value.enabled) await request('servers.inspect', { name: value.name })
      await onSaved(); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <Dialog title={`${title}设置`} description="保存后自动检查服务。" onClose={onClose} busy={busy}>
    <form onSubmit={save}><div className="editor-scroll"><fieldset className="editor-body" disabled={busy}>
      <label className="field"><span>工具使用范围</span><select aria-label="工具使用范围" value={range} onChange={event => setRange(event.target.value as typeof range)}><option value="session">指定会话</option><option value="global">全局可用</option></select><small>指定会话：在对话中选择此应用后使用。全局可用：各会话均可使用，服务连接仍按会话独立。</small></label>
      {drafts.map((draft, index) => <section className="server-settings" key={draft.name}>
        {drafts.length > 1 && <h3>{draft.name}</h3>}
        <label className="enable-service"><input type="checkbox" checked={draft.enabled} onChange={event => update(index, { enabled: event.target.checked })} />启用服务</label>
        <label className="field"><span>不启用的工具</span><textarea rows={3} aria-label={`${draft.name} 不启用的工具`} spellCheck={false} value={draft.excluded} onChange={event => update(index, { excluded: event.target.value })} placeholder="每行一个工具名称，可留空" /></label>
        <details className="connection-settings"><summary>连接配置</summary><label className="field"><span>启动命令和连接参数</span><textarea rows={8} aria-label={`${draft.name} 连接配置`} autoComplete="off" spellCheck={false} value={draft.config} onChange={event => update(index, { config: event.target.value })} /><small>密钥值不会显示；已有密钥字段留空会保留原值。</small></label></details>
        {catalog.servers[index].config.type !== 'stdio' && <button type="button" className="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await request('auth.start', { name: draft.name }); await onSaved() } catch (cause) { setError(cause instanceof Error ? cause.message : '授权失败') } finally { setBusy(false) } }}>浏览器授权</button>}
      </section>)}
      {error && <p className="error-message" role="alert">{error}</p>}
    </fieldset></div><footer className="dialog-footer"><button className="button" type="button" onClick={onClose} disabled={busy}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <ArrowRight size={15} />}{busy ? '保存中' : '保存设置'}</button></footer></form>
  </Dialog>
}
