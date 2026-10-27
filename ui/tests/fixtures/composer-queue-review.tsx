import React from 'react';
import { SessionInteractions, SideQuestionPanel } from '@/components/chat/session-interactions';
import type { SessionInteraction } from '@/lib/session-interactions';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ComposerPanel } from '@/components/chat-area';
import { QueuedMessages } from '@/components/chat/queued-messages';
import { WebComposerDraft } from '@/components/web-composer-draft';
import { AppComposerContext } from '@/lib/app-composer';
import { withdrawMessage, preserveQueuedMessages, recoverQueuedMessages, type ComposerDraft, type QueuedMessage } from '@/lib/composer-queue';
import { acknowledgeDrafts, listDrafts, writeDraft, type WebDraft } from '@/lib/web-drafts';
import '@/globals.css';

const api = window as any, root = createRoot(document.getElementById('root')!);
const render = (element: React.ReactNode) => flushSync(() => root.render(element));
const delay = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function until(check: () => boolean, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await delay(20); } throw new Error(message + '\n' + JSON.stringify(latest) + '\n' + document.body.innerText); }
const agent: any = { id: 'reviewer', agentType: 'reviewer', active: true, enabled: true, effective: true, description: 'reviewer', source: 'user' };
const entry: QueuedMessage = { id: 'first', prompt: '请审阅附件', intent: 'boss', workspace: '/workspace',
  skills: [{ name: 'review', displayName: '审阅技能', source: 'user' }], agent, agentType: agent.agentType,
  files: [{ name: 'report.txt', path: '/workspace/report.txt' }],
  appSelection: { appId: 'workflow', providerId: 'workflow/flows', title: '审阅流程', ref: { id: 'flow' } } };
