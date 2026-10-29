import * as React from 'react';
import { ArrowLeft, ArrowRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToolbarTargets = { session: HTMLDivElement | null; presentation: HTMLDivElement | null };

export const WindowToolbarContext = React.createContext<ToolbarTargets>({ session: null, presentation: null });

export function WindowChrome({ desktop, isMacOS, sidebarWidth, rightWidth, sessionActive, leftCollapsed, rightCollapsed, onToggleLeft, canGoBack, canGoForward, onBack, onForward, notifications, children }: {
  desktop: boolean;
  isMacOS: boolean;
  sidebarWidth: number;
  rightWidth: number;
  sessionActive: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  notifications: React.ReactNode;
  children: React.ReactNode;
}) {
  const [sessionTarget, setSessionTarget] = React.useState<HTMLDivElement | null>(null);
  const [presentationTarget, setPresentationTarget] = React.useState<HTMLDivElement | null>(null);
  const targets = React.useMemo(() => ({
    session: desktop && sessionActive ? sessionTarget : null,
    presentation: desktop && sessionActive && !rightCollapsed ? presentationTarget : null,
  }), [desktop, sessionActive, rightCollapsed, sessionTarget, presentationTarget]);
  const showPresentation = sessionActive && !rightCollapsed;
  const controlsWidth = isMacOS ? 40 : 180;

  return <WindowToolbarContext.Provider value={targets}>
    {desktop && <div className={cn('moss-window-chrome moss-window-drag relative z-40 flex h-9 shrink-0 items-center', !isMacOS && 'moss-window-chrome-native')}>
      <div className="flex h-full shrink-0 items-center gap-0.5 pr-2" style={{ width: Math.max(sidebarWidth, isMacOS ? 180 : 104), paddingLeft: isMacOS ? 84 : 8 }}>
        <button type="button" className="moss-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onToggleLeft} aria-label={`${leftCollapsed ? '展开' : '收起'}会话侧栏`} title={`${leftCollapsed ? '展开' : '收起'}会话侧栏`}>
          {leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <button type="button" className="moss-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onBack} disabled={!canGoBack} aria-label="后退" title="后退"><ArrowLeft size={16} /></button>
        <button type="button" className="moss-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onForward} disabled={!canGoForward} aria-label="前进" title="前进"><ArrowRight size={16} /></button>
      </div>
      <div className="hidden w-3 shrink-0 lg:block" />
      <div ref={setSessionTarget} data-window-toolbar="session" className="min-w-0 flex-1" />
      {sessionActive && <div className="hidden w-3 shrink-0 lg:block" />}
      {showPresentation && <div
        className="h-full shrink-0 border-l border-border/70"
        style={{ width: rightWidth, paddingRight: controlsWidth }}
      >
        <div ref={setPresentationTarget} data-window-toolbar="presentation" className="h-full min-w-0" />
      </div>}
      {!showPresentation && <div className="h-full shrink-0" style={{ width: controlsWidth }} />}
      <div className="moss-no-drag absolute top-1" style={{ right: isMacOS ? 8 : 144 }}>{notifications}</div>
    </div>}
    {children}
  </WindowToolbarContext.Provider>;
}
