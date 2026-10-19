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
import { usePreviewDocument } from '@/lib/use-preview-document';
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

function Example({ initialView = 'results', mode = 'collapsed' }: { initialView?: string; mode?: 'collapsed' | 'expanded' | 'merged' }) {
  const [view, setView] = React.useState(initialView), files = useAssistantOutputFiles([user, tool, reply], 'session', 'local', '/workspace', false);
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
      sessionTasks={[{ id: '1', subject: '生成三个笑话文件', status: 'completed', blockedBy: [] }, { id: '2', subject: '检查链接与预览', status: 'in_progress', blockedBy: [] }] as any}
      navigation={<PresentationToolbar snapshot={current} action={action} />} showBrowser={false} content={view === 'results' ? <PresentationContent snapshot={current} action={action} /> : undefined}/></aside>
  </div>;
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
  assert(task.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top, 'Tasks still belong inside a view');
  const taskToggle = task.querySelector('button')!; taskToggle.click(); await delay();
  [...nav.querySelectorAll('button')].find(button => button.textContent?.includes('工作区'))!.click(); await delay();
  [...nav.querySelectorAll('button')].find(button => button.textContent?.includes('结果'))!.click(); await delay();
  assert(taskToggle.getAttribute('aria-expanded') === 'false', 'Task fold lost on navigation');
  passed.push('three verified cards; one task list; task fold survives workspace/results switches');
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
  return passed;
};
api.showPresentationExample = async (mode: string) => { render(<Example key={mode} initialView={mode === 'workspace' ? 'workspace' : 'results'} mode={mode === 'expanded' ? 'expanded' : 'collapsed'} />); await until(() => document.querySelectorAll('[aria-label^="文件："]').length === 3, 'Example not ready'); await delay(200); };
api.showRetryExample = async () => { render(<RetryExample />); await delay(200); };