api.agentDesktop = {
  getInstalledSkills: async () => ({ success: true, data: entry.skills }),
  listAppCommands: async () => [], listAppResources: async () => ({ items: [], providers: [] }),
  agents: { list: async () => ({ agents: [agent] }), onChanged: () => () => {} },
  onAppsChanged: () => () => {}, onEvent: () => () => {},
  fs: { getFileMetadata: async () => ({ size: 32, name: 'report.txt', isDirectory: false }), getImageBase64: async () => '' },
};
const sends: any[] = [];
const interactions: any[] = [];
let mainStops = 0;
function InteractionHarness({ text = '补充当前任务', files = [] }: { text?: string; files?: any[] }) {
  const [value, setValue] = React.useState(text);
  const [items, setItems] = React.useState<SessionInteraction[]>([]);
  const [open, setOpen] = React.useState(false);
  const anchor = React.useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = React.useState(files);
  api.setInteractionText = setValue;
  api.closeSideWindow = () => setOpen(false);
  api.finishSideQuestion = () => setItems(list => list.map(item => item.kind === 'side_question' ? { ...item, status: 'truncated', response: '当前工具尚未返回结果。\n\n```json\n{"name":"Bash","input":{"command":"example only"}}\n```' } : item));
  api.agentDesktop.sessionInteraction = async ({ action, id }: any) => {
    if (action === 'cancel_side') setItems(list => list.map(item => item.id === id ? { ...item, status: 'cancelled' } : item));
    return { id, status: 'running' };
  };
  const send = async (kind: 'steer' | 'side_question', prompt: string, details?: any) => {
    interactions.push({ kind, prompt, details }); if (kind === 'steer') setValue('');
    setItems(list => [...list, { type: 'session_interaction', id: crypto.randomUUID(), kind, prompt, details, status: kind === 'steer' ? 'accepted' : 'running', timestamp: Date.now() }]);
  };
  return <div className="relative flex h-screen flex-col p-4">
    <div className="min-h-0 flex-1 p-4 text-sm text-muted-foreground">主任务正在处理文件…</div>
    <div ref={anchor}><SessionInteractions sessionId="interactions" items={items} busy onRestore={item => setValue(item.prompt)} />
    <ComposerPanel value={value} loading hasActiveSession sessionId="interactions" workspace="/workspace" sessionAgentMode="local"
      composerIntent="chat" onComposerIntentChange={() => {}} onChange={setValue} permissionMode="default" onPermissionModeChange={() => {}}
      attachments={attachments} onAttachmentsChange={setAttachments} onStop={() => { mainStops++; }}
      onInteraction={send} onOpenSideQuestion={() => setOpen(true)} onAskSideQuestion={async prompt => { setOpen(true); await send('side_question', prompt); }}
      onSend={attachments => { sends.push({ text: value, files: attachments }); setValue(''); }} />
    </div><SideQuestionPanel anchorRef={anchor} sessionId="interactions" items={items} open={open} onClose={() => setOpen(false)} onSend={prompt => send('side_question', prompt)} />
  </div>;
}
let latest: ComposerDraft;
function Harness({ initial = [entry], typed = '' }: { initial?: QueuedMessage[]; typed?: string }) {
  const [draft, setDraft] = React.useState<ComposerDraft>({ text: typed, files: [], intent: 'chat', choices: { skills: [], agent: null } });
  const [queue, setQueue] = React.useState(initial);
  latest = { ...draft, queued: queue };
  const edit = (id: string) => { const result = withdrawMessage(queue, id, draft, '/workspace'); setQueue(result.queue); if (result.restored) setDraft(result.draft); };
  return <AppComposerContext.Provider value={{ selection: draft.appSelection || null, select: appSelection => setDraft(d => ({ ...d, appSelection })) }}>
    <div className="mx-auto max-w-3xl p-8">
      <button id="stop" onClick={() => setQueue(preserveQueuedMessages(queue))}>停止本轮</button>
      <button id="clear" onClick={() => setDraft({ text: '', files: [], choices: { skills: [], agent: null } })}>清空当前输入</button>
      <QueuedMessages messages={queue} onEdit={edit} onRemove={id => setQueue(items => items.filter(item => item.id !== id))} />
      <ComposerPanel value={draft.text} loading={false} hasActiveSession sessionId="queue-review" workspace="/workspace" sessionAgentMode="local"
        composerIntent={draft.intent || 'chat'} onComposerIntentChange={intent => setDraft(d => ({ ...d, intent }))}
        attachments={draft.files} onAttachmentsChange={files => setDraft(d => ({ ...d, files }))}
        choices={draft.choices} onChoicesChange={choices => setDraft(d => ({ ...d, choices }))}
        onChange={text => setDraft(d => ({ ...d, text }))} permissionMode="default" onPermissionModeChange={() => {}}
        onSend={(files, skills, selected) => { sends.push({ text: draft.text, files, skills, agent: selected, app: draft.appSelection, intent: draft.intent }); setDraft(d => ({ ...d, text: '' })); }} />
    </div>
  </AppComposerContext.Provider>;
}
function Persistence({ initial, session }: { initial: ComposerDraft; session: string }) {
  const [draft, setDraft] = React.useState(initial); latest = draft;
  api.clearPersistedDraft = () => setDraft({ text: '', files: [] });
  api.setPersistedDraft = setDraft;
  return <WebComposerDraft session={session} value={draft} restore={value => setDraft({ ...value, queued: recoverQueuedMessages(value.queued) })} />;
}
function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label);
  assert(button && !button.disabled, `Missing active button: ${label}`); button!.click();
}
api.runComposerQueueReview = async () => {
  const passed: string[] = [];
  render(<Harness key="restore" />); await delay(); click('撤回编辑');
  await until(() => Boolean(document.querySelector('[aria-label="移除 Agent：reviewer"]')), 'Agent selection was not restored');
  assert(document.querySelector('[aria-label="移除技能：审阅技能"]'), 'Skill selection was lost');
  assert(document.querySelector('[aria-label="移除工作流：审阅流程"]'), 'App selection was lost');
  assert(document.body.textContent?.includes('report.txt'), 'Attachment was lost');
  click('发送'); await delay();
  assert(sends.length === 1 && sends[0].skills[0].name === 'review' && sends[0].agent.agentType === 'reviewer' && sends[0].files[0].path === '/workspace/report.txt' && sends[0].intent === 'boss', 'Restored payload changed when sent');
  passed.push('撤回编辑保留文字、附件、Skill、App、Agent 与 Boss 意图，并传入发送回调');

  render(<Harness key="busy-input" typed="保留我的输入" initial={[entry, { ...entry, id: 'second', prompt: '第二条' }]} />); await delay();
  click('撤回编辑'); await delay();
  assert(latest.text === '保留我的输入' && latest.queued?.[0].status === 'draft', 'Editing overwrote current input');
  document.getElementById('stop')!.click(); await delay();
  assert(latest.queued?.every(item => item.status === 'draft') && latest.queued.length === 2, 'Stop lost or merged queued messages');
  document.getElementById('clear')!.click(); await delay(); click('编辑草稿'); await delay();
  assert(latest.text === entry.prompt && latest.queued?.length === 1, 'Restoring one draft damaged another');
  passed.push('已有输入不被覆盖；停止保留独立草稿；逐条编辑');

  const session = 'queue-persistence-test';
  render(<Persistence key="save" session={session} initial={{ text: '', files: [], queued: [{ ...entry, status: 'dispatching' }] }} />);
  await until(() => document.body.textContent !== null, 'Persistence did not mount');
  for (let i = 0; i < 100; i++) { if ((await listDrafts<ComposerDraft>(JSON.stringify(['desktop']), session)).some(row => row.value.queued?.length)) break; await delay(); }
  render(<div />); await delay();
  render(<Persistence key="reload" session={session} initial={{ text: '', files: [] }} />);
  await until(() => Boolean(latest.queued?.length), 'Draft was not restored from IndexedDB');
  assert(latest.queued![0].status === 'draft' && latest.queued![0].notice?.includes('未确认'), 'Reload resumed an ambiguous send');
  assert(latest.queued![0].skills?.[0].name === 'review' && latest.queued![0].files?.[0].name === 'report.txt', 'Persistence lost metadata');
  passed.push('实际 IndexedDB 重开恢复完整草稿，未确认发送不自动重放');
  const currentDraft = latest;
  for (let i = 0; i < 100; i++) { if ((await listDrafts<ComposerDraft>(JSON.stringify(['desktop']), session)).some(row => JSON.stringify(row.value) === JSON.stringify(currentDraft))) break; await delay(); }
  render(<div />); await delay();
  render(<Persistence key="current" session={session} initial={currentDraft} />); await delay(200);
  assert(!document.body.innerText.includes('其他已保存草稿'), 'Current draft was offered again as a separate saved draft');
  passed.push('切回会话时，当前草稿不会重复显示为另一份草稿');
  api.clearPersistedDraft(); await delay();
  for (let i = 0; i < 100; i++) { if ((await listDrafts<ComposerDraft>(JSON.stringify(['desktop']), session)).every(row => !row.value.queued?.length)) break; await delay(); }
  render(<div />); await delay();
  render(<Persistence key="cleared" session={session} initial={{ text: '', files: [] }} />); await delay(200);
  assert(!latest.queued?.length && !document.body.innerText.includes('其他已保存草稿'), 'Cleared draft reappeared after remount');
  passed.push('清空草稿后切换/重开不会恢复旧的待发送项');
  const alternateSession = 'dismiss-other-saved-draft';
  await writeDraft({ id: 'other-writer', scope: JSON.stringify(['desktop']), session: alternateSession, tab: 'other-tab', updatedAt: Date.now(), value: { text: '另一份草稿', files: [] } });
  render(<Persistence key="alternative" session={alternateSession} initial={{ text: '当前输入', files: [] }} />);
  await until(() => document.body.innerText.includes('其他已保存草稿（1）'), 'Alternative draft notice missing');
  click('收起提示'); await delay();
  assert(!document.querySelector('[role="status"]'), 'Dismiss did not hide the complete draft notice');
  assert(latest.text === '当前输入', 'Dismiss changed the current input');
  assert((await listDrafts<ComposerDraft>(JSON.stringify(['desktop']), alternateSession)).some(row => row.value.text === '另一份草稿'), 'Dismiss deleted a saved draft');
  passed.push('收起其他已保存草稿提示会关闭整个浮层，并保留当前输入和已保存草稿');
  render(<Harness key="final" initial={recoverQueuedMessages([entry, { ...entry, id: 'second', prompt: '第二条' }])} />); await delay();
  return passed;
};

