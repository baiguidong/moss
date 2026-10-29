import * as React from 'react';
import { splitDocumentReference, type DocumentLocation } from '../../../shared/document-location.mjs';

type Check = { message: string; severity?: string; location?: DocumentLocation };
export type CreationInfo = {
  version?: number;
  comparison?: { count: number; resourceUri: string };
  quality?: { state: string; reviewedPages: number; totalPages?: number; checks?: Check[] };
  rendering?: { status: string; renderedPages: number; totalPages?: number; nextPage?: number; reason?: string };
};
function reference(source: string, location?: DocumentLocation) {
  if (!location) return null;
  try {
    const uri = source + '#' + new URLSearchParams(Object.entries(location).map(([key, value]) => [key, String(value)])).toString();
    return splitDocumentReference(uri).location ? uri : null;
  } catch { return null; }
}
export function CreationStatus({ creation, sessionId, source, onError }: { creation: CreationInfo; sessionId: string; source: string; onError: (error: string) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const { quality, rendering } = creation;
  const label = quality ? ({ reviewed: '已逐页核验', 'reviewed-with-warnings': '核验有提示', 'needs-repair': '发现问题待修复', stale: '核验已失效', pending: '待逐页核验' }[quality.state] || '待逐页核验') : '';
  const open = (uri: string) => {
    setExpanded(false);
    void window.agentDesktop.presentation.open({ sessionId, input: { items: [/^moss-[\w-]+:\/\//.test(uri) ? { resource_uri: uri } : { path: uri }] } }).then(result => { if (!result.ok) onError(result.error || '无法定位内容'); }).catch(reason => onError(String(reason)));
  };
  return <div data-creation-status className="shrink-0 border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>第 {creation.version || 1} 版</span>
      {quality && <button aria-expanded={expanded} className="rounded text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setExpanded(value => !value)}>{label}{quality.totalPages ? ` · ${quality.reviewedPages}/${quality.totalPages} 页` : ''}</button>}
      {rendering?.totalPages && rendering.renderedPages < rendering.totalPages ? <span data-render-progress>页图 {rendering.renderedPages}/{rendering.totalPages}</span> : null}
      {creation.comparison && <button className="ml-auto shrink-0 text-primary hover:underline" onClick={() => open(creation.comparison!.resourceUri)}>查看 {creation.comparison.count} 处修改</button>}
    </div>
    {expanded && quality && <div className="mt-2 max-h-64 space-y-2 overflow-y-auto border-t border-border/60 pt-2" data-quality-details>
      <p>{quality.state === 'stale' ? '文件已变化，之前的核验记录不再适用于当前内容。' : quality.state === 'pending' ? '待模型查看实际页面并记录核验结果。' : '记录来自模型逐页检查，并结合文件结构检查。'}</p>
      {rendering && rendering.status !== 'rendered' && <p data-render-detail>{rendering.reason || '核验页图尚未全部生成。'}{rendering.nextPage ? '可在主会话继续检查剩余页面。' : ''}</p>}
      {quality.checks?.map((check, index) => {
        const uri = reference(source, check.location);
        const place = check.location?.sheet ? `${check.location.sheet}${check.location.range ? '!' + check.location.range : ''}` : check.location?.page ? `第 ${check.location.page} 页` : '原文';
        return <div key={index} className="flex items-start gap-2" data-quality-issue>
          <span className={check.severity === 'error' ? 'shrink-0 text-destructive' : 'shrink-0 text-amber-600 dark:text-amber-400'}>{check.severity === 'error' ? '问题' : '提示'}</span>
          {uri ? <button className="min-w-0 text-left text-primary underline underline-offset-2" onClick={() => open(uri)} aria-label={`${place}：${check.message}`}><span className="break-words">{check.message}</span><span className="ml-2 whitespace-nowrap text-muted-foreground">{place} ↗</span></button> : <p className="min-w-0 break-words">{check.message}</p>}
        </div>;
      })}
    </div>}
  </div>;
}
