import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AssistantMessage } from '@/components/chat/assistant-message';
import { MessageList } from '@/components/chat/message-list';
import { buildMainChatRenderMessagesFromHistory } from '@/lib/agent-transcript';
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer';
import { ToolCallBlock } from '@/components/chat/tool-call-block';
import { ActivityGroup } from '@/components/chat/activity-group';
import { ToolDisplaySettingsProvider } from '@/components/chat/tool-display-settings';
import { useAssistantOutputFiles } from '@/components/chat/use-assistant-output-files';
import { TaskPanel } from '@/components/task-panel';
import { TurnChangeCard } from '@/components/chat/turn-change-card';
import { PresentationToolbar, PresentationContent } from '@/components/presentation/presentation-panel';
import { AssistantOutputFileCard } from '@/components/chat/assistant-output-file-card';
import { usePresentation } from '@/lib/use-presentation';
import { usePreviewDocument } from '@/lib/use-preview-document';
import { WindowChrome } from '@/components/window-chrome';
import { SessionTabBar } from '@/components/chat-area';
import { useNavigationHistory, type NavigationEntry } from '@/lib/use-navigation-history';
import '@/globals.css';

const api = window as any, root = createRoot(document.getElementById('root')!);
const render = (element: React.ReactNode) => flushSync(() => root.render(element));
const delay = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function until(condition: () => boolean, message: string) { for (let i = 0; i < 150; i++) { if (condition()) return; await delay(20); } throw new Error(message); }
const names = ['joke_write.txt', 'joke_bash.txt', 'joke_python.txt'], paths = names.map(name => '/workspace/' + name);
const noop = () => {};
function RetryExample() {
  const messages = buildMainChatRenderMessagesFromHistory([
    { type: 'user', message: { content: '继续检查这些文件' } },
    { type: 'system', subtype: 'api_retry', attempt: 1, error_status: 503, retry_delay_ms: 1500,
      retry_budget: { attempts: 1, maxAttempts: 12, waitedMs: 0, maxWaitMs: 120000, remainingWaitMs: 120000 } },
    { type: 'system', subtype: 'api_retry', attempt: 2, error_status: 503, retry_delay_ms: 3000,
      retry_budget: { attempts: 2, maxAttempts: 12, waitedMs: 1500, maxWaitMs: 120000, remainingWaitMs: 118500 } },
  ]);
  return <div style={{ maxWidth: 480, padding: 20, margin: 'auto' }}><MessageList messages={messages} loading /></div>;
}
const events = new Map<string, Set<(event: any) => void>>();
const on = (name: string, fn: (event: any) => void) => { const set = events.get(name) || new Set(); set.add(fn); events.set(name, set); return () => set.delete(fn); };
const emit = (name: string, event: any) => events.get(name)?.forEach(fn => fn(event));
const resources = paths.map((path, index) => ({ id: 'file-' + index, kind: 'file', title: names[index], revision: '1', isResult: true, source: { type: 'file', path }, capabilities: { preview: true, edit: true, popout: true }, bindings: [{ sourceToolUseId: 'present' }] }));
const snapshot: any = { sessionId: 'session', epoch: 'epoch', version: 1, resources, results: [], state: { activeId: 'results', activeOrigin: 'manual', visible: true, autoFollow: true, back: [], openedIds: [], pinnedId: null, dirty: false } };
const user: any = { id: 'user', turnId: 'user', role: 'user', type: 'user_text', content: '使用 Write、Bash、Python 生成三个笑话文件', timestamp: new Date() };
const reply: any = { id: 'final', turnId: 'user', role: 'assistant', type: 'assistant_text', content: '已生成 3 个 txt 文件，可点击文件查看。\n\n' + paths.map(path => `- [${path}](${path}:1)`).join('\n'), timestamp: new Date() };
const tool: any = { id: 'present', turnId: 'user', toolUseId: 'present', role: 'assistant', type: 'tool_use', toolName: 'moss_present', displayName: '展示成果', input: { title: '生成的笑话 txt 文件' }, status: 'success', timestamp: new Date() };
const result: any = { id: 'result', toolUseId: 'present', content: JSON.stringify({ schema: 'moss.presentation-result/v1', request_id: 'present', ok: true, items: resources, presentation: { state: 'deferred', reason: 'user_selection' } }) };
const observation: any = { userMessageId: 'user', coverage: 'complete', observationId: 'observation', stats: { filesChanged: 3, additions: 12, deletions: 0 }, files: paths.map((filePath, i) => ({ filePath, status: 'added', verified: true, additions: [4, 3, 5][i], deletions: 0, structuredPatch: [] })) };
let opened: any[] = [];
let observationReads = 0;
api.agentDesktop = {
  presentation: { snapshot: async () => snapshot, onChanged: (fn: any) => on('presentation', fn), onResult: () => noop,
    resolve: async ({ references }: any) => references.map((reference: string) => ({ available: paths.some(path => reference.startsWith(path)), reference })),
    open: async (input: any) => { opened.push(input); return { ok: true }; }, action: async (input: any) => { opened.push(input); } },
  getTurnChanges: async () => { observationReads++; return { turns: [observation], rewind: { supported: false } }; }, onTurnObservation: (fn: any) => on('observation', fn),
  getObservationDiff: async ({ filePath }: any) => observation.files.find((file: any) => file.filePath === filePath),
  preview: { resolveFiles: async ({ paths }: any) => paths.map((inputPath: string) => ({ inputPath, file: { path: inputPath, name: inputPath.split('/').at(-1), size: 120, relativePath: inputPath.slice(11) } })) },
};

