import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { HostConfirmations } from '@/components/host-confirmations';
import type { AppInstallationDisclosure, HostConfirmationRequest } from '@/types';
import '@/globals.css';

const api = window as any, root = createRoot(document.getElementById('root')!);
let requests: HostConfirmationRequest[] = [], listeners = new Set<() => void>();
let responses: Array<{ id: string; revision: string; allowed: boolean }> = [], failNext = false, counter = 0;
let sample: AppInstallationDisclosure;
const delay = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 80; i++) { if (check()) return; await delay(); }
  throw new Error(message);
}
const emit = () => listeners.forEach(listener => listener());
api.agentDesktop = { confirmations: {
  list: async () => ({ revision: counter, requests: structuredClone(requests) }),
  onChanged: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  respond: async (input: { id: string; revision: string; allowed: boolean }) => {
    if (failNext) { failNext = false; throw new Error('临时连接失败，请重试。'); }
    const request = requests.find(request => request.id === input.id);
    assert(request?.revision === input.revision, 'Response lost reviewed revision');
    responses.push(input); requests = requests.filter(request => request.id !== input.id); emit();
  },
} };
const makeRequest = (disclosure?: AppInstallationDisclosure): HostConfirmationRequest => ({
  id: `install-${++counter}`, revision: `revision-${counter}`, kind: 'operation', title: '安装 Moss App',
  message: `确认“${disclosure?.name || '测试'}”提供的能力`, detail: '完整兼容说明', confirmLabel: '安装并授权', cancelLabel: '取消',
  originViewId: null, createdAt: Date.now(), expiresAt: Date.now() + 60000, ...(disclosure ? { disclosure } : {}),
});
const click = (selector: string) => {
  const button = document.querySelector<HTMLElement>(selector); assert(button, `Missing ${selector}`); button!.click();
};
async function show(disclosure = sample) {
  const item = makeRequest(disclosure); requests = [item]; emit();
  await until(() => Boolean(document.querySelector('dialog[open] table')), 'Installation review not shown');
  await delay(); return item;
}
async function tab(id: string) { click(`#install-tab-${id}`); await delay(); }
function typeSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>('[aria-label="搜索安装工具"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
api.checkInstallationBounds = async (name: string) => {
  const dialog = document.querySelector('dialog[open]')!, scroll = document.querySelector<HTMLElement>('[data-confirmation-scroll]')!;
  const button = document.querySelector<HTMLElement>('.host-confirmation-accept')!;
  const bounds = dialog.getBoundingClientRect(), footer = button.getBoundingClientRect();
  assert(bounds.top >= 0 && bounds.bottom <= innerHeight + 1, `${name}: dialog leaves viewport`);
  assert(footer.top >= 0 && footer.bottom <= innerHeight, `${name}: installation button hidden`);
  assert(scroll.scrollHeight > scroll.clientHeight, `${name}: long table does not scroll`);
  assert(scroll.scrollWidth <= scroll.clientWidth + 1, `${name}: content overflows horizontally`);
  scroll.scrollTop = scroll.scrollHeight; await delay();
  assert(scroll.scrollTop > 0, `${name}: scroll is blocked`);
  assert(button.getBoundingClientRect().top === footer.top, `${name}: footer moves with content`);
  scroll.scrollTop = 0; await delay();
  return `${name} ${innerWidth}×${innerHeight}: table scrolls; install and cancel remain visible`;
};
api.runInstallationReview = async (disclosure: AppInstallationDisclosure) => {
  sample = disclosure;
  const passed: string[] = [];
  root.render(<HostConfirmations/>); await delay();
  const item = await show();
  assert(document.querySelectorAll('table[aria-label="AI 工具清单"] tbody tr').length === sample.tools.length, 'Some tools missing');
  assert(document.activeElement?.textContent === '取消', 'Cancel is not initially focused');
  assert(!document.body.innerText.includes('云电脑'), 'Desktop incorrectly says cloud computer');
  passed.push('Desktop renders the complete tool table and initially focuses cancel');
  const chosen = sample.tools.at(-1)!;
  typeSearch(chosen.title); await delay();
  assert(document.querySelectorAll('tbody tr').length === 1 && document.querySelector('tbody')?.textContent?.includes(chosen.title), 'Search does not filter tools');
  typeSearch('no-match-xyz'); await delay();
  assert(document.body.innerText.includes('没有匹配的工具'), 'Search has no empty state');
  typeSearch(''); await delay();
  click('.install-identifiers summary'); await delay();
  assert(document.querySelector('details[open]')?.textContent?.includes(sample.tools[0].name!), 'Tool name hidden in details');
  await tab('permissions'); assert(document.querySelector('table')?.textContent?.includes(sample.permissions[0].id), 'Permission missing');
  document.getElementById('install-tab-permissions')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await delay(); assert(document.activeElement?.id === 'install-tab-skills', 'Keyboard tab navigation failed');
  assert(document.querySelector('table')?.textContent?.includes(sample.skills[0].title), 'Skill missing');
  await tab('capabilities'); assert(document.body.innerText.includes('没有声明跨 App 能力'), 'Empty capability tab missing');
  passed.push('Tool search, empty state, technical names, permissions, skills and keyboard tabs work');
  click('.host-confirmation-accept');
  await until(() => !document.querySelector('dialog[open]'), 'Accepted review did not close');
  assert(responses.at(-1)?.allowed === true && responses.at(-1)?.revision === item.revision, 'Install response is incorrect');
  await show(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await until(() => !document.querySelector('dialog[open]'), 'Escape did not cancel');
  assert(responses.at(-1)?.allowed === false, 'Escape granted installation');
  await show(); click('.host-confirmation-actions button:not(.host-confirmation-accept)');
  await until(() => !document.querySelector('dialog[open]'), 'Cancel did not close');
  assert(responses.at(-1)?.allowed === false, 'Cancel granted installation');
  passed.push('Install, cancel and Escape send the reviewed revision and correct decision');
  await show(); failNext = true; click('.host-confirmation-accept');
  await until(() => document.querySelector('[role="alert"]'), 'Error not shown');
  assert(!document.querySelector<HTMLButtonElement>('.host-confirmation-accept')?.disabled, 'Failure prevents retry');
  click('.host-confirmation-accept'); await until(() => !document.querySelector('dialog[open]'), 'Retry failed');
  await show(); const before = responses.length; requests = []; emit();
  await until(() => !document.querySelector('dialog[open]'), 'Expired request remains open');
  assert(responses.length === before, 'Expiration sent an approval');
  requests = [makeRequest()]; emit(); await delay();
  assert(!document.querySelector('dialog[open]'), 'Native desktop request duplicated in renderer');
  passed.push('Errors allow retry; expired requests close; native desktop requests are not duplicated');
  const extended = structuredClone(sample);
  extended.tools[0].description = '很长的工具说明，需要能查看完整的操作范围。'.repeat(30) + '完整说明结尾';
  extended.capabilities = {
    requires: [{ protocol: 'media.input/v1', optional: true }],
    usesTools: [{ appId: 'moss.media', tools: ['media-open'] }],
    provides: [{ protocol: 'media.output/v1', methods: [{ name: 'render', action: 'video.render', permission: 'video:write', resourceReadMethod: 'video.read' }] }],
  };
  await show(extended); click('.install-description button'); await delay();
  const expanded = document.querySelector('.install-description p')!;
  assert(expanded.textContent?.endsWith('完整说明结尾') && !expanded.classList.contains('install-excerpt'), 'Long description remains truncated');
  await tab('capabilities');
  assert(document.querySelectorAll('table').length === 3, 'Cross-App sections are not tables');
  for (const text of ['media.input/v1', '可选', 'moss.media', 'media-open', 'media.output/v1', 'video.render', 'video:write', 'video.read']) {
    assert(document.body.innerText.includes(text), `Cross-App detail omitted: ${text}`);
  }
  passed.push('Long descriptions expand fully; cross-App tables retain protocols, tools, actions and permissions');
  requests = []; emit(); await delay(); root.render(null); await delay();
  api.mossWeb = { snapshot: { viewId: 'tab-one' } }; root.render(<HostConfirmations/>); await delay();
  requests = [makeRequest()]; emit(); await until(() => Boolean(document.querySelector('dialog[open] pre')), 'Web generic confirmation missing');
  assert(document.body.innerText.includes('云电脑'), 'Web execution location missing');
  click('.host-confirmation-defer'); await until(() => !document.querySelector('dialog[open]'), 'Web defer failed');
  window.dispatchEvent(new CustomEvent('moss:show-confirmation', { detail: requests[0].id }));
  await until(() => Boolean(document.querySelector('dialog[open]')), 'Deferred review cannot reopen');
  click('.host-confirmation-accept'); await until(() => !document.querySelector('dialog[open]'), 'Web confirm failed');
  root.render(null); await delay(); delete api.mossWeb; root.render(<HostConfirmations/>); await delay();
  passed.push('Web generic confirmations still support defer, reopen and confirm');
  return passed;
};
api.showInstallationExample = async (theme: string, stress: boolean) => {
  document.documentElement.dataset.theme = theme;
  const disclosure = structuredClone(sample);
  if (stress) disclosure.tools = Array.from({ length: 120 }, (_, i) => ({ ...sample.tools[i % sample.tools.length], id: `stress-${i}`, description: '查看完整说明。'.repeat(100) }));
  await show(disclosure); await delay(150);
};
