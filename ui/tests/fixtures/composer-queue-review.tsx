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
import { listDrafts } from '@/lib/web-drafts';
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
  render(<Harness key="final" initial={recoverQueuedMessages([entry, { ...entry, id: 'second', prompt: '第二条' }])} />); await delay();
  return passed;
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