function Example({ initialView = 'results', mode = 'collapsed' }: { initialView?: string; mode?: 'collapsed' | 'expanded' | 'merged' | 'diff' }) {
  const [view, setView] = React.useState(initialView), files = useAssistantOutputFiles([user, tool, reply], 'session', 'local', '/workspace', false);
  const sessionTasks = [{ id: '1', subject: '生成三个笑话文件', status: 'completed', blockedBy: [] }, { id: '2', subject: '检查链接与预览', status: 'in_progress', blockedBy: [] }] as any;
  const current = { ...snapshot, state: { ...snapshot.state, activeId: view } };
  const action = (action: any) => { if (action.type === 'select') setView(action.id); };
  return <div style={{ display: 'flex', height: '100vh', background: 'var(--background)' }}>
    <main style={{ flex: 1, padding: 32, overflow: 'auto' }}><div className="mb-6 text-lg font-semibold">多种工具生成文件 · 会话回放测试</div>
      <div className="mb-5 text-sm text-muted-foreground">用户：使用 Write、Bash、Python 写入 3 个 txt，写完打开看看。</div>
      <ToolDisplaySettingsProvider key={mode} sessionId="session" toolDisplayMode={mode}>
        <ActivityGroup steps={[{ kind: 'tool', toolCall: tool }]} toolCalls={[tool]} mergeable resultMap={new Map([['present', result]])} childToolCallsByParent={new Map()} />
      </ToolDisplaySettingsProvider>
      <div className="mt-5"><AssistantMessage message={reply} outputFiles={files.get('final')} sessionId="session" workspace="/workspace" /></div>
      <TurnChangeCard sessionId="session" change={observation} rewindSupported={false} initiallyExpanded />
      <MarkdownRenderer sessionId="session" content={'路径也可直接点击：/workspace/joke_bash.txt\n\n不存在的路径 /workspace/missing.txt 应保持文本。'} />
    </main>
    <aside style={{ width: 400, borderLeft: '1px solid var(--border)' }}><TaskPanel collapsed={false} searchQuery="" onSearchChange={noop} onRefresh={noop} onOpenWorkspace={noop} treeItems={names.map((name, index) => ({ name, path: paths[index], type: 'file' })) as any} expandedPaths={new Set()} selectedFilePath={null} onFocusFile={noop} onToggleFolder={noop} onSelectFile={noop}
      sessionTasks={sessionTasks}
      navigation={({ tasksActive, onSelectTasks, onSelectPresentation }) => <PresentationToolbar snapshot={current} action={action} sessionTasks={sessionTasks} tasksActive={tasksActive} onSelectTasks={onSelectTasks} onSelectPresentation={onSelectPresentation} />} showBrowser={false} content={mode === 'diff' ? <div id="diff-review-test" className="p-2"><TurnChangeCard sessionId="session" change={observation} rewindSupported={false} initiallyExpanded inset={false}/></div> : view === 'results' ? <PresentationContent snapshot={current} action={action} /> : undefined}/></aside>
  </div>;
}