const desktopScope = JSON.stringify(['desktop']);
async function stored(session: string, check: (rows: WebDraft<ComposerDraft>[]) => boolean, scope = desktopScope) {
  for (let i = 0; i < 150; i++) {
    const rows = await listDrafts<ComposerDraft>(scope, session);
    if (check(rows)) return rows;
    await delay(20);
  }
  throw new Error(`Draft storage did not settle: ${session}`);
}
const savedDraft = (session: string, id: string, value: ComposerDraft): WebDraft<ComposerDraft> =>
  ({ id, scope: desktopScope, session, tab: id, updatedAt: Date.now(), value });
const noDraftNotice = () => assert(!document.querySelector('[role="status"]'), 'An unchanged saved draft was offered again');

api.runDraftNoticeReview = async () => {
  const passed: string[] = [];
  const workflow: ComposerDraft = { text: '请帮我创建一个工作流，我的需求是：', files: [] };
  const duplicates = 'duplicate-auto-recovery';
  await writeDraft(savedDraft(duplicates, 'duplicate-older', workflow));
  await writeDraft(savedDraft(duplicates, 'duplicate-newer', { ...workflow, appSelection: null, choices: { skills: [], agent: null }, intent: 'chat', queued: [] }));
  render(<Persistence key="auto-duplicates" session={duplicates} initial={{ text: '', files: [] }} />);
  await until(() => latest.text === workflow.text, 'Automatic recovery lost the draft');
  await stored(duplicates, rows => rows.filter(row => row.id.startsWith('duplicate-')).every(row => row.noticeAcknowledged));
  noDraftNotice();
  api.clearPersistedDraft();
  await stored(duplicates, rows => rows.some(row => row.tab === sessionStorage.getItem('moss-draft-tab') && !row.value.text));
  render(<Persistence key="auto-cleared" session={duplicates} initial={{ text: '', files: [] }} />); await delay(150);
  assert(!latest.text, 'Cleared recovered content returned'); noDraftNotice();
  passed.push('相同草稿副本只恢复一次，默认字段差异不误报，清空后旧副本不再提示');

  const dismissed = 'persisted-dismissal-review';
  const old = savedDraft(dismissed, 'dismissed-copy-one', workflow);
  await writeDraft(old);
  await writeDraft(savedDraft(dismissed, 'dismissed-copy-two', workflow));
  render(<Persistence key="dismiss-duplicates" session={dismissed} initial={{ text: '保留当前输入', files: [] }} />);
  await until(() => document.body.innerText.includes('其他已保存草稿（1）'), 'Duplicate alternatives were not grouped');
  click('收起提示');
  await stored(dismissed, rows => rows.filter(row => row.id.startsWith('dismissed-copy-')).every(row => row.noticeAcknowledged));
  assert(latest.text === '保留当前输入', 'Dismiss overwrote current input'); noDraftNotice();
  await writeDraft({ ...old, updatedAt: Date.now() });
  render(<Persistence key="dismiss-remount" session={dismissed} initial={latest} />); await delay(150); noDraftNotice();
  passed.push('收起状态持久保存，切换会话或仅更新时间不再提醒，原草稿仍然保留');

  const changed = { ...old, updatedAt: Date.now(), value: { ...workflow, text: '新增的工作流需求' } };
  await writeDraft(changed);
  await acknowledgeDrafts([old]);
  assert(!(await listDrafts(desktopScope, dismissed)).find(row => row.id === old.id)?.noticeAcknowledged, 'An outdated dismissal hid another window\'s new content');
  render(<Persistence key="changed-alternative" session={dismissed} initial={latest} />);
  await until(() => document.body.innerText.includes('其他已保存草稿（1）'), 'Changed content did not show a new notice');
  click('恢复为独立草稿');
  await until(() => latest.queued?.length === 1, 'Manual recovery did not create a separate draft');
  assert(latest.text === '保留当前输入' && latest.queued?.[0].prompt === changed.value.text, 'Manual recovery changed the wrong draft');
  await stored(dismissed, rows => rows.find(row => row.id === old.id)?.noticeAcknowledged === true);
  render(<Persistence key="manual-remount" session={dismissed} initial={latest} />); await delay(150); noDraftNotice();
  api.clearPersistedDraft();
  await stored(dismissed, rows => rows.some(row => row.tab === sessionStorage.getItem('moss-draft-tab') && !row.value.text && !row.value.queued?.length));
  render(<Persistence key="manual-cleared" session={dismissed} initial={{ text: '', files: [] }} />); await delay(150); noDraftNotice();
  assert(!latest.text && !latest.queued?.length, 'Handled draft was restored a second time');
  passed.push('其他窗口修改草稿仍会提醒，过期的收起操作不吞掉新内容，手动恢复后不重复入队');

  const priorScope = JSON.stringify(['draft-user', 'draft-host', 1]);
  const scope = JSON.stringify(['draft-user', 'draft-host', 2]);
  const prior = { ...savedDraft('prior-review', 'prior-notice-review', workflow), scope: priorScope };
  await writeDraft(prior);
  api.mossWeb = { identity: { userId: 'draft-user', hostId: 'draft-host', generation: 2 } };
  render(<Persistence key="prior-notice" session="prior-review" initial={{ text: '新环境的输入', files: [] }} />);
  await until(() => document.body.innerText.includes('恢复前草稿（1）'), 'Prior environment draft was not offered');
  click('收起提示');
  await stored('prior-review', rows => rows[0]?.noticeAcknowledged === true, priorScope);
  render(<Persistence key="prior-dismissed" session="prior-review" initial={latest} />); await delay(150); noDraftNotice();
  assert((await listDrafts<ComposerDraft>(scope, 'prior-review'))[0].value.text === '新环境的输入', 'Prior notice changed the current environment draft');
  render(<div />); delete api.mossWeb;
  passed.push('恢复前草稿的收起状态也会保存，保留原环境和当前环境的内容');

  const reloadSession = 'notice-reload-review';
  await writeDraft(savedDraft(reloadSession, 'reload-alternative', workflow));
  render(<Persistence key="reload-setup" session={reloadSession} initial={{ text: '重开后保留的输入', files: [] }} />);
  await until(() => document.body.innerText.includes('其他已保存草稿（1）'), 'Reload test did not create a notice');
  click('收起提示');
  await stored(reloadSession, rows => rows.some(row => row.id === 'reload-alternative' && row.noticeAcknowledged) && rows.some(row => row.value.text === '重开后保留的输入'));
  return passed;
};

