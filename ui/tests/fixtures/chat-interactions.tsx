import React from 'react';
import { ComposerPanel } from '@/components/chat-area';
import { MessageListPane } from '@/components/chat/message-list';
import { buildMainChatRenderMessagesFromHistory } from '@/lib/agent-transcript';
import { AppSidebar } from '@/components/app-sidebar';

export async function runChatInteractionChecks(render: (view: React.ReactNode) => void, nativeFile: File) {
  const api = window as any;
  const passed: string[] = [];
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const delay = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(condition: () => boolean, message: string) {
    for (let i = 0; i < 100; i++) { if (condition()) return; await delay(30); }
    throw new Error(message);
  }
  async function moveTo(element: Element) {
    const rect = element.getBoundingClientRect();
    const point = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    await api.fixtureFiles.input({ type: 'mouseMove', ...point });
    return point;
  }
  async function click(element: Element) {
    const point = await moveTo(element);
    await api.fixtureFiles.input({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    await api.fixtureFiles.input({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  }
  async function press(keyCode: string) {
    await api.fixtureFiles.input({ type: 'keyDown', keyCode });
    if (keyCode === 'Enter') await api.fixtureFiles.input({ type: 'char', keyCode: '\r' });
    await api.fixtureFiles.input({ type: 'keyUp', keyCode });
  }
  let sent: any[] = [], previewed = '', reads: any[] = [];
  const path = api.fixtureFiles.getPathForFile(nativeFile);
  assert(path.endsWith('报告 (native).txt'), 'Electron native File path was not resolved');
  const fs = { getPathForFile: api.fixtureFiles.getPathForFile, getFileMetadata: async () => ({ size: 12, isFile: true }),
    getImageBase64: async () => null, createTempFile: async (name: string) => `/tmp/fixture-${name}`, writeFile: async () => true };
  api.agentDesktop = {
    fs, onAppsChanged: () => () => {}, onEvent: () => () => {}, listAppResources: async () => ({ providers: [], items: [] }),
    listAppCommands: async () => [], getTurnChanges: async () => ({ turns: [], rewind: { supported: false } }),
    preview: { resolveFiles: async () => [], readFile: async ({ filePath }: any) => { previewed = filePath; return { path: filePath, content: 'file', metadata: {} }; }, open: async () => ({ ok: true }) },
    pickFiles: async () => [{ path, name: nativeFile.name }],
    getCompactionRequest: async (payload: any) => { reads.push(payload); return { request: { id: 'request-1', content: { system: 'actual system', messages: [{ role: 'user', content: 'actual request summary' }] } } }; },
  };
  function Composer({ active = false, sessionId = 's' }: { active?: boolean; sessionId?: string }) {
    const [attachments, setAttachments] = React.useState<any[]>([]);
    return <div style={{ width: 760, padding: 24 }}><ComposerPanel value="" loading={false} composerIntent="chat" hasActiveSession={active}
      sessionId={active ? sessionId : undefined} attachments={attachments} onAttachmentsChange={setAttachments}
      permissionMode="default" onPermissionModeChange={() => {}} onChange={() => {}} onComposerIntentChange={() => {}}
      onSend={files => { sent.push(files); }} /></div>;
  }
  const transfer = (file = nativeFile) => { const data = new DataTransfer(); data.items.add(file); return data; };
  const drop = (data: DataTransfer) => document.querySelector('textarea')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  for (const active of [false, true]) {
    render(<Composer key={String(active)} active={active} />); await delay();
    drop(transfer());
    await waitFor(() => document.querySelectorAll('[data-file-attachment]').length === 1, 'dropped native file did not appear');
    drop(transfer()); await delay();
    assert(document.querySelectorAll('[data-file-attachment]').length === 1, 'duplicate file was added');
    await api.fixtureFiles.capture(active ? 'session-attachment' : 'home-attachment');
    document.querySelector<HTMLButtonElement>(`button[aria-label="预览 ${nativeFile.name}"]`)!.click();
    await waitFor(() => previewed === path, 'file preview did not receive the real path');
    const send = [...document.querySelectorAll('button')].find(button => button.textContent === '发送')!;
    send.click(); await delay();
    assert(sent.at(-1)?.[0].path === path, 'send lost the file reference');
    assert(!document.querySelector('[data-file-attachment]'), 'sent attachment was not cleared');
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer(new File(['a,b'], 'table.csv')) });
    document.querySelector('textarea')!.dispatchEvent(paste);
    assert(paste.defaultPrevented, 'file paste was not consumed synchronously');
    await waitFor(() => Boolean(document.querySelector('[data-file-attachment]')), 'pasted file did not appear');
    document.querySelector<HTMLButtonElement>('button[aria-label="移除 table.csv"]')!.click(); await delay();
    assert(!document.querySelector('[data-file-attachment]'), 'remove failed');
  }
  passed.push('home and session composers resolve native drag paths, deduplicate, preview, send, paste and remove');

  // An asynchronous import must never move into another session's draft.
  render(<Composer key="switch" active sessionId="one" />); await delay();
  let resolveMetadata: (value: any) => void = () => {};
  fs.getFileMetadata = () => new Promise(resolve => { resolveMetadata = resolve; });
  drop(transfer()); await delay();
  render(<Composer key="switch" active sessionId="two" />); await delay();
  resolveMetadata({ size: 1, isFile: true }); await delay();
  assert(!document.querySelector('[data-file-attachment]'), 'pending import leaked into another session');
  fs.getFileMetadata = async () => ({ size: 12, isFile: true });
  passed.push('changing sessions discards pending file imports');

  const context = { version: 1, entries: [{ id: 'summary', kind: 'summary', role: 'user', content: '这是一段真实的压缩摘要。继续完成文件导入与导航。' },
    { id: 'kept', kind: 'preserved', role: 'assistant', content: '保留的原始消息' }] };
  const history: any[] = [];
  for (let i = 0; i < 140; i++) {
    history.push({ type: 'user', uuid: `u${i}`, prompt: `第 ${i} 轮：检查会话导航。` }, { type: 'assistant', message: { content: [{ type: 'text', text: `第 ${i} 轮回复。` }] } });
    if (i === 10 || i === 70) history.push({ type: 'system', subtype: 'compact_boundary', uuid: `b${i}`, compact_metadata: { trigger: i === 10 ? 'auto' : 'manual', pre_tokens: 120000, context } });
  }
  const messages = buildMainChatRenderMessagesFromHistory(history);
  const conversation = (sessionId: string, height = 650) => <><div style={{ width: 900, height }}><MessageListPane className="h-full" sessionId={sessionId} messages={messages} /></div><input aria-label="会话草稿" /></>;
  render(conversation('s')); await delay(200);
  const compactTrigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="压缩记录，共 2 次"]')!;
  const compactMenu = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="压缩记录"][data-state="open"]');
  const compactVisible = (id: string) => {
    const rect = document.querySelector(`[data-compaction-id="${id}"]`)?.getBoundingClientRect();
    const viewport = document.querySelector('[data-virtuoso-scroller]')!.getBoundingClientRect();
    return Boolean(rect && rect.height > 0 && rect.top >= viewport.top && rect.bottom <= viewport.bottom);
  };
  const triggerRect = compactTrigger().getBoundingClientRect();
  const viewportRect = document.querySelector('[data-virtuoso-scroller]')!.getBoundingClientRect();
  const rail = document.querySelector('nav[aria-label="对话导航"]')!;
  assert(viewportRect.height === 650, 'compact navigation still takes a separate toolbar row');
  assert(viewportRect.right - triggerRect.right < 16 && triggerRect.top - viewportRect.top < 16, 'compact icon is not at the upper right');
  assert(triggerRect.bottom < rail.getBoundingClientRect().top, 'compact icon overlaps the conversation rail');
  assert(rail.querySelectorAll('button').length === 140 && rail.querySelectorAll('[data-turn-number]').length === 140, 'compact markers remain on the turn rail');
  assert(!document.querySelector('select[aria-label="查看压缩记录"]') && !document.body.textContent!.includes('跳到最近压缩'), 'old compact toolbar remains');
  const draft = document.querySelector<HTMLInputElement>('input[aria-label="会话草稿"]')!;
  draft.focus({ preventScroll: true });
  await moveTo(compactTrigger());
  await waitFor(() => Boolean(compactMenu()), 'hover did not open compact history');
  assert(document.activeElement === draft, 'hover stole input focus');
  const entries = [...compactMenu()!.querySelectorAll('button')];
  assert(entries.length === 2 && entries[0].textContent!.includes('最近'), 'compact history is missing records or newest-first ordering');
  const menuRect = compactMenu()!.getBoundingClientRect();
  await api.fixtureFiles.input({ type: 'mouseMove', x: Math.round(triggerRect.left + triggerRect.width / 2), y: Math.round((triggerRect.bottom + menuRect.top) / 2) });
  await delay(60);
  await moveTo(entries[0]); await delay(250);
  assert(Boolean(compactMenu()), 'hover menu closed while moving from icon into history');
  await api.fixtureFiles.capture('compact-navigation');
  await click(entries[0]);
  await waitFor(() => compactVisible('b70'), 'latest compact jump failed in virtual history');
  await waitFor(() => !compactMenu(), 'selecting a compact did not close the menu');
  const marker = document.querySelector('[data-compaction-id="b70"]')!;
  marker.querySelector<HTMLButtonElement>('button')!.click();
  await waitFor(() => Boolean(document.querySelector('dialog[open]')), 'compact drawer did not open');
  assert(document.querySelector('dialog')!.textContent!.includes('这是一段真实的压缩摘要'), 'summary was not shown');
  await api.fixtureFiles.capture('compact-summary');
  [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === '实际模型输入')!.click();
  await waitFor(() => document.querySelector('dialog')!.textContent!.includes('actual system'), 'actual request was not shown');
  assert(reads.at(-1).boundaryId === 'b70', 'wrong request association');
  await api.fixtureFiles.capture('compact-request');
  document.querySelector<HTMLButtonElement>('button[aria-label="跳转到压缩位置"]')!.click(); await delay();
  assert(!document.querySelector('dialog[open]'), 'locating did not close the drawer');
  await moveTo(compactTrigger());
  await waitFor(() => Boolean(compactMenu()), 'compact history did not reopen');
  await click(compactMenu()!.querySelector('[aria-label="跳到第 1 次压缩"]')!);
  await waitFor(() => compactVisible('b10'), 'older compact jump failed');
  await delay(250);
  assert(compactVisible('b10'), 'compact jump was pulled back to the bottom');
  passed.push('virtualized conversation locates both compactions, opens persisted summaries and associates actual requests');

  await moveTo(compactTrigger());
  await waitFor(() => Boolean(compactMenu()), 'compact hover failed');
  await click(compactTrigger()); await delay();
  assert(Boolean(compactMenu()), 'clicking the hovered icon unexpectedly closed its menu');
  await moveTo(compactMenu()!);
  await api.fixtureFiles.input({ type: 'mouseMove', x: 850, y: 600 });
  await waitFor(() => !compactMenu(), 'compact menu did not close on pointer leave');
  compactTrigger().focus();
  await press('Space');
  await waitFor(() => Boolean(compactMenu()), 'keyboard did not open compact history');
  await waitFor(() => document.activeElement === compactMenu()?.querySelector('button'), 'keyboard opening did not focus the latest compact');
  await press('Escape');
  await waitFor(() => !compactMenu(), 'Escape did not close compact history');
  await waitFor(() => document.activeElement === compactTrigger(), 'Escape did not restore keyboard focus');
  await press('Space');
  await waitFor(() => Boolean(compactMenu()), 'keyboard did not reopen compact history');
  await waitFor(() => document.activeElement === compactMenu()?.querySelector('button'), 'keyboard reopening did not focus the latest compact');
  await press('Enter');
  await waitFor(() => compactVisible('b70'), 'keyboard selection did not locate the latest compact');
  await waitFor(() => !compactMenu() && document.activeElement === compactTrigger(), 'keyboard selection did not close history and restore focus');
  await moveTo(draft); await delay();
  await moveTo(compactTrigger());
  await waitFor(() => Boolean(compactMenu()), 'compact history did not open before session switch');
  render(conversation('another-session')); await delay();
  assert(!compactMenu(), 'compact history remained open after switching sessions');
  render(conversation('another-session', 180)); await delay();
  assert(compactTrigger().getBoundingClientRect().bottom < document.querySelector('nav[aria-label="对话导航"]')!.getBoundingClientRect().top, 'compact icon overlaps the rail in a short pane');
  passed.push('compact icon has no toolbar or rail overlap; hover preserves focus, supports pointer transit, click, keyboard and session changes');

  const shortMessages = buildMainChatRenderMessagesFromHistory([...history.slice(0, 4), history.find(event => event.uuid === 'b10')]);
  render(<div style={{ width: 360, height: 360 }}><MessageListPane className="h-full" sessionId="short" messages={shortMessages} /></div>); await delay(200);
  const shortTrigger = document.querySelector('button[aria-label="压缩记录，共 1 次"]')!;
  assert(Boolean(shortTrigger) && !document.querySelector('nav[aria-label="对话导航"]'), 'short conversation did not keep the compact icon independent from the turn rail');
  const body = document.querySelector('[data-message-body="user"]')!;
  assert(body.getBoundingClientRect().right <= shortTrigger.getBoundingClientRect().left, 'compact icon covers message content in a narrow pane');
  await api.fixtureFiles.capture('compact-navigation-narrow');
  render(<div style={{ width: 360, height: 360 }}><MessageListPane className="h-full" sessionId="empty" messages={[]} /></div>); await delay();
  assert(!document.querySelector('button[aria-label^="压缩记录"]'), 'empty conversation shows compact navigation');
  passed.push('compact navigation fits narrow and short conversations and is absent without compact records');

  render(<div style={{ width: 240, height: 650 }}><AppSidebar sessions={[]} apps={[{ id: 'example', name: 'example', displayName: '示例应用', enabled: true, hasUi: true,
    icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#4678c8"/></svg>') } as any]}
    activeSessionId={null} activeView="chat" projectsCount={0} themeMode="light" collapsed={false} searchQuery=""
    onChangeView={() => {}} onChangeTheme={() => {}} onSelectSession={() => {}} onLaunchApp={() => {}} onNewSession={() => {}} onDeleteSession={() => {}}
    onRenameSession={() => {}} onTogglePin={() => {}} onSearchChange={() => {}} /></div>);
  await delay();
  const more = document.querySelector<HTMLButtonElement>('button[aria-label="更多功能"]')!;
  more.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', isPrimary: true }));
  await waitFor(() => Boolean(document.querySelector('[data-app-id="example"] img')), 'More menu did not render App icon');
  const icon = document.querySelector<HTMLImageElement>('[data-app-id="example"] img')!;
  await waitFor(() => icon.naturalWidth > 0, 'App SVG icon failed to load');
  await api.fixtureFiles.capture('app-more-icon');
  passed.push('More menu loads the App manifest SVG icon');
  render(null);
  return passed;
}
