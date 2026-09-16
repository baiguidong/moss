import * as React from 'react';
import { PreviewDrawer } from '@/components/preview-drawer';
import { previewIpc } from '@/ipc/preview.ipc';
import { previewFileFromPayload, syncPreviewTabs, upsertPreviewTab } from '@/lib/preview-window-state';
import { PRESET_THEMES } from '@/theme/presets';
import { applyCssTheme, getStoredThemeId } from '@/theme/cssTheme';
import type { WorkspacePreviewData } from '@/types';

type ThemeMode = 'dark' | 'light' | 'system';

function getInitialThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem('ui.themeMode');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {}
  return 'light';
}

function applyTheme(mode: ThemeMode) {
  const resolved = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
}

export default function PreviewWindow() {
  const [tabs, setTabs] = React.useState<WorkspacePreviewData[]>([]);
  const [activePath, setActivePath] = React.useState<string | null>(null);
  const tabsRef = React.useRef(tabs);

  const updateTabs = React.useCallback((update: (current: WorkspacePreviewData[]) => WorkspacePreviewData[]) => {
    setTabs((current) => {
      const next = update(current);
      tabsRef.current = next;
      return next;
    });
  }, []);

  React.useEffect(() => {
    let themeMode = getInitialThemeMode();
    applyTheme(themeMode);

    const cssThemeId = getStoredThemeId();
    const preset = PRESET_THEMES.find((theme) => theme.id === cssThemeId);
    applyCssTheme(preset?.css || null);

    void window.agentDesktop.getSettings().then((settings) => {
      themeMode = settings.appearance?.themeMode || themeMode;
      applyTheme(themeMode);
      const currentPreset = PRESET_THEMES.find((theme) => theme.id === settings.appearance?.cssThemeId);
      applyCssTheme(currentPreset?.css || null);
    }).catch(() => undefined);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemTheme = () => {
      if (themeMode === 'system') applyTheme(themeMode);
    };
    media.addEventListener('change', handleSystemTheme);
    return () => media.removeEventListener('change', handleSystemTheme);
  }, []);

  React.useEffect(() => {
    const unsubscribeOpen = previewIpc.onOpen((payload) => {
      const file = previewFileFromPayload(payload);
      updateTabs((current) => upsertPreviewTab(current, file));
      setActivePath(file.path);
    });
    const unsubscribeSync = previewIpc.onSync(({ files }) => {
      if (!Array.isArray(files) || files.length === 0) return;
      updateTabs((current) => syncPreviewTabs(current, files));
    });
    void previewIpc.ready();
    return () => {
      unsubscribeOpen();
      unsubscribeSync();
    };
  }, [updateTabs]);

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const dirtyCount = tabsRef.current.filter((tab) => Boolean(tab.metadata?.dirty)).length;
      if (dirtyCount === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const closeWindow = React.useCallback(() => {
    tabsRef.current = [];
    setTabs([]);
    setActivePath(null);
    void previewIpc.close();
  }, []);

  const closeTab = React.useCallback((path: string) => {
    updateTabs((current) => {
      const next = current.filter((tab) => tab.path !== path);
      setActivePath((active) => active === path ? next[0]?.path || null : active);
      if (next.length === 0) window.setTimeout(() => void previewIpc.close(), 0);
      return next;
    });
  }, [updateTabs]);

  const closeOthers = React.useCallback((path: string) => {
    updateTabs((current) => current.filter((tab) => tab.path === path));
    setActivePath(path);
  }, [updateTabs]);

  const updateTab = React.useCallback((path: string, patch: Partial<WorkspacePreviewData>) => {
    updateTabs((current) => current.map((tab) => tab.path === path ? { ...tab, ...patch } : tab));
  }, [updateTabs]);

  React.useEffect(() => {
    const active = tabs.find((tab) => tab.path === activePath) || tabs[0];
    document.title = active ? `${active.relativePath} - Moss` : '文件预览 - Moss';
  }, [activePath, tabs]);

  return (
    <div className="app-shell h-screen min-h-0 w-full overflow-hidden bg-background">
      <PreviewDrawer
        visible={tabs.length > 0}
        tabs={tabs}
        activePath={activePath}
        onActivate={setActivePath}
        onUpdateTab={updateTab}
        onCloseTab={closeTab}
        onCloseOthers={closeOthers}
        onCloseAll={closeWindow}
        onCloseDrawer={closeWindow}
        standalone
      />
    </div>
  );
}