api.runDraftNoticeReloadReview = async () => {
  render(<Persistence key="after-real-reload" session="notice-reload-review" initial={{ text: '', files: [] }} />);
  await until(() => latest.text === '重开后保留的输入', 'Real page reload did not recover the saved input');
  await delay(150); noDraftNotice();
  assert((await listDrafts<ComposerDraft>(desktopScope, 'notice-reload-review')).some(row => row.id === 'reload-alternative' && row.value.text.startsWith('请帮我创建')), 'Dismiss deleted the original draft');
  return '重新加载页面或重开窗口后静默恢复输入，已收起的旧草稿不会重新弹出';
};

function sideInput(text: string) {
  const input = document.querySelector('[aria-label="侧问内容"]') as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
api.runSessionInteractionReview = async () => {
  const passed: string[] = [];
  render(<InteractionHarness key="live" />); await delay();
  assert(!document.querySelector('[aria-label="消息发送方式"]') && !document.body.textContent?.includes('下一轮'), 'Customer still needs to select a send mode');
  click('发送'); await delay();
  assert(interactions[0]?.kind === 'steer' && document.body.textContent?.includes('等待接收'), 'Supplement was queued or omitted');
  passed.push('主输入框只有发送，运行中自动补充当前任务');

  api.setInteractionText('主任务草稿保留'); await delay(); click('打开侧问'); await delay();
  const bounds = document.querySelector('[aria-label="侧问窗口"]')!.getBoundingClientRect();
  assert(bounds.bottom <= document.querySelector('[aria-label="打开侧问"]')!.getBoundingClientRect().top, 'Side window covers the main send controls');
  sideInput('当前工具完成了吗？'); await delay(); click('发送侧问'); await delay();
  assert(interactions.at(-1).kind === 'side_question' && document.body.textContent?.includes('正在回答'), 'Side question was not sent independently');
  const mainInput = [...document.querySelectorAll('textarea')].find(node => node.getAttribute('aria-label') !== '侧问内容')!;
  assert(mainInput.value === '主任务草稿保留', 'Side send erased the main draft');
  sideInput('稍后继续问'); await delay(); click('收起侧问'); await delay(); click('打开侧问'); await delay();
  assert((document.querySelector('[aria-label="侧问内容"]') as HTMLTextAreaElement).value === '稍后继续问', 'Closing window erased side draft');
  click('取消侧问'); await delay(); assert(mainStops === 0 && document.body.textContent?.includes('已取消'), 'Cancel affected main task');
  passed.push('底部入口打开独立侧问窗口，主草稿保留，收起保留侧问草稿，取消不影响主任务');

  click('收起侧问'); await delay(); api.setInteractionText('/btw 解释一下'); await delay(); click('发送'); await delay();
  assert(interactions.at(-1).prompt === '解释一下', '/btw was sent as a main prompt');
  api.finishSideQuestion(); await delay();
  await until(() => Boolean(document.body.textContent?.includes('回答已截断') && document.body.textContent?.includes('example only')), 'Partial answer or code content missing');
  assert(!document.body.textContent?.includes('本轮改动'), 'Side question created a file change card');
  passed.push('/btw 自动打开独立窗口，截断状态与代码展示正常');

  render(<InteractionHarness key="attachments" text="请参考附件继续" files={[{ name: 'report.txt', path: '/workspace/report.txt' }]} />); await delay();
  click('发送'); await delay();
  assert(interactions.at(-1).kind === 'steer' && interactions.at(-1).details.files[0].path === '/workspace/report.txt', 'Attachment did not enter the current-task supplement');
  passed.push('运行中附件随同补充发送，不要求客户选择发送方式');
  render(<InteractionHarness key="screenshot" text="主任务继续处理，保留这段草稿" />); await delay();
  click('打开侧问'); await delay(); sideInput('这一步为什么这样处理？'); await delay(); click('发送侧问'); await delay(); api.finishSideQuestion(); await delay();
  return passed;
};
