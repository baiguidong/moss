import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

type Snapshot = { id: string; name: string; notes: string; createdAt: number; version: string; bytes: number; includesDataVolume: boolean; automatic: boolean };
type Input = { action: 'create' | 'restore' | 'delete'; snapshotId?: string; name?: string; notes?: string; includesDataVolume?: boolean };
type Operation = { id: string; phase: string; status: string; error?: string; resumeError?: string; cleanupError?: string; transferredBytes?: number };
type Environment = { id: string; generation: number; state: string; version: string; source: string; policy: { maxSnapshotsPerEnvironment: number; maxBytesPerEnvironment: number }; usage: { count: number; bytes: number }; operation?: Operation; error?: string; automationsPaused: boolean };
type Preflight = { token: string; input: Input; impact: string; estimatedBytes: number; generation: number };
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const phases: Record<string, string> = { finalizing: '正在完成清理', 'cleanup-failed': '清理需要重试', queued: '准备中', stopping: '正在停止环境', 'saving-system': '正在保存 Docker 环境', 'saving-data': '正在保存数据卷', 'starting-original': '正在启动原环境', packaging: '正在打包校验', 'loading-image': '正在加载环境镜像', 'restoring-data': '正在恢复数据卷', checking: '正在检查兼容性', activating: '正在启动恢复后的环境', deleting: '正在删除', completed: '已完成', failed: '失败', 'activation-failed': '恢复需要处理', 'rolling-back': '正在回退到原环境' };
const button = 'inline-flex min-h-8 items-center justify-center rounded-xl border border-sidebar-border bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-50';
export function CloudSnapshots({ standalone = false }: { standalone?: boolean }) {
  const [environment, setEnvironment] = useState<Environment>();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [error, setError] = useState('');
  const [input, setInput] = useState<Input | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), resumeDialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0), requestId = useRef('');
  const api = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(`/api/cloud/${url}`, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', 'X-Moss-Generation': String(generation.current), ...init?.headers } });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '请求失败');
    return value;
  }, []);
  const refresh = useCallback(async () => {
    const [env, list] = await Promise.all([api('environment'), api('snapshots')]);
    generation.current = env.generation; setEnvironment(env); setSnapshots(list);
  }, [api]);
  useEffect(() => {
    let active = true;
    const update = () => { if (active) void refresh().catch(reason => { if (active) setError(reason.message); }); };
    update(); const timer = setInterval(update, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [refresh]);
  useEffect(() => { if (input) dialog.current?.showModal(); else dialog.current?.close(); }, [!!input]);
  useEffect(() => { if (resumeOpen) resumeDialog.current?.showModal(); else resumeDialog.current?.close(); }, [resumeOpen]);
  const open = (value: Input) => { setError(''); setPreflight(null); setDialogOffset({ x: 0, y: 0 }); requestId.current = crypto.randomUUID(); setInput(value); };
  const moveDialog = (event: PointerEvent<HTMLHeadingElement>) => {
    if (!drag.current) return;
    const width = dialog.current?.offsetWidth || 520, height = dialog.current?.offsetHeight || 400;
    const maxX = Math.max(0, (window.innerWidth - width) / 2 - 12);
    const maxY = Math.max(0, (window.innerHeight - height) / 2 - 12);
    setDialogOffset({ x: Math.max(-maxX, Math.min(maxX, drag.current.x + event.clientX - drag.current.startX)),
      y: Math.max(-maxY, Math.min(maxY, drag.current.y + event.clientY - drag.current.startY)) });
  };
  const work = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const submit = () => work(async () => {
    if (!input) return;
    if (!preflight) { setPreflight(await api('snapshots/preflight', { method: 'POST', body: JSON.stringify(input) })); return; }
    if (generation.current !== preflight.generation) { setPreflight(null); throw new Error('环境已变化，请重新检查后确认'); }
    const suffix = input.action === 'create' ? '' : `/${input.snapshotId}${input.action === 'restore' ? '/restore' : ''}`;
    await api(`snapshots${suffix}`, { method: input.action === 'delete' ? 'DELETE' : 'POST', body: JSON.stringify({ ...input, requestId: requestId.current, preflightToken: preflight.token }) });
    setInput(null); setPreflight(null); await refresh();
  });
  const active = environment?.operation && ['running', 'attention'].includes(environment.operation.status);
  const operation = environment?.operation;
  const showOperation = operation && operation.status !== 'completed';
  const selected = snapshots.find(snapshot => snapshot.id === input?.snapshotId);
  return <section className={`${standalone ? 'rounded-2xl border bg-background p-5' : ''} space-y-4 text-foreground`} aria-label="环境快照">
    <header className={`flex flex-wrap items-start justify-between gap-3 ${standalone ? '' : 'px-1'}`}><div><h2 className={standalone ? 'text-xl font-semibold' : 'text-[15px] font-semibold'}>环境快照</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">保存当前云电脑的 Docker 环境，需要时恢复到这台云电脑。</p></div>
      <div className="flex gap-2">{standalone && <a className={button} href="/">返回云电脑</a>}{!standalone && <a className={button} href="/?window=cloud-environment">打开管理页</a>}
        <button className={button} disabled={!environment || !!active} onClick={() => open({ action: 'create', name: '', notes: '', includesDataVolume: false })}>创建快照</button></div></header>
    <div className={standalone ? 'space-y-3' : 'overflow-hidden rounded-[20px] border border-sidebar-border bg-sidebar-accent/58 divide-y divide-sidebar-border backdrop-blur-xl'}>
    {environment && <div className={standalone ? 'rounded-xl border border-sidebar-border bg-background/60 p-3 text-xs leading-6 sm:p-4' : 'px-4 py-3 text-xs leading-6 sm:px-5'}><p className="font-medium">{environment.state === 'ready' ? '环境运行中' : environment.state === 'stopped' ? '环境已停止' : active ? '环境维护中' : '环境需要处理'} · Moss {environment.version || '未知版本'}</p>
      <p>{environment.usage.count} / {environment.policy.maxSnapshotsPerEnvironment} 个快照 · {size(environment.usage.bytes)} / {size(environment.policy.maxBytesPerEnvironment)}</p>
      {standalone && <p className="text-muted-foreground">额度来源：{environment.source === 'server' ? 'Server 设置（缺失字段使用默认值）' : '内置默认值'}，包含恢复前自动保护快照。</p>}</div>}
    {environment?.automationsPaused && <div className={standalone ? 'rounded-xl border border-amber-500/40 p-4 text-sm' : 'px-4 py-3 text-sm sm:px-5'}><p>环境已恢复，自动任务和 App 后台暂未启动。请先检查恢复后的文件与配置。</p><button className={`${button} mt-3`} disabled={!!active} onClick={() => setResumeOpen(true)}>启用自动任务</button></div>}
    {showOperation && <div className={standalone ? 'rounded-xl border p-4 text-sm' : 'px-4 py-3 text-sm sm:px-5'} role="status"><p>{phases[operation.phase] || operation.phase}{operation.transferredBytes ? ` · 已传输 ${size(operation.transferredBytes)}` : ''}</p>
      {operation.status === 'running' && <p className="mt-1 text-muted-foreground">关闭页面不会取消已提交的任务。</p>}{[operation.error, operation.resumeError, operation.cleanupError].filter(Boolean).map((text, i) => <p className="mt-2 text-red-600" key={i}>{text}</p>)}
      {operation.status === 'attention' && <button className={`${button} mt-3`} disabled={busy} onClick={() => void work(async () => { await api('operations/retry', { method: 'POST', body: '{}' }); await refresh(); })}>重试恢复处理</button>}</div>}
    {(error || environment?.error) && <p role="alert" className={standalone ? 'text-sm text-red-600' : 'px-4 py-3 text-sm text-red-600 sm:px-5'}>{error || environment?.error}</p>}
    <div className={standalone ? 'space-y-3' : 'divide-y divide-sidebar-border'}>{snapshots.map(snapshot => <article key={snapshot.id} className={standalone ? 'rounded-xl border border-sidebar-border bg-background/60 p-4' : 'px-4 py-3 sm:px-5'}><div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-sm font-medium">{snapshot.name}</h3><p className="mt-1 text-xs">{snapshot.includesDataVolume ? 'Docker 环境 + 数据卷' : '仅 Docker 环境'}{snapshot.automatic ? ' · 恢复前自动保护' : ''}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(snapshot.createdAt).toLocaleString()} · Moss {snapshot.version} · {size(snapshot.bytes)}</p>{snapshot.notes && <p className="mt-2 whitespace-pre-wrap text-xs">{snapshot.notes}</p>}</div>
      <div className="flex items-start gap-2"><button className={button} disabled={!!active} onClick={() => open({ action: 'restore', snapshotId: snapshot.id })}>恢复到当前</button><button className={button} disabled={!!active} onClick={() => open({ action: 'delete', snapshotId: snapshot.id })}>删除</button></div></div></article>)}
      {environment && !snapshots.length && <p className="py-6 text-center text-sm text-muted-foreground">暂无快照。创建时默认只保存 Docker 环境。</p>}</div>
    </div>
    <dialog ref={dialog} className="w-[min(92vw,520px)] max-h-[calc(100vh-24px)] overflow-auto space-y-4 rounded-2xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"
      style={{ position: 'fixed', left: '50%', top: '50%', margin: 0, transform: `translate(calc(-50% + ${dialogOffset.x}px), calc(-50% + ${dialogOffset.y}px))` }}
      onCancel={event => { if (busy) event.preventDefault(); else setInput(null); }} onClose={() => { if (!busy) setInput(null); }} aria-label="确认快照操作">
      <h3 className="cursor-move select-none touch-none text-lg font-semibold" title="拖动此处移动窗口"
        onPointerDown={event => { drag.current = { startX: event.clientX, startY: event.clientY, ...dialogOffset }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={moveDialog} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {input?.action === 'create' ? '创建当前环境快照' : input?.action === 'restore' ? '恢复到当前环境' : '删除快照'}</h3>
      {input?.action === 'create' && !preflight && <div className="space-y-4"><label className="block text-sm">名称<input className="mt-2 w-full rounded-lg border bg-transparent p-2" value={input.name || ''} maxLength={100} onChange={event => setInput({ ...input, name: event.target.value })} /></label>
        <label className="block text-sm">备注<textarea className="mt-2 w-full rounded-lg border bg-transparent p-2" value={input.notes || ''} maxLength={1000} onChange={event => setInput({ ...input, notes: event.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={input.includesDataVolume === true} onChange={event => setInput({ ...input, includesDataVolume: event.target.checked })} />同时备份数据卷</label><p className="text-sm text-muted-foreground">默认只保存系统、已安装软件和 Docker 写层。HOME 中的项目、会话和配置仅在勾选后备份。</p></div>}
      {selected && <p className="text-sm">{selected.name} · {selected.includesDataVolume ? 'Docker 环境 + 数据卷' : '仅 Docker 环境'}</p>}
      {preflight && <div className="space-y-2 text-sm"><p>{preflight.impact}</p>{preflight.estimatedBytes > 0 && <p>预计归档空间：{size(preflight.estimatedBytes)}，实际大小以完成结果为准。</p>}</div>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end gap-2"><button className={button} autoFocus disabled={busy} onClick={() => setInput(null)}>取消</button>{preflight && <button className={button} disabled={busy} onClick={() => setPreflight(null)}>{input?.action === 'create' ? '修改范围' : '重新检查'}</button>}
        <button className={`${button} bg-primary text-primary-foreground`} disabled={busy} onClick={() => void submit()}>{busy ? '处理中…' : !preflight ? '检查并继续' : input?.action === 'restore' ? '确认恢复' : input?.action === 'delete' ? '确认删除' : '确认创建'}</button></div>
    </dialog>
    <dialog ref={resumeDialog} className="w-[min(92vw,480px)] space-y-4 rounded-2xl border bg-background p-6 text-foreground backdrop:bg-black/40" onCancel={() => setResumeOpen(false)} aria-label="启用自动任务"><h3 className="font-semibold">启用自动任务？</h3><p className="text-sm">将启动 App 后台、协作邮箱及后续定时任务。已错过的定时任务不会补跑，历史待确认请求不会重新执行。</p><div className="flex justify-end gap-2"><button className={button} autoFocus onClick={() => setResumeOpen(false)}>取消</button><button className={button} disabled={busy} onClick={() => void work(async () => { await api('automations/resume', { method: 'POST', body: '{}' }); setResumeOpen(false); await refresh(); })}>确认启用</button></div>{error && <p role="alert">{error}</p>}</dialog>
  </section>;
}
