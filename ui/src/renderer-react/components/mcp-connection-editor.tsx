import * as React from 'react';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { McpCatalog } from '../../../../packages/app-sdk/src/mcp/index.mjs';
import { createMcpConnectionForms, parseMcpConnectionForms, type McpKeyValue } from '../../shared/mcp-connection-form';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import { Button } from '@/components/ui/button';
import type { McpManagementRequest } from '@/components/mcp-management-panel';

const field = 'block min-w-0 w-full rounded-md border bg-background px-3 py-2 text-xs leading-6 outline-none focus:ring-2 focus:ring-ring';
const checkLabels = { connected: '检查通过', 'needs-auth': '需要授权', authorized: '使用时连接', unchecked: '使用时连接', failed: '连接失败' };

function KeyValueFields({ server, title, rows, saved, onChange }: {
  server: string; title: string; rows: McpKeyValue[]; saved?: Record<string, string>; onChange(rows: McpKeyValue[]): void;
}) {
  return <section aria-label={`${server} ${title}`} className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">{title}</h4><Button type="button" size="sm" variant="ghost" onClick={() => onChange([...rows, { name: '', value: '' }])}><Plus className="h-4 w-4" />添加{title}</Button></div>
    {rows.map((row, index) => <div key={index} className="flex items-start gap-2">
      <div className="grid min-w-0 flex-1 gap-2 xl:grid-cols-2">
        <input className={field} aria-label={`${server} ${title} ${index + 1} 名称`} placeholder="名称" autoComplete="off" spellCheck={false} value={row.name} onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
        <input className={field} aria-label={`${server} ${title} ${index + 1} 值`} type={/secret|password|token|authorization|api.?key/i.test(row.name) ? 'password' : 'text'} placeholder={Object.hasOwn(saved || {}, row.name) ? '已保存，留空保留' : '值'} autoComplete="off" spellCheck={false} value={row.value} onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label={`删除 ${server} ${title} ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
    </div>)}
    <p className="text-xs leading-5 text-muted-foreground">{rows.length ? '已保存的值不回显；留空保留原值，删除此行移除该项。' : `尚未设置${title}。`}</p>
  </section>;
}

/** Content for Core's shared details side panel. Opening and saving never connect. */
export function McpConnectionEditor({ catalog, request, canManage, canInspect, canAuthenticate, onClose, onSaved, onBusyChange }: {
  catalog: McpCatalog; request: McpManagementRequest; canManage: boolean; canInspect: boolean; canAuthenticate: boolean;
  onClose(): void; onSaved(catalog: McpCatalog): void; onBusyChange(busy: boolean): void;
}) {
  const [drafts, setDrafts] = React.useState(() => createMcpConnectionForms(catalog));
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [operation, setOperation] = React.useState('');
  const working = React.useRef(false), alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; onBusyChange(false); }; }, [onBusyChange]);
  const update = (index: number, patch: Partial<typeof drafts[number]>) => setDrafts(current => current.map((draft, i) => i === index ? { ...draft, ...patch } : draft));
  const operate = async (work: () => Promise<void>, label: string) => {
    if (working.current) return;
    working.current = true; setBusy(true); setOperation(label); onBusyChange(true); setError('');
    try { await work(); } catch (cause) { if (alive.current) setError(cleanIpcErrorMessage(cause)); }
    finally { working.current = false; if (alive.current) { setBusy(false); setOperation(''); onBusyChange(false); } }
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    void operate(async () => {
      const values = parseMcpConnectionForms(drafts, catalog);
      let next = catalog;
      for (const value of values) next = await request('servers.save', value);
      if (alive.current) { onSaved(next); onClose(); }
    }, 'save');
  };
  const inspect = (name: string) => void operate(async () => {
    if (parseMcpConnectionForms(drafts, catalog).some(value => value.name === name)) throw new Error('请先保存修改，再检查服务。');
    const next = await request('servers.inspect', { name });
    if (alive.current) onSaved(next);
  }, `inspect:${name}`);
  return <form onSubmit={save} aria-label="MCP 连接设置" className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <p className="mb-5 text-xs leading-5 text-muted-foreground">{canManage ? '保存连接参数，下次使用时生效。' : '授予 MCP 管理权限后可修改连接设置。'}</p>
      {error && <p role="alert" className="mb-5 break-words text-sm text-destructive">{error}</p>}
      <fieldset disabled={busy} className="min-w-0 space-y-7">
        {drafts.map((draft, index) => <section key={draft.name} className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="break-all text-sm font-medium">{draft.name}</h3><Button type="button" size="sm" variant="ghost" data-mcp-inspect disabled={!canInspect || !catalog.servers[index].enabled} onClick={() => inspect(draft.name)}>{operation === `inspect:${draft.name}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{operation === `inspect:${draft.name}` ? '正在检查' : '检查服务'}</Button></div>
          {catalog.servers[index].check && <p role="status" className={`break-words text-xs ${catalog.servers[index].check?.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{catalog.servers[index].check!.error || checkLabels[catalog.servers[index].check!.state]}</p>}
          <fieldset disabled={!canManage} className="min-w-0 space-y-4">
          <label className="block space-y-2 text-sm"><span>连接方式</span><select className={field} aria-label={`${draft.name} 连接方式`} value={draft.type} onChange={event => update(index, { type: event.target.value as typeof draft.type })}><option value="stdio">本地进程（stdio）</option><option value="http">HTTP</option><option value="sse">SSE</option></select></label>
          {draft.type === 'stdio' ? <>
            <label className="block space-y-2 text-sm"><span>启动命令</span><input className={field} aria-label={`${draft.name} 启动命令`} value={draft.command} autoComplete="off" spellCheck={false} onChange={event => update(index, { command: event.target.value })} placeholder="node、npx 或可执行文件路径" /></label>
            <section aria-label={`${draft.name} 启动参数`} className="space-y-2">
              <div className="flex items-center justify-between gap-2"><h4 className="text-sm">启动参数</h4><Button type="button" size="sm" variant="ghost" onClick={() => update(index, { args: [...draft.args, ''] })}><Plus className="h-4 w-4" />添加参数</Button></div>
              {draft.args.map((arg, position) => <div key={position} className="flex items-start gap-2"><input className={`${field} font-mono`} aria-label={`${draft.name} 参数 ${position + 1}`} value={arg} autoComplete="off" spellCheck={false} onChange={event => update(index, { args: draft.args.map((value, i) => i === position ? event.target.value : value) })} /><Button type="button" size="icon" variant="ghost" aria-label={`删除 ${draft.name} 参数 ${position + 1}`} onClick={() => update(index, { args: draft.args.filter((_, i) => i !== position) })}><Trash2 className="h-4 w-4" /></Button></div>)}
            </section>
            <KeyValueFields server={draft.name} title="环境变量" rows={draft.env} saved={catalog.servers[index].config.env} onChange={env => update(index, { env })} />
          </> : <>
            <label className="block space-y-2 text-sm"><span>服务地址</span><input className={field} aria-label={`${draft.name} 服务地址`} value={draft.url} autoComplete="off" spellCheck={false} onChange={event => update(index, { url: event.target.value })} placeholder="https://example.com/mcp" /></label>
            <KeyValueFields server={draft.name} title="请求头" rows={draft.headers} saved={catalog.servers[index].config.headers} onChange={headers => update(index, { headers })} />
          </>}
          {draft.type === 'stdio' && draft.directories !== undefined && <label className="block space-y-2 text-sm"><span>{draft.executables?.length ? '公共仓库目录（可选）' : '公共目录（可选）'}</span><textarea className={field} rows={3} aria-label={`${draft.name} 公共目录`} value={draft.directories} onChange={event => update(index, { directories: event.target.value })} placeholder="~/Documents" /><span className="block text-xs leading-5 text-muted-foreground">每行一个已有目录，最多 32 个，支持 ~/。{catalog.servers[index].config.pathBindings ? '默认使用当前会话目录；显式指定路径时可选择公共目录，不自动切换。' : catalog.servers[index].config.roots?.includeWorkspace ? '会话工作目录自动加入并优先使用；留空时仅访问当前会话目录。' : '仅访问此处配置的目录。'}</span></label>}
          {draft.type === 'stdio' && draft.executables?.map(executable => <label key={executable.argument} className="block space-y-2 text-sm"><span>Git 程序路径（可选）</span><input className={field} aria-label={`${draft.name} Git 程序路径`} value={executable.value} onChange={event => update(index, { executables: draft.executables!.map(item => item.argument === executable.argument ? { ...item, value: event.target.value } : item) })} placeholder="留空，从 PATH 查找 git" /><span className="block text-xs text-muted-foreground">填写可执行文件的完整路径，不附带参数。支持 ~/。</span></label>)}
          <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">高级参数</summary><label className="mt-3 block space-y-2"><span className="text-xs text-muted-foreground">其他连接参数（JSON）</span><textarea className={`${field} font-mono`} rows={8} aria-label={`${draft.name} 高级参数`} autoComplete="off" spellCheck={false} value={draft.advanced} onChange={event => update(index, { advanced: event.target.value })} /></label></details>
          </fieldset>
          {draft.type !== 'stdio' && catalog.servers[index].config.type === draft.type && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!canAuthenticate} onClick={() => void operate(async () => { const next = await request('auth.start', { name: draft.name }); if (alive.current) onSaved(next); }, 'auth')}>浏览器授权</Button><Button type="button" variant="ghost" disabled={!canAuthenticate} onClick={() => void operate(async () => { const next = await request('auth.clear', { name: draft.name }); if (alive.current) onSaved(next); }, 'auth')}>清除授权</Button></div>}
        </section>)}
      </fieldset>
    </div>
    <footer className="flex shrink-0 justify-end gap-2 border-t px-5 py-4"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !canManage}>{operation === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}{operation === 'save' ? '保存中' : '保存设置'}</Button></footer>
  </form>;
}
