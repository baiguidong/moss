import * as React from 'react';
import { diffChars } from 'diff';
import { handleMarkdownLinkClick } from '@/lib/markdown-links';
import type { DocumentLocation } from '../../../../shared/document-location.mjs';

type Side = { text: string; detail?: Record<string, any>; location?: DocumentLocation; truncated?: boolean } | null;
type Change = { key: string; label: string; kind: string; before: Side; after: Side };
type Comparison = { schema: string; count: number; complete: boolean; truncated?: boolean; before: { uri: string }; after: { uri: string }; changes: Change[] };
const target = (uri: string, location?: DocumentLocation) => uri + (location ? '#' + new URLSearchParams(Object.entries(location).map(([k, v]) => [k, String(v)])).toString() : '');
const highlight = 'rounded-sm bg-amber-100 px-0.5 text-amber-950 dark:bg-amber-900/50 dark:text-amber-100';
function ObjectDetails({ detail, other }: { detail: Record<string, any>; other?: Record<string, any> }) {
  const differs = (key: string) => JSON.stringify(detail[key]) !== JSON.stringify(other?.[key]);
  return <div className="mt-2 space-y-1 text-xs text-muted-foreground">
    {differs('fontSizes') && detail.fontSizes?.length > 0 && <p>字号：{detail.fontSizes.join('、')} pt</p>}
    {differs('bounds') && detail.bounds && <p>位置 {Number(detail.bounds.x).toFixed(2)}, {Number(detail.bounds.y).toFixed(2)} · 尺寸 {Number(detail.bounds.w).toFixed(2)} × {Number(detail.bounds.h).toFixed(2)} 英寸</p>}
    {differs('fills') && detail.fills?.length > 0 && <div className="flex flex-wrap items-center gap-1">颜色：{[...new Set<string>(detail.fills)].filter(value => /^[a-f\d]{6}$/i.test(value)).map(value => <span key={value} className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: '#' + value }} />#{value}</span>)}</div>}
  </div>;
}
function TextChange({ before, after, side }: { before: string; after: string; side: 'before' | 'after' }) {
  const pieces = React.useMemo(() => diffChars(before, after, { maxEditLength: 1000, timeout: 20 }), [before, after]);
  return <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-6">{pieces ? pieces.filter(p => side === 'before' ? !p.added : !p.removed).map((p, i) => p.added || p.removed ? <mark data-diff-highlight key={i} className={highlight}>{p.value}</mark> : <React.Fragment key={i}>{p.value}</React.Fragment>) : <mark data-diff-highlight className={highlight}>{side === 'before' ? before : after}</mark>}</pre>;
}
function ComparisonImage({ path, label }: { path?: string; label: string }) {
  const root = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false), [src, setSrc] = React.useState<string | null>();
  React.useEffect(() => { if (!root.current) return; const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' }); observer.observe(root.current); return () => observer.disconnect(); }, []);
  React.useEffect(() => {
    if (!visible) return; let active = true; setSrc(undefined);
    if (!path || !/\.(png|jpe?g|webp|gif)$/i.test(path)) { setSrc(null); return; }
    void window.agentDesktop.fs.getImageBase64(path).then(value => { if (active) setSrc(value && /^data:image\/(png|jpeg|webp|gif);base64,/.test(value) ? value : null); }).catch(() => { if (active) setSrc(null); });
    return () => { active = false; };
  }, [visible, path]);
  return <div ref={root} className="flex min-h-20 items-center justify-center rounded border border-border/60 bg-muted/20 p-2">{src ? <img data-comparison-image src={src} alt={label} className="max-h-44 max-w-full object-contain" onError={() => setSrc(null)} /> : <span className="text-xs text-muted-foreground">{src === null ? '图片预览不可用，请定位原文查看' : '正在加载图片…'}</span>}</div>;
}
function TableChanges({ before, after }: { before: string[][]; after: string[][] }) {
  const cells: Array<{ row: number; col: number; a: string; b: string }> = [];
  for (let row = 0; row < Math.max(before.length, after.length); row++) for (let col = 0; col < Math.max(before[row]?.length || 0, after[row]?.length || 0); col++) {
    const a = before[row]?.[col] ?? '', b = after[row]?.[col] ?? '';
    if (a !== b) cells.push({ row, col, a, b });
  }
  return cells.length ? <div className="overflow-x-auto px-3 pb-3"><table data-table-diff className="w-full table-fixed border-collapse text-left text-xs"><thead><tr className="border-b border-border"><th className="w-1/3 py-2 font-medium">单元格</th><th className="font-medium">修改前</th><th className="font-medium">修改后</th></tr></thead><tbody>{cells.slice(0,100).map(cell => <tr key={`${cell.row}:${cell.col}`} className="border-b border-border/50"><th className="py-2 pr-2 font-normal">第 {cell.row + 1} 行 · 第 {cell.col + 1} 列</th><td className="break-words py-2 pr-2"><mark data-diff-highlight className={highlight}>{cell.a || '（空）'}</mark></td><td className="break-words py-2"><mark data-diff-highlight className={highlight}>{cell.b || '（空）'}</mark></td></tr>)}</tbody></table>{cells.length > 100 && <p className="mt-2 text-muted-foreground">显示前 100 个变化的单元格，请结合原文检查。</p>}</div> : null;
}
const rowsOf = (side: Side): string[][] | null => Array.isArray(side?.detail?.rows) && side.detail.rows.every((row: unknown) => Array.isArray(row) && row.every(cell => typeof cell === 'string')) ? side.detail.rows : null;
function ChangeView({ change, parsed, open }: { change: Change; parsed: Comparison; open: (event: React.MouseEvent, uri: string, location?: DocumentLocation) => void }) {
  const beforeRows = rowsOf(change.before), afterRows = rowsOf(change.after), table = Boolean(beforeRows && afterRows);
  const media = change.before?.detail?.type === 'image' || change.after?.detail?.type === 'image';
  const shared = change.before?.text === change.after?.text;
  return <section className="mb-4 overflow-hidden rounded-lg border border-border/70">
    <div className="flex items-start justify-between gap-2 bg-muted/50 px-3 py-2 text-xs"><span>{change.label.replace(/Text \d+/, '文字').replace(/Chart \d+/, '图表').replace(/Table \d+/, '表格').replace(/Image \d+/, '图片')}</span><span className="shrink-0 text-muted-foreground">{change.kind === 'added' ? '新增' : change.kind === 'removed' ? '删除' : media && change.before?.detail?.imageSha256 !== change.after?.detail?.imageSha256 ? '图片变化' : shared ? '样式或对象属性变化' : '内容变化'}</span></div>
    {shared && change.before?.text && !table && !media && <p className="break-words px-3 pt-3 text-xs">{change.before.text}</p>}
    <div className="grid grid-cols-1 divide-y divide-border/60 @min-[300px]:grid-cols-2 @min-[300px]:divide-x @min-[300px]:divide-y-0">
      {(['before', 'after'] as const).map(side => <div key={side} className="min-w-0 p-3">
        <button disabled={!change[side]} className="mb-2 text-xs text-primary disabled:text-muted-foreground" onClick={e => open(e, parsed[side].uri, change[side]?.location)}>{side === 'before' ? '修改前' : '修改后'}{change[side]?.location ? ' · 定位原文' : ''}</button>
        {media ? change[side] && <ComparisonImage path={change[side]?.detail?.imagePath} label={side === 'before' ? '修改前图片' : '修改后图片'} /> : !table && !shared && <TextChange before={change.before?.text || (change.before ? '（无文字）' : '—')} after={change.after?.text || (change.after ? '（无文字）' : '—')} side={side} />}
        {change[side]?.detail && <ObjectDetails detail={change[side].detail} other={change[side === 'before' ? 'after' : 'before']?.detail} />}
        {change[side]?.truncated && <p className="mt-2 text-xs text-muted-foreground">内容较长，当前显示部分内容。</p>}
      </div>)}
    </div>
    {table && <TableChanges before={beforeRows!} after={afterRows!} />}
  </section>;
}
export function DocumentComparisonViewer({ content, sessionId, onReady, onError }: { content: string; sessionId?: string; onReady?: () => void; onError?: (message: string) => void }) {
  const [error, setError] = React.useState('');
  const parsed = React.useMemo(() => {
    try {
      const data = JSON.parse(content) as Comparison;
      if (data.schema !== 'moss.document-comparison/v1' || !Array.isArray(data.changes) || data.changes.length > 1000 || typeof data.before?.uri !== 'string' || typeof data.after?.uri !== 'string' || !data.changes.every(change => change && typeof change.key === 'string' && typeof change.label === 'string' && [change.before, change.after].every(side => side === null || side && typeof side.text === 'string'))) throw new Error();
      return data;
    } catch { return null; }
  }, [content]);
  React.useEffect(() => { setError(''); if (parsed) onReady?.(); else onError?.('修改对比数据不可用'); }, [parsed, onReady, onError]);
  const open = (event: React.MouseEvent, uri: string, location?: DocumentLocation) => void handleMarkdownLinkClick(event, target(uri, location), window.agentDesktop, sessionId).catch(reason => setError(String(reason.message || reason)));
  if (!parsed) return <p role="alert" className="p-4 text-sm">修改对比数据不可用</p>;
  return <div data-document-comparison className="@container h-full overflow-auto p-4 text-sm">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><span className="font-medium">{parsed.count} 处修改</span><div className="flex gap-3 text-xs"><button className="text-primary underline" onClick={e => open(e, parsed.before.uri)}>打开修改前</button><button className="text-primary underline" onClick={e => open(e, parsed.after.uri)}>打开修改后</button></div></div>
    <p className="mb-4 text-xs text-muted-foreground">高亮标出内容变化。点击位置可回到原文；页面排版请结合原文件检查。</p>
    {!parsed.complete && <p role="status" className="mb-3 text-xs text-amber-600">部分内容无法解析，对比结果不完整。</p>}
    {error && <p role="alert" className="mb-3 text-xs text-destructive">{error}</p>}
    {parsed.changes.map(change => <ChangeView key={change.key} change={change} parsed={parsed} open={open} />)}
    {!parsed.count && <p className="text-muted-foreground">未检测到已解析内容的变化。</p>}
    {parsed.truncated && <p role="status" className="text-xs text-muted-foreground">当前显示前 {parsed.changes.length} 处修改，请结合原文件检查其余变化。</p>}
  </div>;
}