async function openMenu(label: string) {
  const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  assert(trigger?.getBoundingClientRect().width > 0, `${label} trigger is not visible`);
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(() => Boolean(document.querySelector('[role="menu"]')), `${label} menu did not open`);
}
async function clickView(title: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.presentation-navigation-tabs button')]
    .find(item => item.textContent?.includes(title) && item.getBoundingClientRect().width > 0);
  if (button) button.click();
  else {
    await openMenu('切换右侧视图');
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent?.includes(title));
    assert(item, `${title} is missing from the view menu`);
    item!.click();
  }
  await delay();
}
const previewResources = ['compound-check.png', 'video.mp4'].map((title, i) => ({ ...resources[0], id: `preview-${i}`, title, source: { type: 'file', path: `/workspace/${title}` } }));
function CompactPreviewExample({ width = 320, withTasks = true }: { width?: number; withTasks?: boolean }) {
  const [current, setCurrent] = React.useState({ ...snapshot, resources: previewResources, state: { ...snapshot.state, activeId: 'preview-0', back: ['workspace'], openedIds: ['preview-0', 'preview-1'] } });
  const [tasksActive, setTasksActive] = React.useState(false);
  const action = (event: any) => {
    if (event.type === 'select') setCurrent((value: any) => ({ ...value, state: { ...value.state, activeId: event.id } }));
    if (event.type === 'back') { setTasksActive(false); setCurrent((value: any) => ({ ...value, state: { ...value.state, activeId: 'workspace' } })); }
    if (event.type === 'follow') setCurrent((value: any) => ({ ...value, state: { ...value.state, autoFollow: event.value } }));
    if (event.type === 'dismiss') setCurrent((value: any) => ({ ...value, state: { ...value.state, activeId: 'results', openedIds: value.state.openedIds.filter((id: string) => id !== event.id) } }));
  };
  return <aside id="compact-preview" className="flex min-h-0 flex-col border bg-background" style={{ width, height: 620, margin: 24 }}>
    <PresentationToolbar snapshot={current} action={action} sessionTasks={withTasks ? [{ id: 'task', subject: '检查预览', description: '', status: 'pending', blockedBy: [] }] : []}
      tasksActive={tasksActive} onSelectTasks={() => setTasksActive(true)} onSelectPresentation={() => setTasksActive(false)}/>
    {tasksActive ? <div>任务内容</div> : ['workspace', 'browser'].includes(current.state.activeId) ? <div>{current.state.activeId}</div>
      : <div className="min-h-0 flex-1"><PresentationContent snapshot={current} action={action}/></div>}
  </aside>;
}
function setupCompactPreview() {
  api.agentDesktop.presentation.load = async ({ artifactId }: any) => {
    const resource = previewResources.find(item => item.id === artifactId)!;
    return { resource, epoch: 'epoch', file: { path: resource.source.path, relativePath: resource.title, content: '',
      contentType: artifactId === 'preview-0' ? 'image' : 'unsupported', size: 100, truncated: false, metadata: { previewEditable: false } } };
  };
  api.agentDesktop.fs = { getImageBase64: async () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#e6f4ed"/><rect x="48" y="48" width="544" height="264" rx="16" fill="#289766"/><text x="320" y="195" text-anchor="middle" fill="white" font-size="28">Preview fixture</text></svg>') };
}
async function reviewCompactPreview() {
  setupCompactPreview();
  render(<CompactPreviewExample/>);
  await until(() => Boolean(document.querySelector('[aria-label="切换已打开内容"]')), 'Unified filename did not render');
  const panel = document.querySelector<HTMLElement>('#compact-preview')!;
  assert((panel.innerText.match(/compound-check.png/g) || []).length === 1, 'Filename repeats across multiple rows');
  assert(!panel.querySelector('[aria-label="预览标签"]'), 'Nested file tabs remain');
  assert(panel.querySelectorAll('[data-preview-header-row]').length === 2, 'Preview should have only filename and action rows');
  const nav = panel.querySelector<HTMLElement>('[aria-label="内容导航"]')!;
  const checkBounds = () => {
    assert(nav.scrollWidth <= nav.clientWidth + 1, 'Navigation overflows at this panel width');
    const back = nav.querySelector('[aria-label="返回上一个内容"]')!.getBoundingClientRect();
    const selector = nav.querySelector('[aria-label="切换右侧视图"]')!.getBoundingClientRect();
    assert(back.right <= selector.left, 'Back arrow should precede the dropdown');
    assert(nav.getBoundingClientRect().height < 50, 'Navigation wraps to a second row');
  };
  for (const width of [280, 320, 440]) {
    panel.style.width = `${width}px`; await delay(); checkBounds();
    assert(nav.querySelector('[aria-label="切换右侧视图"]')!.getBoundingClientRect().width > 0, 'Narrow navigation should be a dropdown');
  }
  await openMenu('切换右侧视图');
  for (const title of ['会话任务', '工作区', '结果', '浏览器']) assert(document.querySelector('[role="menu"]')?.textContent?.includes(title), `${title} hidden in narrow navigation`);
  [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent?.includes('浏览器'))!.click(); await delay();
  assert(panel.innerText.includes('browser'), 'Browser selection did not change content');
  await clickView('会话任务'); assert(panel.innerText.includes('任务内容'), 'Tasks selection did not change content');
  await clickView('结果');
  [...panel.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes('compound-check.png'))!.click();
  await until(() => Boolean(document.querySelector('[aria-label="切换已打开内容"]')), 'File could not be reopened');
  await openMenu('切换已打开内容');
  [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent?.includes('video.mp4'))!.click(); await delay();
  assert(panel.querySelector('[aria-label="切换已打开内容"]')?.textContent?.includes('video.mp4'), 'File dropdown did not switch resource');
  assert((panel.innerText.match(/video.mp4/g) || []).length === 1, 'Second filename duplicated');
  panel.style.width = '560px'; await delay();
  assert(nav.querySelector('[aria-label="切换右侧视图"]')!.getBoundingClientRect().width === 0, 'Wide panel should use tabs');
  for (const button of nav.querySelectorAll<HTMLElement>('.presentation-navigation-tabs button')) assert(button.getBoundingClientRect().right <= nav.getBoundingClientRect().right, 'Wide navigation tab is clipped');
  panel.querySelector<HTMLButtonElement>('[aria-label="关闭当前内容"]')!.click(); await delay();
  assert(panel.innerText.includes('会话结果'), 'Close preview did not return to results');
  render(<CompactPreviewExample key="no-tasks" width={440} withTasks={false}/>); await delay();
  assert(!document.querySelector('.presentation-navigation-tabs')?.textContent?.includes('会话任务'), 'Empty task tab is visible');
  assert(document.querySelector('[aria-label="切换右侧视图"]')!.getBoundingClientRect().width === 0, 'Three tabs should fit at 440px');
}
api.showCompactPreviewExample = async (width: number, dark = false) => {
  setupCompactPreview(); document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  render(<CompactPreviewExample key={width} width={width}/>);
  await until(() => Boolean(document.querySelector('[aria-label="切换已打开内容"]')), 'Preview not ready'); await delay(100);
};

function TaskPreviewExample() {
  const presentation = usePresentation('session', '/workspace', true, noop);
  const sessionTasks = [{ id: 'task', subject: '检查图片', description: '', status: 'completed' as const, blockedBy: [] }];
  return <div className="flex h-screen gap-6 p-6">
    <main className="flex-1"><AssistantOutputFileCard sessionId="session" workspace="/workspace"
      file={{ path: '/workspace/compound-check.png', name: 'compound-check.png', subtitle: 'compound-check.png', type: 'PNG', operation: 'create', toolUseId: 'write', sourcePaths: [] }}/></main>
    <aside id="task-preview" style={{ width: 440 }}><TaskPanel collapsed={false} searchQuery="" onSearchChange={noop} onRefresh={noop} onOpenWorkspace={noop}
      treeItems={[]} expandedPaths={new Set()} selectedFilePath={null} onFocusFile={noop} onToggleFolder={noop} onSelectFile={noop}
      sessionId="session" sessionTasks={sessionTasks} presentationOpenSignal={presentation.openSignal} showBrowser={false}
      navigation={props => <PresentationToolbar snapshot={presentation.snapshot} action={presentation.action} sessionTasks={sessionTasks} {...props}/>}
      content={presentation.snapshot && <PresentationContent snapshot={presentation.snapshot} action={presentation.action}/>}/></aside>
  </div>;
}
async function reviewOpenFromTasks() {
  const originalPresentation = api.agentDesktop.presentation;
  const originalWorkspaceChanged = api.agentDesktop.onWorkspaceChanged;
  setupCompactPreview();
  let current: any = { ...snapshot, resources: previewResources, state: { ...snapshot.state, activeId: 'workspace', activeOrigin: 'restore', openedIds: [] } };
  const acknowledgements: string[] = [];
  const publish = (patch: any = {}) => { current = { ...current, ...patch, version: current.version + 1 }; emit('presentation', current); };
  api.agentDesktop.onWorkspaceChanged = () => noop;
  api.agentDesktop.presentation = { ...originalPresentation,
    snapshot: async () => current,
    acknowledge: async ({ requestId }: any) => { acknowledgements.push(requestId); return { accepted: true }; },
    open: async () => {
      publish({ state: { ...current.state, activeId: 'preview-0', activeOrigin: 'manual', openedIds: ['preview-0'] },
        request: { requestId: `open-${current.version}`, artifactId: 'preview-0', revision: '1', epoch: 'epoch' } });
      return { ok: true };
    },
    action: async ({ action }: any) => {
      if (action.type === 'follow') publish({ state: { ...current.state, autoFollow: action.value } });
      if (action.type === 'select') publish({ request: undefined, state: { ...current.state, activeId: action.id, activeOrigin: 'manual' } });
    },
  };
  try {
    render(<TaskPreviewExample/>); await delay();
    const tasksVisible = () => Boolean(document.querySelector('[data-session-tasks]'));
    assert(tasksVisible(), 'Existing session tasks should initially be selected');
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) {
        await clickView('会话任务'); assert(tasksVisible(), 'Task view cannot be revisited');
        publish(); await delay();
        assert(tasksVisible(), 'Snapshot refresh stole the task selection');
        document.querySelector<HTMLInputElement>('[aria-label="内容导航"] input')!.click(); await delay();
        assert(!current.state.autoFollow && tasksVisible(), 'Changing follow should keep the task view');
        emit('presentation', { ...current, sessionId: 'another-session', request: { ...current.request, requestId: 'another-open' } }); await delay();
        assert(tasksVisible(), 'Another session stole the task selection');
      }
      document.querySelector<HTMLButtonElement>('[aria-label="Moss 预览 compound-check.png"]')!.click();
      await until(() => {
        const img = document.querySelector<HTMLImageElement>('#task-preview img[alt="compound-check.png"]');
        return Boolean(img?.complete && img.naturalWidth > 0 && !tasksVisible());
      }, 'Image eye button left the right panel on tasks');
      await until(() => acknowledgements.includes(current.request.requestId), 'Visible image was not acknowledged');
      assert(document.querySelector('[aria-label="切换右侧视图"]')?.textContent?.includes('结果'), 'Preview navigation still selects tasks');
    }
    await clickView('会话任务');
    publish({ request: undefined, resources: [...current.resources, { ...previewResources[1], id: 'background-result' }] }); await delay();
    assert(tasksVisible(), 'A background result stole the task selection');
    publish({ state: { ...current.state, activeId: 'results', activeOrigin: 'manual' } }); await delay();
    assert(!tasksVisible() && document.querySelector('#task-preview')?.textContent?.includes('会话结果'), 'External view selection did not exit tasks');
  } finally {
    render(null);
    api.agentDesktop.presentation = originalPresentation;
    api.agentDesktop.onWorkspaceChanged = originalWorkspaceChanged;
  }
}

