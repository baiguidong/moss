import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import type { McpCatalog } from '../../../../packages/app-sdk/src/mcp/index.mjs'
import { request } from './client'
import { Dialog } from './dialog'
import { createMcpConnectionDrafts, parseMcpConnectionDrafts } from '../../shared/mcp-connection-config'

export function SettingsEditor({ title, catalog, onClose, onSaved }: { title: string; catalog: McpCatalog; onClose(): void; onSaved(): Promise<void> }) {
  const [drafts, setDrafts] = useState(() => createMcpConnectionDrafts(catalog))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const update = (index: number, patch: Partial<typeof drafts[number]>) => setDrafts(current => current.map((draft, i) => i === index ? { ...draft, ...patch } : draft))
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      const values = parseMcpConnectionDrafts(drafts, catalog)
      setBusy(true)
      for (const value of values) await request('servers.save', value)
      await onSaved(); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <Dialog title={`${title}连接设置`} description="保存连接参数，下次使用时生效。" onClose={onClose} busy={busy}>
    <form onSubmit={save}><div className="editor-scroll"><fieldset className="editor-body" disabled={busy}>
      {drafts.map((draft, index) => <section className="server-settings" key={draft.name}>
        {drafts.length > 1 && <h3>{draft.name}</h3>}
        {draft.directories !== undefined && <label className="field"><span>{draft.executables?.length ? '公共仓库目录（可选）' : '公共目录（可选）'}</span><textarea rows={4} aria-label={`${draft.name} 公共目录`} autoComplete="off" spellCheck={false} value={draft.directories} onChange={event => update(index, { directories: event.target.value })} placeholder="~/Documents" /><small>每行一个已有{draft.executables?.length ? '仓库根' : ''}目录，最多 32 个，支持 ~/。{catalog.servers[index].config.pathBindings ? '默认使用当前会话目录；显式指定路径时可选择公共目录，不自动切换。' : catalog.servers[index].config.roots?.includeWorkspace ? '会话工作目录自动加入并优先使用；留空时仅访问当前会话目录。' : '仅访问此处配置的目录。'}这些公共目录供使用此 App 的会话共享。</small></label>}
        {draft.executables?.map(executable => <label className="field" key={executable.argument}><span>Git 程序路径（可选）</span><input aria-label={`${draft.name} Git 程序路径`} autoComplete="off" spellCheck={false} value={executable.value} onChange={event => update(index, { executables: draft.executables!.map(item => item.argument === executable.argument ? { ...item, value: event.target.value } : item) })} placeholder="留空，从 PATH 查找 git" /><small>填写可执行文件的完整路径，不附带参数。支持 ~/。</small></label>)}
        <label className="field"><span>启动命令和连接参数</span><textarea rows={8} aria-label={`${draft.name} 连接配置`} autoComplete="off" spellCheck={false} value={draft.config} onChange={event => update(index, { config: event.target.value })} /><small>密钥值不会显示；已有密钥字段留空会保留原值。</small></label>
        {catalog.servers[index].config.type !== 'stdio' && <button type="button" className="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await request('auth.start', { name: draft.name }); await onSaved() } catch (cause) { setError(cause instanceof Error ? cause.message : '授权失败') } finally { setBusy(false) } }}>浏览器授权</button>}
      </section>)}
      {error && <p className="error-message" role="alert">{error}</p>}
    </fieldset></div><footer className="dialog-footer"><button className="button" type="button" onClick={onClose} disabled={busy}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <ArrowRight size={15} />}{busy ? '保存中' : '保存设置'}</button></footer></form>
  </Dialog>
}
