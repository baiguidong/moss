import * as React from 'react';
import { EmbeddedAppView } from './embedded-app-view';
import type { StoredApp } from '../types';
import { appPageUnavailableReason } from '../lib/app-navigation';
import { getCompanion, getUserId } from './buddy/buddy-companion';
import { isWebUI } from '../lib/host-environment';

export function availableAppWidgets(apps: StoredApp[]) {
  return apps.flatMap(app => (app.contributes?.widgets || []).flatMap((widget: any) => {
    const view = app.contributes?.views?.find(v => v.id === widget.viewId);
    if (!view || !app.hasUi || appPageUnavailableReason(app, widget.permission, view.permission)) return [];
    return [{ id: `${app.id || app.name}/${widget.id}`, name: app.name, title: widget.title, route: view.route, version: app.currentVersion || '' }];
  }));
}

function AppWidget({ widget, index }: { widget: ReturnType<typeof availableAppWidgets>[number]; index: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const [position, setPosition] = React.useState<{ x: number; y: number } | null>(() => {
    try { const p = JSON.parse(localStorage.getItem(`ui.appWidgetPosition:${widget.id}`) || (widget.id === 'moss.buddy/companion-widget' ? localStorage.getItem('ui.buddyPosition') : null) || 'null'); return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null; } catch { return null; }
  });
  const [viewport, setViewport] = React.useState({ w: window.innerWidth, h: window.innerHeight });
  React.useEffect(() => { const resize = () => setViewport({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const width = Math.min(expanded ? 410 : 56, viewport.w - 24), height = Math.min(expanded ? 650 : 56, viewport.h - 24);
  const anchorX = Math.max(12, Math.min(position?.x ?? viewport.w - 80 - index * 68, viewport.w - 68));
  const anchorY = Math.max(12, Math.min(position?.y ?? viewport.h - 80, viewport.h - 68));
  const x = Math.max(12, Math.min(anchorX + 56 - width, viewport.w - width - 12));
  const y = Math.max(12, Math.min(anchorY + 56 - height, viewport.h - height - 12));
  const drag = React.useRef<{ x:number; y:number; px:number; py:number; moved:boolean } | null>(null);
  const dragged = React.useRef(false);
  const pointerDown = (event:React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    drag.current={x:anchorX,y:anchorY,px:event.clientX,py:event.clientY,moved:false};
    dragged.current=false;event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event:React.PointerEvent<HTMLElement>) => {
    const start=drag.current;if(!start)return;
    const dx=event.clientX-start.px,dy=event.clientY-start.py;
    if(Math.hypot(dx,dy)>4)start.moved=true;
    if(start.moved)setPosition({x:Math.max(12,Math.min(start.x+dx,viewport.w-68)),y:Math.max(12,Math.min(start.y+dy,viewport.h-68))});
  };
  const pointerUp = (event:React.PointerEvent<HTMLElement>) => {
    const start=drag.current;if(!start)return;
    dragged.current=start.moved;
    if(start.moved){const next={x:Math.max(12,Math.min(start.x+event.clientX-start.px,viewport.w-68)),y:Math.max(12,Math.min(start.y+event.clientY-start.py,viewport.h-68))};setPosition(next);localStorage.setItem(`ui.appWidgetPosition:${widget.id}`,JSON.stringify(next));}
    drag.current=null;
  };
  return <aside aria-label={`${widget.title} 桌面挂件`} data-expanded={expanded} className={`fixed z-40 flex flex-col ${expanded ? 'overflow-hidden rounded-2xl border border-border bg-background shadow-xl' : 'rounded-full'}`} style={{ left:x, top:y, width, height }}>
    {expanded && <div className="flex h-9 shrink-0 touch-none items-center gap-2 border-b border-border px-3 text-xs" style={{ cursor:'grab' }}
      onPointerDown={event=>{if(!(event.target as HTMLElement).closest('button'))pointerDown(event)}} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{drag.current=null}}>
      <span className="flex-1 truncate">{widget.title}</span><button type="button" className="rounded px-2 py-1 hover:bg-muted" aria-expanded={expanded} onClick={() => setExpanded(false)}>收起</button>
    </div>}
    <div className={`min-h-0 flex-1 ${expanded ? '' : 'pointer-events-none'}`}><EmbeddedAppView key={isWebUI() ? String(expanded) : 'desktop'} appName={widget.name} route={`${widget.route}${widget.route.includes('?') ? '&' : '?'}expanded=${expanded ? 1 : 0}`} widget compact miniWidget={!expanded} /></div>
    {!expanded && <button type="button" aria-label={`打开 ${widget.title}`} title={`打开 ${widget.title} · 拖动可移动`} aria-expanded={false} className="absolute inset-0 touch-none rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" style={{cursor:'grab'}}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{drag.current=null;dragged.current=true}}
      onClick={event=>{if(event.detail===0||!dragged.current)setExpanded(true);dragged.current=false}} />}
  </aside>;

}

export function AppWidgetHost({ apps, enabled }: { apps: StoredApp[]; enabled:boolean }) {
  const [migration, setMigration] = React.useState('');
  const buddy = apps.find(app => (app.id || app.name) === 'moss.buddy' && !appPageUnavailableReason(app));
  React.useEffect(() => {
    if (!buddy || localStorage.getItem('ui.buddyMigration.v1')) return;
    const old = getCompanion();
    if (!old) return;
    void window.agentDesktop.importLegacyBuddy({name:old.name,personality:old.personality,hatchedAt:old.hatchedAt,userId:getUserId()}).then(() => {localStorage.setItem('ui.buddyMigration.v1','done');setMigration('');}).catch(error=>setMigration(`旧宠物迁移未完成：${error.message}`));
  }, [buddy?.currentVersion, buddy?.enabled]);
  return <>{migration && <div role="status" className="fixed bottom-3 left-3 z-40 max-w-sm rounded-xl border bg-background p-3 text-xs">{migration}</div>}{enabled && availableAppWidgets(apps).map((widget,index)=><AppWidget key={`${widget.id}:${widget.version}`} widget={widget} index={index} />)}</>;
}