let disk = 'original', state: any, failNext = false, gate: (() => Promise<void>) | null = null, saveEntered = false, released = false;
const file: any = { path: '/workspace/editor.txt', relativePath: 'editor.txt', content: 'original', contentType: 'text', metadata: { sessionId: 'session' } };
function Editor() {
  const [tab, setTab] = React.useState(file);
  const document = usePreviewDocument(tab, (_path, patch) => setTab((current: any) => ({ ...current, ...patch })));
  return <div><textarea aria-label="test-editor" value={document.file?.content || ''} onChange={event => document.update(file.path, { content: event.target.value })}/><button id="save" onClick={() => void document.save?.()}>保存</button><span>{document.notice}</span></div>;
}
const type = (content: string) => {
  const textarea = document.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, content);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
};
function WindowToolbarExample({ desktop = true, isMacOS = true, rightWidth = 440 }: { desktop?: boolean; isMacOS?: boolean; rightWidth?: number }) {
  const [entry, setEntry] = React.useState<NavigationEntry>({ view: 'chat', sessionId: 'one' });
  const [leftCollapsed, setLeftCollapsed] = React.useState(false);
  const [rightCollapsed, setRightCollapsed] = React.useState(false);
  const [current, setCurrent] = React.useState(snapshot);
  const [tasksActive, setTasksActive] = React.useState(false);
  const [toolMode, setToolMode] = React.useState<'expanded' | 'collapsed' | 'merged'>('expanded');
  const history = useNavigationHistory(entry, async (next, signal) => {
    if (api.historyDelay) await delay(api.historyDelay);
    if (signal.aborted || api.historyFail) return false;
    setEntry(next); return true;
  });
  const sessionActive = entry.view === 'chat';
  const action = (event: any) => setCurrent((value: any) => ({ ...value, state: { ...value.state,
    ...(event.type === 'select' ? { activeId: event.id } : {}), ...(event.type === 'follow' ? { autoFollow: event.value } : {}) } }));
  return <div className="flex h-screen flex-col bg-background">
    <WindowChrome desktop={desktop} isMacOS={isMacOS} sidebarWidth={leftCollapsed ? 68 : 224} rightWidth={rightWidth}
      sessionActive={sessionActive} leftCollapsed={leftCollapsed} rightCollapsed={rightCollapsed} onToggleLeft={() => setLeftCollapsed(value => !value)}
      canGoBack={history.canGoBack} canGoForward={history.canGoForward} onBack={() => void history.back()} onForward={() => void history.forward()}
      notifications={<button aria-label="通知" className="h-7 w-7">铃</button>}>
      <div className="flex min-h-0 flex-1">
        <aside style={{ width: leftCollapsed ? 68 : 224 }} className="shrink-0 bg-sidebar p-2">
          <div className="mb-5 p-2">Moss</div>
          {(['common', 'apps', 'projects', 'settings'] as const).map((view, i) => <button key={view} className="block p-2" aria-label={`访问 ${view}`} onClick={() => setEntry({ view })}>{['插件', 'Apps', '项目', '设置'][i]}</button>)}
          <button className="block p-2" aria-label="访问第二个会话" onClick={() => setEntry({ view: 'chat', sessionId: 'two' })}>第二个会话</button>
        </aside>
        <div className="hidden w-3 shrink-0 lg:block" />
        <main className="min-w-0 flex-1" data-test-page={`${entry.view}:${entry.sessionId || ''}`}>
          {sessionActive && <SessionTabBar title={`会话 ${entry.sessionId} · 检查顶部导航布局`} leftCollapsed={leftCollapsed} rightCollapsed={rightCollapsed}
            leftPanelName="会话侧栏" rightPanelName="工作区" onToggleLeft={() => setLeftCollapsed(value => !value)} onToggleRight={() => setRightCollapsed(value => !value)}
            toolDisplayMode={toolMode} sessionToolDisplayMode={toolMode} globalToolDisplayMode="expanded" onToolDisplayModeChange={mode => setToolMode(mode || 'expanded')}
            toolDisplaySettingBusy={false} outline={[{ messageId: 'q1', question: '检查顶部导航', answerPreview: '检查成功' }]} onJumpToOutlineItem={noop} messages={[]} childSessions={[]}
            onOpenWorkers={noop} onSelectWorker={noop} terminalActions={<button className="h-8 w-8" aria-label="终端菜单">终</button>} sessionInfo={<button className="h-8 w-8" aria-label="查看会话信息">ⓘ</button>} />}
          <div className="p-6">{sessionActive ? '会话正文' : entry.view}</div>
        </main>
        {sessionActive && <><div className="hidden w-3 shrink-0 lg:block" /><aside data-test-workspace className="shrink-0 border-l" style={{ width: rightCollapsed ? 0 : rightWidth }}>
          {!rightCollapsed && <><PresentationToolbar snapshot={current} action={action} sessionTasks={[{ id: 'task', subject: '检查导航', description: '', status: 'pending', blockedBy: [] }]}
            tasksActive={tasksActive} onSelectTasks={() => setTasksActive(true)} onSelectPresentation={() => setTasksActive(false)} />
            <div className="p-4" data-test-view={tasksActive ? 'tasks' : current.state.activeId}>工作区内容</div></>}
        </aside></>}
      </div>
    </WindowChrome>
  </div>;
}

