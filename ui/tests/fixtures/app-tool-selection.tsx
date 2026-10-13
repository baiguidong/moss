import React from 'react';
import { createRoot } from 'react-dom/client';
import { ComposerPanel } from '@/components/chat-area';
import { ComposerResourceSelectionArea } from '@/components/composer-resource-selection-area';
import { AppToolSelectionContext } from '@/lib/app-tool-selection';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { StoredApp } from '@/types';
import '@/globals.css';

window.agentDesktop = {
  onAppsChanged: () => () => {}, onEvent: () => () => {},
  listAppResources: async () => ({ providers: [], items: [] }),
  getInstalledSkills: async () => ({ success: true, data: [] }),
} as unknown as typeof window.agentDesktop;
const apps = [
  { id: 'native', name: 'native', title: '目录工具', category: 'knowledge', keywords: ['Catalog'], description: '查找目录', enabled: true, toolScope: 'session', agentTools: [{ id: 'search', title: '搜索', description: '查找', effect: 'read' }] },
  { id: 'mcp', name: 'mcp', title: 'MCP 工具', category: 'ai', enabled: true, toolScope: 'global', mcpServices: [{ status: 'unchecked', tools: [] }] },
  { id: 'ui-only', name: 'ui-only', title: '纯页面' },
  { id: 'disabled', name: 'disabled', title: '文件系统', category: 'knowledge', enabled: false, agentTools: [{ id: 'read' }] },
  { id: 'denied', name: 'denied', title: '未授权工具', category: 'knowledge', enabled: true, agentTools: [{ id: 'read', permission: 'files.read' }] },
  { id: 'empty', name: 'empty', title: '空工具服务', category: 'knowledge', enabled: true, mcpServices: [{ status: 'connected', tools: [] }] },
  ...Array.from({ length: 18 }, (_, index) => ({
    id: `extra-${index + 1}`, name: `extra-${index + 1}`, title: `测试工具 ${index + 1}`, category: 'other', enabled: true,
    agentTools: [{ id: 'search', title: '搜索', description: '查找', effect: 'read' }],
  })),
] as StoredApp[];

function Fixture() {
  const [serviceSelections, setServiceSelections] = React.useState<Record<string, string[]>>({ a: [], b: [] });
  const [extraService, setExtraService] = React.useState(false);
  const servicesEnabled = new URLSearchParams(location.search).has('subservices');
  const serviceApp = { id: 'customer.services', name: 'customer.services', displayName: '客户服务管理', enabled: true, category: 'ai', toolSelection: 'services',
    mcpServices: [
      { serviceId: 'mcp/default/database', name: '公司数据库', status: 'unchecked', tools: [] },
      { serviceId: 'mcp/default/knowledge', name: '内部知识库', status: 'unchecked', tools: [] },
      ...(extraService ? [{ serviceId: 'mcp/default/new', name: '新追加服务', status: 'unchecked', tools: [] }] : []),
    ],
  } as StoredApp;
  const [session, setSession] = React.useState('a');
  const [selections, setSelections] = React.useState<Record<string, string[]>>({ a: [], b: [] });
  const [value, setValue] = React.useState('');
  const [picker, setPicker] = React.useState<'apps' | null>(null);
  const [nativeEnabled, setNativeEnabled] = React.useState(true);
  const toggle = (id: string) => setSelections(previous => ({ ...previous, [session]: previous[session].includes(id) ? previous[session].filter(item => item !== id) : [...previous[session], id] }));
  return <TooltipProvider><AppToolSelectionContext.Provider value={{ selectedServiceIds: serviceSelections[session], toggleService: id => setServiceSelections(previous => ({ ...previous, [session]: previous[session].includes(id) ? previous[session].filter(value => value !== id) : [...previous[session], id] })), setServices: (_appId, ids) => setServiceSelections(previous => ({ ...previous, [session]: ids })), apps: [...apps, ...(servicesEnabled ? [serviceApp] : [])].map(app => app.id === 'native' ? { ...app, enabled: nativeEnabled } : app), selectedIds: selections[session], enabled: true, pending: false, nextTurn: false, toggle, openManager: () => {} }}>
    <main style={{ padding: 32, paddingTop: 360, maxWidth: 850 }}>
      <button data-switch onClick={() => { setSession(previous => previous === 'a' ? 'b' : 'a'); setValue(''); }}>切换会话</button>
      <button data-picker onClick={() => setPicker('apps')}>打开 App 资源</button>
      <button data-disable-native onClick={() => setNativeEnabled(false)}>停用目录工具</button>
      {servicesEnabled && <><button data-add-service onClick={() => setExtraService(true)}>追加服务</button><output data-services>{JSON.stringify(serviceSelections[session])}</output></>}
      <output data-selected>{selections[session].join(',')}</output>
      <ComposerPanel value={value} onChange={setValue} loading={false} hasActiveSession={false}
        composerIntent="chat" permissionMode="default" onPermissionModeChange={() => {}}
        onComposerIntentChange={() => {}} onSend={() => {}} />
      <ComposerResourceSelectionArea openTab={picker} onOpenTabChange={() => setPicker(null)} triggerVisible={false} />
    </main>
  </AppToolSelectionContext.Provider></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