async function reviewWindowToolbars() {
  const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const click = async (label: string) => { assert(button(label), `Missing ${label}`); button(label).click(); await delay(); };
  for (const isMacOS of [true, false]) for (const rightWidth of [320, 440, 560]) {
    render(<WindowToolbarExample key={`${isMacOS}:${rightWidth}`} isMacOS={isMacOS} rightWidth={rightWidth} />); await delay();
    const chrome = document.querySelector<HTMLElement>('.moss-window-chrome')!;
    const navigation = chrome.querySelector<HTMLElement>('[aria-label="内容导航"]')!;
    assert(navigation && chrome.querySelector('[aria-label^="会话操作"]'), 'Both toolbars must move into the native title bar');
    assert(document.querySelectorAll('[aria-label="内容导航"]').length === 1 && document.querySelectorAll('[aria-label^="会话操作"]').length === 1, 'Duplicate toolbar remains');
    assert(chrome.getBoundingClientRect().height === 36, 'Toolbar added an extra header row');
    assert(getComputedStyle(chrome).getPropertyValue('-webkit-app-region') === 'drag', 'Title bar no longer drags');
    assert(getComputedStyle(button('后退')).getPropertyValue('-webkit-app-region') === 'no-drag', 'Navigation button consumes window dragging');
    assert(navigation.getBoundingClientRect().left === document.querySelector('[data-test-workspace]')!.getBoundingClientRect().left + 1, 'Workspace toolbar drifted from its panel');
    const pin = button('固定当前内容').getBoundingClientRect();
    assert(pin.right <= navigation.getBoundingClientRect().right + 1, `Workspace controls overflow at ${rightWidth}, Mac=${isMacOS}`);
    assert(pin.right <= button('通知').getBoundingClientRect().left, 'Workspace pin overlaps notifications');
    await clickView('会话任务'); assert(document.querySelector('[data-test-view="tasks"]'), 'Task switch broke after moving navigation');
    await clickView('结果'); assert(document.querySelector('[data-test-view="results"]'), 'Result switch broke after moving navigation');
    await click('查看会话大纲'); assert(document.querySelector('input[placeholder="搜索对话轮次..."]'), 'Outline does not open below title bar');
    await click('查看会话大纲');
    await openMenu('工具展示：展开');
    ([...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent === '折叠'))!.click(); await delay();
    assert(button('工具展示：折叠'), 'Tool display setting no longer works');
    await click('收起工作区'); assert(!document.querySelector('[aria-label="内容导航"]'), 'Collapsed workspace leaves its toolbar visible');
    await click('展开工作区'); assert(document.querySelector('.moss-window-chrome [aria-label="内容导航"]'), 'Expanded workspace lost its top toolbar');
    await click('收起会话侧栏'); assert(button('展开会话侧栏')?.querySelector('.lucide-panel-left-open'), 'Left collapse icon did not change');
    await click('展开会话侧栏');
  }
  render(<WindowToolbarExample key="history" />); await delay();
  assert(button('后退').disabled && button('前进').disabled, 'Empty history should disable both arrows');
  await click('访问 common'); await click('访问 apps'); await click('后退');
  assert(document.querySelector('[data-test-page="common:"]') && !button('前进').disabled, 'Back did not restore plugin page');
  await click('前进'); assert(document.querySelector('[data-test-page="apps:"]'), 'Forward did not restore Apps');
  await click('后退'); await click('访问 projects'); assert(button('前进').disabled, 'New navigation did not discard the forward branch');
  await click('后退'); await click('后退'); assert(document.querySelector('[data-test-page="chat:one"]'), 'History lost the session identity');
  await click('访问第二个会话'); await click('后退'); assert(document.querySelector('[data-test-page="chat:one"]'), 'Back between sessions failed');
  await click('前进'); api.historyFail = true; await click('后退'); api.historyFail = false;
  assert(document.querySelector('[data-test-page="chat:two"]') && !button('后退').disabled, 'Failed navigation changed history or left it busy');
  api.historyDelay = 180; await click('后退'); await click('访问 settings'); await delay(200); api.historyDelay = 0;
  assert(document.querySelector('[data-test-page="settings:"]'), 'Late session response overwrote a newer navigation');
  render(<WindowToolbarExample key="web" desktop={false} />); await delay();
  assert(!document.querySelector('.moss-window-chrome'), 'Web host gained a native title bar');
  assert(document.querySelector('main [aria-label^="会话操作"]') && document.querySelector('[data-test-workspace] [aria-label="内容导航"]'), 'Web lost its inline toolbars');
}
api.showWindowToolbarExample = async (isMacOS = true, dark = false) => {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  render(<WindowToolbarExample key={`screenshot:${isMacOS}:${dark}`} isMacOS={isMacOS} />); await delay(200);
};

api.runPresentationReview = async () => {
  const passed: string[] = [];
  render(<Example />);
  await until(() => document.querySelectorAll('[aria-label^="文件："]').length === 3, 'Bash/Python output cards missing');
  assert(document.body.innerText.includes('本轮改动 3 个文件') && document.body.innerText.includes('+12'), 'Turn changes disagree with the three output cards');
  for (const path of paths) assert(document.querySelector(`button[title="${path}"]`), 'A verified file is missing from the change tabs');
  const readsBeforeEdit = observationReads;
  emit('presentation', { ...snapshot, resources: resources.map(resource => ({ ...resource, dirty: true })) }); await delay();
  assert(observationReads === readsBeforeEdit, 'Editing reread the full conversation history');
  assert(document.querySelectorAll('[aria-label="会话任务"]').length === 1, 'Duplicate task list');
  const task = document.querySelector('[aria-label="会话任务"]')!, nav = document.querySelector('[aria-label="内容导航"]')!;
  assert(task.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom, 'Tasks should render below the merged navigation');
  const taskTab = nav.querySelector('button[aria-label^="会话任务"]')!;
  assert(taskTab.getAttribute('aria-pressed') === 'true', 'Session tasks should be selected when available');
  await clickView('工作区');
  await clickView('结果');
  assert(!document.querySelector('[data-session-tasks]'), 'Task view did not close after navigation');
  passed.push('three verified cards; one task list; task tab switches with workspace/results');
  const link = document.querySelector<HTMLAnchorElement>('a[href="/workspace/joke_write.txt:1"]')!;
  assert(link.textContent === 'joke_write.txt', 'File label should omit the target line number'); link.click(); await delay();
  assert(opened[0].sessionId === 'session' && opened[0].input.items[0].path === '/workspace/joke_write.txt:1', 'File link lost session/line');
  await until(() => Boolean(document.querySelector('a[href="/workspace/joke_bash.txt"]')), 'Bare file path is not clickable');
  assert(!document.querySelector('a[href="/workspace/missing.txt"]'), 'Missing path became a link');
  passed.push('Markdown and verified bare paths open in the owning session');
  assert(!document.querySelector('[data-presentation-status]'), 'moss_present escaped collapsed mode');
  document.querySelector<HTMLButtonElement>('[aria-label="展开工具记录"]')!.click(); await delay();
  assert(document.querySelector('[data-presentation-status]'), 'Manual expand did not show presentation status');
  render(<Example key="merged" mode="merged"/>); await delay();
  assert(!document.querySelector('[data-presentation-status]'), 'moss_present escaped merged mode');
  passed.push('moss_present follows collapsed/merged modes and manual expand');

  state = { id: 'doc', path: file.path, content: disk, originalContent: disk, owner: '', generation: 1, sequence: 1, dirty: false };
  api.agentDesktop.previewDocument = {
    on, acquire: async ({ clientId }: any) => { state.owner = 'sender:' + clientId; return { ...state, client: state.owner }; },
    update: async ({ content }: any) => { if (failNext) { failNext = false; throw new Error('temporary disconnect'); } state.content = content; state.dirty = content !== state.originalContent; state.sequence++; return { ...state }; },
    save: async () => { const content = state.content; saveEntered = true; if (gate) await gate(); disk = content; state.originalContent = content; state.content = content; state.dirty = false; state.sequence++; return { state: { ...state }, file: { ...file, content } }; },
    release: async () => { released = true; }, acknowledge: async () => ({ accepted: true }),
  };
  render(<Editor />); await until(() => Boolean(state.owner), 'Editor did not acquire'); await delay();
  failNext = true; type('failed first update'); await until(() => document.body.innerText.includes('草稿同步失败'), 'Failure did not surface');
  type('recovered draft'); await until(() => state.content === 'recovered draft', 'Failure poisoned future updates');
  let resume!: () => void; gate = () => new Promise<void>(resolve => { resume = resolve; });
  document.querySelector<HTMLButtonElement>('#save')!.click(); await until(() => saveEntered, 'Save never started');
  type('typed during save'); await delay(); resume(); gate = null;
  await until(() => state.content === 'typed during save', 'New keystrokes lost during save');
  assert(disk === 'recovered draft', 'Save captured bytes it had not flushed');
  assert(document.querySelector('textarea')!.value === 'typed during save', 'Save response replaced newer local edits');
  render(null); await until(() => released, 'Unmount did not flush/release');
  assert(state.content === 'typed during save', 'Unmount lost draft');
  passed.push('temporary update failure recovers; save preserves newer typing; unmount flushes before release');
  render(<RetryExample />); await delay();
  assert(document.body.textContent?.includes('累计等待 1.5 / 120 秒'), 'Retry allowance is missing');
  assert((document.body.textContent?.match(/模型请求重试/g) || []).length === 1, 'Repeated retry records clutter the conversation');
  assert(!document.body.textContent?.includes('本轮改动'), 'Retry record produced an empty file-change card');
  passed.push('retry status shows attempts/wait allowance once and does not create a file-change card');
  render(<Example mode="diff" />); await delay();
  await clickView('结果');
  const diff = document.querySelector('#diff-review-test')!;
  const diffCard = diff.firstElementChild!;
  assert(diffCard.getBoundingClientRect().left - diff.getBoundingClientRect().left <= 20, 'Result panel adds a second inset to the change card');
  passed.push('result panel change card has no duplicate inset');
  await reviewCompactPreview();
  passed.push('single filename header; file dropdown switches and closes; responsive navigation keeps all views reachable at 280–560px');
  await reviewOpenFromTasks();
  passed.push('image eye button exits tasks, including reopening the same image with follow off; refreshes and background events preserve tasks');
  await reviewWindowToolbars();
  passed.push('title bar toolbars at 320/440/560px on Mac/Windows; drag regions, menus, collapse, history branches, failed/aborted navigation and web fallback');
  return passed;
};
api.showPresentationExample = async (mode: string) => { render(<Example key={mode} initialView={mode === 'workspace' ? 'workspace' : 'results'} mode={mode === 'expanded' ? 'expanded' : mode === 'diff' ? 'diff' : 'collapsed'} />); await delay(); await clickView(mode === 'workspace' ? '工作区' : '结果'); await until(() => document.querySelectorAll('[aria-label^="文件："]').length === 3, 'Example not ready'); await delay(200); };
api.showRetryExample = async () => { render(<RetryExample />); await delay(200); };
