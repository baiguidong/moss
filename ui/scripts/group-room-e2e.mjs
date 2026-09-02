import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';

const cdpBaseUrl = process.env.MOSS_CDP_URL || 'http://127.0.0.1:9222';
const outputDir = process.env.MOSS_GROUP_E2E_OUTPUT || '/tmp/moss-group-room-e2e';
const logProgress = (...parts) => {
  if (process.env.MOSS_GROUP_E2E_VERBOSE === '1') console.error('[group-room-e2e]', ...parts);
};

class CdpClient {
  #id = 0;
  #pending = new Map();
  #socket;
  exceptions = [];

  static async connect() {
    const targets = await fetch(`${cdpBaseUrl}/json`).then((response) => response.json());
    const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('127.0.0.1'));
    if (!target?.webSocketDebuggerUrl) throw new Error('Moss renderer CDP target is unavailable.');
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Page.bringToFront');
    return client;
  }

  constructor(url) {
    this.ready = new Promise((resolve, reject) => {
      this.#socket = new WebSocket(url);
      this.#socket.addEventListener('open', resolve, { once: true });
      this.#socket.addEventListener('error', reject, { once: true });
      this.#socket.addEventListener('message', (message) => {
        const payload = JSON.parse(String(message.data));
        if (payload.id) {
          const pending = this.#pending.get(payload.id);
          if (!pending) return;
          this.#pending.delete(payload.id);
          if (payload.error) pending.reject(new Error(payload.error.message));
          else pending.resolve(payload.result);
          return;
        }
        if (payload.method === 'Runtime.exceptionThrown') {
          const details = payload.params?.exceptionDetails || {};
          this.exceptions.push(
            details.exception?.description
            || details.exception?.value
            || details.stackTrace?.callFrames?.map((frame) => `${frame.functionName}@${frame.url}:${frame.lineNumber}`).join('\n')
            || details.text
            || 'Renderer exception',
          );
        }
      });
    });
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  }

  async screenshot(name) {
    await fsp.mkdir(outputDir, { recursive: true });
    const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const filePath = path.join(outputDir, name);
    await fsp.writeFile(filePath, Buffer.from(result.data, 'base64'));
    return filePath;
  }

  close() { this.#socket.close(); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(client, expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function textMatcher(text, exact = true) {
  const content = `(element.textContent || '').trim()`;
  return exact
    ? `(${content} === ${JSON.stringify(text)})`
    : `(${content}.includes(${JSON.stringify(text)}))`;
}

async function clickText(client, text, { exact = true, selector = 'button' } = {}) {
  const clicked = await client.evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((element) => ${textMatcher(text, exact)} && element.offsetParent !== null && !element.disabled);
    if (!element) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Visible ${selector} not found: ${text}`);
}

async function clickTitle(client, title) {
  const clicked = await client.evaluate(`(() => {
    const element = [...document.querySelectorAll('[title]')]
      .find((element) => element.getAttribute('title') === ${JSON.stringify(title)} && element.offsetParent !== null && !element.disabled);
    if (!element) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Visible control not found: ${title}`);
}

async function clickAriaLabel(client, label) {
  const clicked = await client.evaluate(`(() => {
    const element = [...document.querySelectorAll('[aria-label]')]
      .find((entry) => entry.getAttribute('aria-label') === ${JSON.stringify(label)} && entry.offsetParent !== null && !entry.disabled);
    if (!element) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Visible control not found: ${label}`);
}

async function openResourcePicker(client, title) {
  const clicked = await client.evaluate(`(() => {
    const label = [...document.querySelectorAll('div')]
      .find((element) => (element.textContent || '').trim() === ${JSON.stringify(title)} && element.offsetParent !== null);
    const section = label?.parentElement?.parentElement?.parentElement;
    const button = section ? [...section.querySelectorAll('button')]
      .find((element) => (element.textContent || '').trim() === '选择' && element.offsetParent !== null && !element.disabled) : null;
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Resource picker not found: ${title}`);
}

async function chooseResource(client, name) {
  await waitFor(client, `[...document.querySelectorAll('button')].some((element) => (element.textContent || '').includes(${JSON.stringify(name)}) && element.offsetParent !== null && !element.disabled)`, `resource option ${name}`);
  await clickText(client, name, { exact: false });
}

async function setValue(client, placeholder, value) {
  const changed = await client.evaluate(`(() => {
    const element = [...document.querySelectorAll('input, textarea')]
      .find((element) => element.getAttribute('placeholder') === ${JSON.stringify(placeholder)} && element.offsetParent !== null);
    if (!element) return false;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(changed, true, `Visible field not found: ${placeholder}`);
}

async function setSelect(client, ariaLabel, value) {
  const changed = await client.evaluate(`(() => {
    const element = [...document.querySelectorAll('select')]
      .find((entry) => entry.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)} && entry.offsetParent !== null);
    if (!element) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(changed, true, `Visible select not found: ${ariaLabel}`);
}

async function readFixedGroupRoomComposerMetrics(client) {
  const before = await client.evaluate(`(() => {
    const composer = document.querySelector('[data-group-room-composer]');
    const messageRegion = document.querySelector('[data-group-room-message-scroll]');
    const scroller = messageRegion?.querySelector('[data-virtuoso-scroller="true"]')
      || messageRegion?.querySelector('[data-slot="scroll-area-viewport"]');
    if (!composer || !scroller) return null;
    const composerRect = composer.getBoundingClientRect();
    const beforeScrollTop = scroller.scrollTop;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = beforeScrollTop > maxScrollTop / 2 ? 0 : maxScrollTop;
    return { top: composerRect.top, bottom: composerRect.bottom, beforeScrollTop, maxScrollTop };
  })()`);
  if (!before) return null;
  await sleep(100);
  return client.evaluate(`(() => {
    const composer = document.querySelector('[data-group-room-composer]');
    const messageRegion = document.querySelector('[data-group-room-message-scroll]');
    const scroller = messageRegion?.querySelector('[data-virtuoso-scroller="true"]')
      || messageRegion?.querySelector('[data-slot="scroll-area-viewport"]');
    const chat = document.querySelector('[data-group-room-chat]');
    if (!composer || !scroller || !chat) return null;
    const after = composer.getBoundingClientRect();
    const chatRect = chat.getBoundingClientRect();
    return {
      topDelta: Math.round(Math.abs(${before.top} - after.top)),
      bottomDelta: Math.round(Math.abs(${before.bottom} - after.bottom)),
      bottomGap: Math.round(Math.abs(chatRect.bottom - after.bottom)),
      scrollable: ${before.maxScrollTop} > 1,
      didScroll: Math.abs(scroller.scrollTop - ${before.beforeScrollTop}) > 1,
      bodyScrollTop: document.scrollingElement?.scrollTop || 0,
    };
  })()`);
}

async function readGroupRoomMessageOverflow(client) {
  return client.evaluate(`(() => {
    const messageRegion = document.querySelector('[data-group-room-message-scroll]');
    const scroller = messageRegion?.querySelector('[data-virtuoso-scroller="true"]')
      || messageRegion?.querySelector('[data-slot="scroll-area-viewport"]');
    if (!messageRegion || !scroller) return null;
    const regionRect = messageRegion.getBoundingClientRect();
    return {
      overflow: Math.max(0, Math.round(scroller.scrollWidth - scroller.clientWidth)),
      insideViewport: regionRect.left >= 0 && regionRect.right <= innerWidth,
    };
  })()`);
}

function assertFixedGroupRoomComposer(metrics, view) {
  assert.deepEqual(
    metrics,
    { topDelta: 0, bottomDelta: 0, bottomGap: 0, scrollable: true, didScroll: true, bodyScrollTop: 0 },
    `Group Room composer is not fixed in the ${view} view: ${JSON.stringify(metrics)}`,
  );
}

async function api(client, method, argument) {
  const result = await client.evaluate(`window.agentDesktop.groupRooms[${JSON.stringify(method)}](${argument === undefined ? '' : JSON.stringify(argument)})`);
  if (!result?.success) throw new Error(result?.error || `Group Room API failed: ${method}`);
  return result.data;
}

async function uiSmoke(client) {
  await clickText(client, '群聊');
  await sleep(300);
  const enableVisible = await client.evaluate(`[...document.querySelectorAll('button')].some((element) => (element.textContent || '').trim() === '启用' && element.offsetParent !== null)`);
  if (enableVisible) {
    await clickText(client, '启用');
    await waitFor(client, `document.body.innerText.includes('新建群聊') || document.body.innerText.includes('群聊')`, 'Group Room enablement');
  }

  for (const room of await api(client, 'list')) {
    if (room.title.startsWith('[E2E]')) await api(client, 'delete', { roomId: room.id });
  }
  await sleep(300);
  const createVisible = await client.evaluate(`document.body.innerText.includes('新建群聊')`);
  if (createVisible) {
    const closeVisible = await client.evaluate(`[...document.querySelectorAll('[title="关闭"]')].some((element) => element.offsetParent !== null)`);
    if (closeVisible) await clickTitle(client, '关闭');
  }
  await clickTitle(client, '新建群聊');
  await waitFor(client, `document.body.innerText.includes('新建群聊')`, 'room creation form');

  const resources = await api(client, 'listResources');
  const expert = resources.inviteables.find((entry) => entry.type === 'agent');
  const skill = resources.skills.find((entry) => entry.command === 'summarize') || resources.skills[0];
  const connector = resources.connectors.find((entry) => entry.hasMcp) || resources.connectors[0];
  assert.ok(expert, 'No installed individual expert is available.');
  assert.ok(skill, 'No installed non-fork skill is available.');

  await setValue(client, '房间名称（可选）', '[E2E] 自定义成员与技能');
  await setValue(client, '输入讨论议题', '验证自定义 prompt、专家邀请与成员技能授权。');
  await setValue(client, '输入或选择工作区', process.cwd());
  await setSelect(client, '群权限', 'allow-all');
  await openResourcePicker(client, '添加专家或专家团');
  await chooseResource(client, expert.displayName);
  await clickText(client, '确定');
  await clickText(client, '添加');
  await setValue(client, '成员 1 名称', 'E2E 质疑者');
  await setValue(client, '角色（可选）', '审查假设与证据');
  await setValue(client, '输入该成员的职责、判断标准和输出要求', '只检查论据是否充分，指出一个关键风险，并给出可验证的改进建议。');
  await openResourcePicker(client, '成员技能');
  await chooseResource(client, skill.name);
  await clickText(client, '确定');
  if (connector) {
    await openResourcePicker(client, '添加个人授权连接器');
    await chooseResource(client, connector.name);
    await clickText(client, '确定');
  }
  await clickText(client, '创建');

  await waitFor(client, `document.body.innerText.includes('[E2E] 自定义成员与技能') && document.body.innerText.includes('E2E 质疑者')`, 'created room');
  const room = (await api(client, 'list')).find((entry) => entry.title === '[E2E] 自定义成员与技能');
  assert.ok(room, 'Created room was not persisted.');
  let detail = await api(client, 'get', { roomId: room.id });
  assert.equal(detail.members.length, 2);
  assert.equal(detail.settings.permissionMode, 'allow-all');
  const custom = detail.members.find((member) => member.source.kind === 'custom');
  assert.ok(custom, 'Custom member was not persisted.');
  assert.deepEqual(custom.grants.skills, [skill.command]);
  if (connector) assert.equal(custom.grants.connectors[0]?.id, connector.id);

  const orchestrationControls = await client.evaluate(`(() => ({
    discussion: [...document.querySelectorAll('button')].some((element) => (element.textContent || '').trim() === '讨论' && element.offsetParent !== null),
    parallel: [...document.querySelectorAll('button')].some((element) => (element.textContent || '').trim() === '并行' && element.offsetParent !== null),
    rounds: Boolean(document.querySelector('[aria-label="讨论轮数"]')),
    recipients: document.body.innerText.includes('发送给 '),
    moderatorHint: document.body.innerText.includes('消息将发送给主持人'),
  }))()`);
  assert.deepEqual(orchestrationControls, {
    discussion: false, parallel: false, rounds: false, recipients: false, moderatorHint: true,
  });
  assert.equal(Object.hasOwn(detail.settings, 'mode'), false);
  assert.equal(Object.hasOwn(detail.settings, 'discussionRounds'), false);

  await clickText(client, 'E2E 质疑者');
  await waitFor(client, `document.body.innerText.includes('暂无执行记录')`, 'central member transcript');
  await clickTitle(client, '成员资源');
  await waitFor(client, `document.body.innerText.includes('成员资源') && document.body.innerText.includes('添加技能')`, 'member resource dialog');
  if (connector) {
    detail = await api(client, 'get', { roomId: room.id });
    assert.equal(detail.members.find((member) => member.id === custom.id).grants.connectors.find((grant) => grant.id === connector.id)?.access, 'write');
  }
  await clickAriaLabel(client, `移除 ${skill.name}`);
  await clickText(client, '保存');
  await sleep(300);
  detail = await api(client, 'get', { roomId: room.id });
  assert.deepEqual(detail.members.find((member) => member.id === custom.id).grants.skills, []);
  await clickTitle(client, '成员资源');
  await openResourcePicker(client, '添加技能');
  await chooseResource(client, skill.name);
  await clickText(client, '确定');
  await clickText(client, '保存');
  await sleep(300);
  detail = await api(client, 'get', { roomId: room.id });
  assert.deepEqual(detail.members.find((member) => member.id === custom.id).grants.skills, [skill.command]);

  const screenshot = await client.screenshot('ui-smoke.png');
  await client.evaluate(`window.confirm = () => true`);
  await clickTitle(client, '返回房间');
  await clickTitle(client, '删除群聊');
  await waitFor(client, `!document.body.innerText.includes('[E2E] 自定义成员与技能')`, 'room deletion');
  assert.equal((await api(client, 'list')).some((entry) => entry.id === room.id), false);
  return { screenshot, expert: expert.displayName, skill: skill.name };
}

async function transcriptUiSmoke(client) {
  logProgress('transcript-ui: set desktop viewport');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(150);
  logProgress('transcript-ui: open rooms');
  await clickText(client, '群聊');
  await sleep(250);
  let candidate = null;
  for (const summary of await api(client, 'list')) {
    const detail = await api(client, 'get', { roomId: summary.id });
    const turn = detail.recentRuns
      .flatMap((run) => [...run.turns].reverse())
      .find((entry) => entry.trace.some((event) => event.type === 'tool_call'));
    if (turn) {
      candidate = { room: detail, turn, member: detail.members.find((member) => member.id === turn.memberId) };
      break;
    }
  }
  assert.ok(candidate?.member, 'No persisted Group Room tool transcript is available for UI verification.');
  logProgress('transcript-ui: open candidate', candidate.room.title);
  await openRoom(client, candidate.room.title);

  const roomListAlreadyCollapsed = await client.evaluate(`[...document.querySelectorAll('[title="展开群聊列表"]')].some((element) => element.offsetParent !== null)`);
  if (roomListAlreadyCollapsed) {
    await clickTitle(client, '展开群聊列表');
    await waitFor(client, `[...document.querySelectorAll('[title="折叠群聊列表"]')].some((element) => element.offsetParent !== null)`, 'initial Group Room list expansion');
  }
  await clickTitle(client, '折叠群聊列表');
  await waitFor(client, `[...document.querySelectorAll('[title="展开群聊列表"]')].some((element) => element.offsetParent !== null)`, 'collapsed Group Room list');
  const collapsedRoomListMetrics = await client.evaluate(`(() => {
    const button = [...document.querySelectorAll('[title="展开群聊列表"]')].find((element) => element.offsetParent !== null);
    const list = document.querySelector('[data-group-room-list]');
    return {
      reservedWidth: list?.getBoundingClientRect().width || 0,
      buttonInChatHeader: Boolean(button?.closest('[data-group-room-chat] header')),
    };
  })()`);
  assert.deepEqual(collapsedRoomListMetrics, { reservedWidth: 0, buttonInChatHeader: true }, 'Collapsed Group Room list still reserves a rail or its reopen button is misplaced.');
  const collapsedRoomListWidth = collapsedRoomListMetrics.reservedWidth;
  logProgress('transcript-ui: capture collapsed room');
  const collapsedRoomListScreenshot = await client.screenshot('member-transcript-room-list-collapsed.png');
  await clickTitle(client, '展开群聊列表');
  await waitFor(client, `[...document.querySelectorAll('[title="折叠群聊列表"]')].some((element) => element.offsetParent !== null)`, 'expanded Group Room list');
  const roomComposerMetrics = await readFixedGroupRoomComposerMetrics(client);
  assertFixedGroupRoomComposer(roomComposerMetrics, 'room conclusion');
  const roomMessageOverflow = await readGroupRoomMessageOverflow(client);
  assert.deepEqual(roomMessageOverflow, { overflow: 0, insideViewport: true }, `Room messages overflow horizontally: ${JSON.stringify(roomMessageOverflow)}`);
  const humanMessageAvatarCount = await client.evaluate(`document.querySelectorAll('[data-group-room-human-avatar]').length`);
  assert.ok(humanMessageAvatarCount > 0, 'Human messages do not show a user avatar.');
  logProgress('transcript-ui: room layout checked');

  const collapseVisible = await client.evaluate(`[...document.querySelectorAll('[title="收起成员"]')].some((element) => element.offsetParent !== null)`);
  assert.equal(collapseVisible, true, 'The selected room did not expand its member list.');
  await clickTitle(client, '收起成员');
  await waitFor(client, `[...document.querySelectorAll('[title="展开成员"]')].some((element) => element.offsetParent !== null)`, 'collapsed room member list');
  await clickTitle(client, '展开成员');

  await clickText(client, candidate.member.displayName);
  await waitFor(client, `Boolean(document.querySelector('[aria-label=${JSON.stringify(`${candidate.member.displayName} 执行会话`)}]'))`, 'central member transcript');
  const toolName = candidate.turn.trace.filter((event) => event.type === 'tool_call').at(-1)?.name || 'Tool';
  await waitFor(client, `document.body.innerText.includes(${JSON.stringify(toolName)})`, `shared tool display ${toolName}`);
  const desktopMetrics = await client.evaluate(`(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    transcript: Boolean(document.querySelector(${JSON.stringify(`[aria-label="${candidate.member.displayName} 执行会话"]`)})),
    rightConversationPanel: [...document.querySelectorAll('aside')].some((element) => element.getBoundingClientRect().left > innerWidth * 0.75),
    alignment: (() => {
      const transcript = document.querySelector(${JSON.stringify(`[aria-label="${candidate.member.displayName} 执行会话"]`)});
      const row = [...(transcript?.querySelectorAll('div') || [])].find((element) => element.className.includes('max-w-[1180px]') && element.className.includes('px-3'));
      const composer = document.querySelector('[data-group-room-composer-track]');
      if (!row || !composer) return null;
      const rowRect = row.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const style = getComputedStyle(row);
      return {
        leftDelta: Math.round(Math.abs(rowRect.left + parseFloat(style.paddingLeft) - composerRect.left)),
        rightDelta: Math.round(Math.abs(rowRect.right - parseFloat(style.paddingRight) - composerRect.right)),
      };
    })(),
  }))()`);
  assert.equal(desktopMetrics.documentWidth, desktopMetrics.width, 'Member transcript overflows horizontally.');
  assert.equal(desktopMetrics.transcript, true);
  assert.equal(desktopMetrics.rightConversationPanel, false, 'Legacy right-side member conversation is still visible.');
  assert.ok(desktopMetrics.alignment && desktopMetrics.alignment.leftDelta <= 1 && desktopMetrics.alignment.rightDelta <= 1, `Member transcript and composer are not aligned: ${JSON.stringify(desktopMetrics.alignment)}`);
  const memberComposerMetrics = await readFixedGroupRoomComposerMetrics(client);
  assertFixedGroupRoomComposer(memberComposerMetrics, 'member transcript');
  const memberMessageOverflow = await readGroupRoomMessageOverflow(client);
  assert.deepEqual(memberMessageOverflow, { overflow: 0, insideViewport: true }, `Member transcript overflows horizontally: ${JSON.stringify(memberMessageOverflow)}`);
  logProgress('transcript-ui: member layout checked');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 450, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  const compactComposerMetrics = await client.evaluate(`(() => {
    const chat = document.querySelector('[data-group-room-chat]')?.getBoundingClientRect();
    const composer = document.querySelector('[data-group-room-composer]')?.getBoundingClientRect();
    const textarea = document.querySelector('[data-group-room-composer] textarea')?.getBoundingClientRect();
    const controlsElement = document.querySelector('[data-group-room-controls]');
    const controls = controlsElement?.getBoundingClientRect();
    const messageRegion = document.querySelector('[data-group-room-message-scroll]')?.getBoundingClientRect();
    if (!chat || !composer || !textarea || !controls || !controlsElement || !messageRegion) return null;
    const controlCenters = [...controlsElement.children].map((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    return {
      documentFits: document.documentElement.scrollWidth === innerWidth,
      composerBottomGap: Math.round(Math.abs(chat.bottom - composer.bottom)),
      textareaVisible: textarea.top >= chat.top && textarea.bottom <= chat.bottom,
      controlsSingleLine: Math.max(...controlCenters) - Math.min(...controlCenters) <= 1,
      messageRegionVisible: messageRegion.height > 0,
    };
  })()`);
  assert.deepEqual(compactComposerMetrics, { documentFits: true, composerBottomGap: 0, textareaVisible: true, controlsSingleLine: true, messageRegionVisible: true }, `Compact Group Room composer is clipped: ${JSON.stringify(compactComposerMetrics)}`);
  logProgress('transcript-ui: compact layout checked');
  await clickTitle(client, '成员资源');
  await waitFor(client, `document.body.innerText.includes('添加个人授权连接器') && document.body.innerText.includes('添加技能')`, 'shared member resource picker');
  await clickText(client, '取消');
  const desktopScreenshot = await client.screenshot('member-transcript-desktop.png');

  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(250);
  const mobileMetrics = await client.evaluate(`(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    transcript: Boolean(document.querySelector(${JSON.stringify(`[aria-label="${candidate.member.displayName} 执行会话"]`)})),
    back: [...document.querySelectorAll('[title="返回房间"]')].some((element) => element.offsetParent !== null),
  }))()`);
  assert.equal(mobileMetrics.documentWidth, mobileMetrics.width, 'Mobile member transcript overflows horizontally.');
  assert.deepEqual({ transcript: mobileMetrics.transcript, back: mobileMetrics.back }, { transcript: true, back: true });
  const mobileScreenshot = await client.screenshot('member-transcript-mobile.png');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  return {
    roomId: candidate.room.id,
    memberId: candidate.member.id,
    toolName,
    collapsedRoomListWidth,
    collapsedRoomListScreenshot,
    roomComposerMetrics,
    memberComposerMetrics,
    roomMessageOverflow,
    memberMessageOverflow,
    humanMessageAvatarCount,
    compactComposerMetrics,
    desktopMetrics,
    mobileMetrics,
    desktopScreenshot,
    mobileScreenshot,
  };
}

async function openRoom(client, title) {
  const creating = await client.evaluate(`document.body.innerText.includes('新建群聊')`);
  if (creating) {
    await clickTitle(client, '关闭');
    await sleep(150);
  }
  const roomListCollapsed = await client.evaluate(`[...document.querySelectorAll('[title="展开群聊列表"]')].some((element) => element.offsetParent !== null)`);
  if (roomListCollapsed) {
    await clickTitle(client, '展开群聊列表');
    await sleep(180);
  }
  await clickText(client, title, { exact: false });
  await waitFor(client, `document.body.innerText.includes(${JSON.stringify(title)}) && Boolean(document.querySelector('textarea[placeholder="向主持人说明你的目标"]'))`, `room ${title}`);
}

async function waitForRoomRun(client, roomId, { approvePermissions = true, timeoutMs = 6 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let approvalCount = 0;
  while (Date.now() < deadline) {
    const permissions = await api(client, 'listPendingPermissions');
    for (const permission of permissions.filter((entry) => entry.roomId === roomId)) {
      if (!approvePermissions) throw new Error(`Unexpected permission request: ${permission.toolName}`);
      const visible = await client.evaluate(`document.body.innerText.includes('工具确认') && document.body.innerText.includes(${JSON.stringify(permission.memberName)})`);
      if (visible) await clickText(client, '允许一次');
      else await api(client, 'resolvePermission', { requestId: permission.requestId, allowed: true });
      approvalCount += 1;
      await sleep(150);
    }
    const room = await api(client, 'get', { roomId });
    if (room.status !== 'running') return { room, approvalCount };
    await sleep(350);
  }
  throw new Error(`Timed out waiting for Group Room run: ${roomId}`);
}

function latestRun(room) {
  const run = room.recentRuns[0];
  assert.ok(run, `Room has no persisted run: ${room.title}`);
  return run;
}

function assertCompleted(room) {
  const run = latestRun(room);
  assert.equal(run.status, 'completed', `${room.title}: ${run.stopReason || run.turns.map((turn) => turn.error).filter(Boolean).join('; ')}`);
  return run;
}

async function createScenarioRoom(client, input) {
  const { settings: scenarioSettings = {}, ...scenario } = input;
  return api(client, 'create', {
    workspace: process.cwd(),
    settings: {
      maxAgentTurns: 4,
      turnTimeoutMs: 3 * 60_000,
      runTimeoutMs: 5 * 60_000,
      tokenBudget: 30_000,
      summaryThresholdChars: 120_000,
      permissionMode: 'inherit',
      ...scenarioSettings,
    },
    invitationIds: [],
    customMembers: [],
    ...scenario,
  });
}

async function complexCodeDiscussion(client) {
  await clickText(client, '群聊');
  await sleep(300);
  const prefix = '[群聊复杂验收]';
  for (const room of await api(client, 'list')) {
    if (room.title.startsWith(prefix)) await api(client, 'delete', { roomId: room.id });
  }

  const room = await createScenarioRoom(client, {
    title: `${prefix} 代码审查与修复方案`,
    topic: '真实检查 Moss 群聊主持调度、权限和动态上下文，互相质疑后形成修复方案。',
    settings: {
      maxAgentTurns: 10,
      turnTimeoutMs: 15 * 60_000,
      runTimeoutMs: 45 * 60_000,
      tokenBudget: 120_000,
      summaryThresholdChars: 120_000,
      permissionMode: 'inherit',
    },
    invitationIds: ['CodeReviewExpert'],
    customMembers: [{
      displayName: '反方代码审查员',
      role: '用实际代码证据质疑方案',
      prompt: [
        '你是严格的 TypeScript/Electron 反方代码审查员。',
        '每次受主持人委派时必须至少调用一次 Bash 或 Read，检查 ui/src/group-room/group-room-controller.mjs、group-room-runtime.mjs 或 group-rooms-view.tsx 的真实代码。',
        '首次给出带文件位置的具体缺陷和修复方案；若主持人再次委派，必须阅读其他成员结论，指出一项赞同和一项质疑，再给出收敛方案。',
        '不要修改文件，公开结论控制在500字内。',
      ].join(''),
    }],
  });
  assert.equal(room.settings.permissionMode, 'inherit');
  await openRoom(client, room.title);
  await setValue(client, '向主持人说明你的目标', [
    '真实审查 Moss 群聊实现：重点检查房间权限优先级、动态委派快照、权限等待超时。',
    '请主持人按需要委派两位专家，通过 Bash/Read 查看现有代码，审查结果后再决定是否继续，并给出最终修复方案。',
  ].join(''));
  await clickTitle(client, '发送给主持人');
  await waitFor(client, `(async () => (await window.agentDesktop.groupRooms.get({roomId:${JSON.stringify(room.id)}})).data.status === 'running')()`, 'complex discussion start', 30_000);
  const runningUi = await client.evaluate(`(() => ({
    hasDiscussion: [...document.querySelectorAll('button')].some((element) => (element.textContent || '').trim() === '讨论' && element.offsetParent !== null),
    hasParallel: [...document.querySelectorAll('button')].some((element) => (element.textContent || '').trim() === '并行' && element.offsetParent !== null),
    hasModerator: [...document.querySelectorAll('button')].some((element) => (element.textContent || '').trim() === '主持' && element.offsetParent !== null),
    hasCoordinatorStatus: document.body.innerText.includes('主持人'),
    permission: [...document.querySelectorAll('select[aria-label="群权限"]')].find((element) => element.offsetParent !== null)?.value,
  }))()`);
  assert.deepEqual(runningUi, {
    hasDiscussion: false,
    hasParallel: false,
    hasModerator: false,
    hasCoordinatorStatus: true,
    permission: 'inherit',
  });
  const runningScreenshot = await client.screenshot('complex-code-discussion-running.png');

  const settled = await waitForRoomRun(client, room.id, { timeoutMs: 45 * 60_000 });
  const run = assertCompleted(settled.room);
  assert.equal(run.mode, 'orchestrated');
  assert.ok(run.turns.length >= 1);
  assert.ok(run.turns.every((turn) => !turn.assignment.includes('讨论第')));
  const trace = run.turns.flatMap((turn) => turn.trace);
  assert.ok(trace.some((event) => event.type === 'tool_call' && ['Bash', 'Read'].includes(event.name)), 'Complex discussion did not inspect real code.');
  assert.ok(!trace.some((event) => JSON.stringify(event).includes('Tool is not available in Group Rooms: Bash')), 'Bash was still rejected by Group Rooms.');
  assert.equal(settled.approvalCount, 0, 'Room inherit should carry the global allow-all mode into Group Rooms.');
  assert.equal(settled.room.messages.at(-1).authorType, 'moderator');
  assert.deepEqual(settled.room.messages[0].audience, ['moderator']);

  await clickText(client, '反方代码审查员');
  await waitFor(client, `document.body.innerText.includes('执行命令') || document.body.innerText.includes('Read') || document.body.innerText.includes('工具结果')`, 'complex execution trace');
  const completedScreenshot = await client.screenshot('complex-code-discussion-completed.png');
  return {
    roomId: room.id,
    runId: run.id,
    runningScreenshot,
    completedScreenshot,
    turns: run.turns.map((turn) => ({ memberId: turn.memberId, status: turn.status, traceEvents: turn.trace.length })),
  };
}

async function realScenarios(client) {
  await clickText(client, '群聊');
  await sleep(300);
  const prefix = '[群聊验收]';
  for (const room of await api(client, 'list')) {
    if (room.title.startsWith(prefix)) await api(client, 'delete', { roomId: room.id });
  }
  const results = [];

  const serial = await createScenarioRoom(client, {
    title: `${prefix} 1-自定义依赖质疑`,
    topic: '验证主持人按依赖关系委派，自定义成员可看到前序结论并质疑补充。',
    customMembers: [
      { displayName: '方案提出者', role: '给出最小方案', prompt: '用不超过60个汉字提出可执行方案，只输出结论。' },
      { displayName: '证据质疑者', role: '检查论据', prompt: '阅读前一位成员结论，指出一个证据缺口并补充改进，不超过60个汉字。' },
    ],
  });
  await openRoom(client, serial.title);
  await setValue(client, '向主持人说明你的目标', '议题：群聊公开区是否应隐藏工具日志？请按需要委派专家并给出结论。');
  await clickTitle(client, '发送给主持人');
  let settled = await waitForRoomRun(client, serial.id, { approvePermissions: false });
  let run = assertCompleted(settled.room);
  assert.ok(run.turns.every((turn) => turn.status === 'completed'));
  assert.equal(settled.room.messages.at(-1).authorType, 'moderator');
  results.push({ title: serial.title, runId: run.id, messages: settled.room.messages.length });

  const team = await createScenarioRoom(client, {
    title: `${prefix} 2-专家团共享上下文`,
    topic: '验证真实专家团展开、角色 prompt 与共享 charter。',
    invitationIds: ['TaxComplianceTeam'],
  });
  assert.equal(team.members.length, 6);
  assert.ok(team.members.every((member) => member.source.kind === 'expert-team'));
  await api(client, 'dispatch', {
    roomId: team.id,
    content: '电子发票归档方案有哪些关键合规点？请主持人按需要选择专家核验并汇总。',
  });
  settled = await waitForRoomRun(client, team.id, { approvePermissions: false });
  run = assertCompleted(settled.room);
  assert.equal(run.mode, 'orchestrated');
  assert.equal(settled.room.messages.at(-1).authorType, 'moderator');
  results.push({ title: team.title, runId: run.id, expandedMembers: team.members.length });

  const parallel = await createScenarioRoom(client, {
    title: `${prefix} 3-AI主持自主分工`,
    topic: '验证主持人自主分工、内部并发和稳定输出顺序。',
    invitationIds: ['CodeReviewExpert', 'DataAnalyticsReporter'],
  });
  await openRoom(client, parallel.title);
  await setValue(client, '向主持人说明你的目标', '为群聊功能做验收：请分别委派代码专家检查代码风险、数据专家检查可观测指标，审阅后统一回答，每人60字内。');
  await clickTitle(client, '发送给主持人');
  settled = await waitForRoomRun(client, parallel.id, { approvePermissions: false });
  run = assertCompleted(settled.room);
  assert.ok(run.turns.length >= 1);
  assert.equal(run.mode, 'orchestrated');
  assert.equal(settled.room.messages.at(-1).authorType, 'moderator');
  results.push({ title: parallel.title, runId: run.id, mode: run.mode, assignments: run.turns.map((turn) => turn.assignment) });

  const skillRoom = await createScenarioRoom(client, {
    title: `${prefix} 4-技能调用与权限`,
    topic: '验证自定义成员的精确技能授权和一次性工具确认。',
    settings: { permissionMode: 'ask' },
    invitationIds: ['SeniorProjectManager'],
    customMembers: [{
      displayName: '摘要执行员',
      role: '调用已授权摘要技能',
      prompt: '当任务要求时必须调用 Skill 工具中的 summarize；完成后只输出60字内结论。',
      skillIds: ['@clawhub_paudyyin/summarize'],
    }],
  });
  const skillMember = skillRoom.members.find((member) => member.source.kind === 'custom');
  await openRoom(client, skillRoom.title);
  await api(client, 'dispatch', {
    roomId: skillRoom.id,
    content: '请主持人委派“摘要执行员”调用 Skill 工具，skill=summarize，总结这段文字：群聊把公开结论与私有工具记录分离。',
  });
  settled = await waitForRoomRun(client, skillRoom.id);
  run = assertCompleted(settled.room);
  const skillTurn = run.turns.find((turn) => turn.memberId === skillMember.id);
  assert.ok(skillTurn?.trace.some((event) => event.type === 'tool_call' && event.name === 'Skill'), 'Skill tool call was not recorded.');
  assert.ok(settled.approvalCount >= 1, 'Skill permission was not requested.');
  results.push({ title: skillRoom.title, runId: run.id, approvals: settled.approvalCount, traceEvents: skillTurn.trace.length });

  const connectorRoom = await createScenarioRoom(client, {
    title: `${prefix} 5-只读连接器`,
    topic: '验证成员级连接器隔离、只读调用和一次性确认。',
    settings: { permissionMode: 'ask' },
    invitationIds: ['SeniorProjectManager'],
    customMembers: [{
      displayName: '知识库检索员',
      role: '只读检索乐享知识库',
      prompt: '必须使用已授权乐享连接器进行只读检索；禁止创建、修改或删除内容。只输出检索是否命中。',
    }],
  });
  const connectorMember = connectorRoom.members.find((member) => member.source.kind === 'custom');
  let connectorDetail = await api(client, 'updateMemberGrants', {
    roomId: connectorRoom.id,
    memberId: connectorMember.id,
    grants: { connectors: [{ id: 'lexiang', access: 'read' }], skills: [] },
    expectedRevision: connectorRoom.revision,
  });
  await openRoom(client, connectorRoom.title);
  await api(client, 'dispatch', {
    roomId: connectorRoom.id,
    content: '请主持人委派“知识库检索员”调用乐享连接器，只读搜索精确字符串 MOSS_GROUP_ROOM_E2E_NO_MATCH_20260901，不得写入任何数据。',
  });
  settled = await waitForRoomRun(client, connectorRoom.id);
  run = latestRun(settled.room);
  const ungrantedMember = connectorDetail.members.find((member) => member.id !== connectorMember.id);
  assert.deepEqual(ungrantedMember.grants.connectors, []);
  if (run.status === 'completed') {
    const connectorTurn = run.turns.find((turn) => turn.memberId === connectorMember.id);
    assert.ok(connectorTurn?.trace.some((event) => event.type === 'tool_call' && String(event.name).startsWith('mcp__lexiang__')), 'Connector tool call was not recorded.');
    assert.ok(settled.approvalCount >= 1, 'Connector permission was not requested.');
    results.push({ title: connectorRoom.title, runId: run.id, status: run.status, approvals: settled.approvalCount, traceEvents: connectorTurn.trace.length });
  } else {
    assert.equal(run.status, 'failed');
    assert.equal(settled.room.status, 'paused');
    assert.ok(run.stopReason.includes('连接器授权需要在连接器中心刷新: lexiang'));
    assert.equal(settled.room.messages.filter((message) => message.authorType === 'agent').length, 0);
    results.push({ title: connectorRoom.title, runId: run.id, status: run.status, externalAuthExpired: true });
  }

  const interruptRoom = await createScenarioRoom(client, {
    title: `${prefix} 6-用户硬中断`,
    topic: '验证内部并发运行中的用户补充、取消和隐藏未完成输出。',
    customMembers: [
      { displayName: '长任务甲', role: '持续分析', prompt: '收到任务后先检查仓库多个文件，再给结论。' },
      { displayName: '长任务乙', role: '持续复核', prompt: '收到任务后仔细复核仓库设计，再给结论。' },
    ],
  });
  await openRoom(client, interruptRoom.title);
  await api(client, 'dispatch', {
    roomId: interruptRoom.id,
    content: '请主持人同时委派“长任务甲”和“长任务乙”检查群聊模块全部文件后再回答，先不要快速下结论。',
  });
  await waitFor(client, `(async () => { const room = (await window.agentDesktop.groupRooms.get({roomId:${JSON.stringify(interruptRoom.id)}})).data; return room.status === 'running' && room.activeRun?.turns.some((turn) => turn.status === 'running'); })()`, 'delegated run start');
  await waitFor(client, `Boolean(document.querySelector('textarea[placeholder="补充约束给主持人"]'))`, 'intervention controls');
  await setValue(client, '补充约束给主持人', '停止原任务：用户已确认中断，本轮不再继续。');
  await clickTitle(client, '立即中止并记录补充');
  settled = await waitForRoomRun(client, interruptRoom.id);
  run = latestRun(settled.room);
  assert.equal(run.status, 'interrupted');
  assert.ok(run.turns.some((turn) => turn.status === 'interrupted'), 'Hard intervention did not cancel an active member turn.');
  assert.ok(settled.room.messages.some((message) => message.authorType === 'human' && message.content.includes('用户已确认中断')));
  results.push({ title: interruptRoom.title, runId: run.id, status: run.status, turnStatuses: run.turns.map((turn) => turn.status) });

  const screenshot = await client.screenshot('real-scenarios.png');
  return { screenshot, results };
}

async function resumeRealScenarios(client) {
  await clickText(client, '群聊');
  await sleep(300);
  const prefix = '[群聊验收]';
  const results = [];

  const staleConnectorSummary = (await api(client, 'list'))
    .find((room) => room.title === `${prefix} 5-只读连接器`);
  assert.ok(staleConnectorSummary, 'The authorization regression room is missing.');
  let staleConnectorRoom = await api(client, 'get', { roomId: staleConnectorSummary.id });
  const staleConnectorMember = staleConnectorRoom.members.find((member) => member.source.kind === 'custom');
  if (!latestRun(staleConnectorRoom).stopReason.includes('连接器授权需要在连接器中心刷新: lexiang')) {
    await api(client, 'dispatch', {
      roomId: staleConnectorRoom.id,
      content: '请主持人再次委派知识库检索员只读搜索 MOSS_GROUP_ROOM_E2E_NO_MATCH_20260901。不要调用登录或授权工具。',
    });
    staleConnectorRoom = (await waitForRoomRun(client, staleConnectorRoom.id, { approvePermissions: false })).room;
  }
  let settled = { room: staleConnectorRoom, approvalCount: 0 };
  let run = latestRun(settled.room);
  assert.equal(run.status, 'failed');
  assert.equal(settled.room.status, 'paused');
  assert.ok(run.stopReason.includes('连接器授权需要在连接器中心刷新: lexiang'));
  const staleFailedTurn = run.turns.find((turn) => turn.error.includes('连接器授权需要在连接器中心刷新: lexiang'));
  assert.ok(staleFailedTurn);
  results.push({ title: staleConnectorRoom.title, runId: run.id, status: run.status, error: staleFailedTurn.error });

  for (const room of await api(client, 'list')) {
    if (room.title.startsWith(`${prefix} 5b-`) || room.title === `${prefix} 6-用户硬中断`) {
      await api(client, 'delete', { roomId: room.id });
    }
  }

  const connectorId = process.env.MOSS_E2E_CONNECTOR || 'tencent-docs-oa';

  const connectorRoom = await createScenarioRoom(client, {
    title: `${prefix} 5b-有效只读连接器-${connectorId}`,
    topic: '验证已授权连接器的成员级隔离、只读调用和一次性确认。',
    settings: { permissionMode: 'ask' },
    invitationIds: ['SeniorProjectManager'],
    customMembers: [{
      displayName: '连接器检索员',
      role: `只读检索 ${connectorId}`,
      prompt: `必须使用已授权 ${connectorId} 连接器执行一次只读查询；禁止登录、创建、修改、发送或删除内容。只输出查询是否成功。`,
    }],
  });
  const connectorMember = connectorRoom.members.find((member) => member.source.kind === 'custom');
  const connectorDetail = await api(client, 'updateMemberGrants', {
    roomId: connectorRoom.id,
    memberId: connectorMember.id,
    grants: { connectors: [{ id: connectorId, access: 'read' }], skills: [] },
    expectedRevision: connectorRoom.revision,
  });
  await openRoom(client, connectorRoom.title);
  await api(client, 'dispatch', {
    roomId: connectorRoom.id,
    content: `请主持人委派“连接器检索员”调用 ${connectorId} 连接器，执行一次最小的只读列表或搜索操作；可用关键词 MOSS_GROUP_ROOM_E2E_NO_MATCH_20260901，不得写入任何数据。`,
  });
  settled = await waitForRoomRun(client, connectorRoom.id);
  run = latestRun(settled.room);
  const connectorTurn = run.turns.find((turn) => turn.memberId === connectorMember.id);
  assert.ok(connectorTurn, 'Moderator did not delegate to the requested connector member.');
  const connectorCalls = connectorTurn.trace.filter((event) => event.type === 'tool_call' && (
    String(event.name).startsWith(`mcp__${connectorId}__`)
    || ['ListMcpResourcesTool', 'ReadMcpResourceTool'].includes(event.name)
  ));
  const connectorResults = connectorTurn.trace.filter((event) => event.type === 'tool_result');
  assert.ok(connectorCalls.every((event) => !/(?:auth|login|oauth)/i.test(event.name)), 'The room agent attempted connector authentication.');
  assert.deepEqual(connectorDetail.members.find((member) => member.id !== connectorMember.id).grants.connectors, []);
  if (run.status === 'completed') {
    assert.ok(connectorCalls.length > 0, `${connectorId} connector tool call was not recorded.`);
    assert.ok(connectorResults.some((event) => !event.isError), `${connectorId} did not return a successful read result.`);
    assert.ok(settled.approvalCount >= 1, 'Connector permission was not requested.');
    results.push({ title: connectorRoom.title, runId: run.id, status: run.status, approvals: settled.approvalCount, toolNames: connectorCalls.map((event) => event.name) });
  } else {
    assert.equal(run.status, 'failed');
    assert.equal(settled.room.status, 'paused');
    assert.ok(run.stopReason.includes(`连接器授权需要在连接器中心刷新: ${connectorId}`));
    assert.equal(settled.room.messages.filter((message) => message.authorType === 'agent').length, 0);
    results.push({ title: connectorRoom.title, runId: run.id, status: run.status, externalAuthExpired: true, toolNames: connectorCalls.map((event) => event.name) });
  }

  const interruptRoom = await createScenarioRoom(client, {
    title: `${prefix} 6-用户硬中断`,
    topic: '验证内部并发运行中的用户补充、取消和隐藏未完成输出。',
    customMembers: [
      { displayName: '长任务甲', role: '持续分析', prompt: '收到任务后先检查仓库多个文件，再给结论。' },
      { displayName: '长任务乙', role: '持续复核', prompt: '收到任务后仔细复核仓库设计，再给结论。' },
    ],
  });
  await openRoom(client, interruptRoom.title);
  await api(client, 'dispatch', {
    roomId: interruptRoom.id,
    content: '请主持人同时委派“长任务甲”和“长任务乙”检查群聊模块全部文件后再回答，先不要快速下结论。',
  });
  await waitFor(client, `(async () => { const room = (await window.agentDesktop.groupRooms.get({roomId:${JSON.stringify(interruptRoom.id)}})).data; return room.status === 'running' && room.activeRun?.turns.some((turn) => turn.status === 'running'); })()`, 'delegated run start');
  await waitFor(client, `Boolean(document.querySelector('textarea[placeholder="补充约束给主持人"]'))`, 'intervention controls');
  await setValue(client, '补充约束给主持人', '停止原任务：用户已确认中断，本轮不再继续。');
  await clickTitle(client, '立即中止并记录补充');
  settled = await waitForRoomRun(client, interruptRoom.id, { approvePermissions: false });
  run = latestRun(settled.room);
  assert.equal(run.status, 'interrupted');
  assert.ok(run.turns.some((turn) => turn.status === 'interrupted'), 'Hard intervention did not cancel an active member turn.');
  assert.ok(settled.room.messages.some((message) => message.authorType === 'human' && message.content.includes('用户已确认中断')));
  assert.ok(settled.room.messages.every((message) => message.status === 'completed' && message.visibility === 'public'));
  results.push({ title: interruptRoom.title, runId: run.id, status: run.status, turnStatuses: run.turns.map((turn) => turn.status) });

  const screenshot = await client.screenshot('real-scenarios-resumed.png');
  return { screenshot, results };
}

async function uiAudit(client) {
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(150);
  await clickText(client, '群聊');
  await sleep(250);
  const screenshots = {};

  const closeVisible = await client.evaluate(`[...document.querySelectorAll('[title="关闭"]')].some((element) => element.offsetParent !== null)`);
  if (closeVisible) await clickTitle(client, '关闭');
  await clickTitle(client, '新建群聊');
  await waitFor(client, `document.body.innerText.includes('新建群聊')`, 'creation view');
  await clickText(client, '添加');
  await setValue(client, '成员 1 名称', '移动端审查员');
  await setValue(client, '角色（可选）', '检查窄屏布局');
  await setValue(client, '输入该成员的职责、判断标准和输出要求', '检查所有控件是否可见且没有重叠。');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1220, height: 780, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  const minimumWindowMetrics = await client.evaluate(`(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    visibleFields: [...document.querySelectorAll('input, textarea')].filter((element) => element.offsetParent !== null).map((element) => ({
      placeholder: element.getAttribute('placeholder'),
      left: Math.round(element.getBoundingClientRect().left),
      right: Math.round(element.getBoundingClientRect().right),
      width: Math.round(element.getBoundingClientRect().width),
    })),
  }))()`);
  assert.equal(minimumWindowMetrics.documentWidth, minimumWindowMetrics.width, 'Creation view overflows the minimum supported window.');
  assert.ok(
    minimumWindowMetrics.visibleFields.every((field) => field.left >= 0 && field.right <= minimumWindowMetrics.width && field.width >= 80),
    `A creation field is clipped or too narrow: ${JSON.stringify(minimumWindowMetrics.visibleFields)}`,
  );
  await client.evaluate(`document.querySelector('textarea[placeholder="输入该成员的职责、判断标准和输出要求"]')?.scrollIntoView({ block: 'center' })`);
  await sleep(150);
  screenshots.minimumWindowCreation = await client.screenshot('ui-create-minimum-window.png');

  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  await clickTitle(client, '关闭');
  const pausedTitle = '[群聊验收] 5-只读连接器';
  await openRoom(client, pausedTitle);
  await waitFor(client, `document.body.innerText.includes('连接器授权需要在连接器中心刷新') && document.body.innerText.includes('连接器中心')`, 'paused connector recovery banner');
  screenshots.pausedRoom = await client.screenshot('ui-paused-room.png');

  const skillTitle = '[群聊验收] 4-技能调用与权限';
  let skillRoom = (await api(client, 'get', { roomId: (await api(client, 'list')).find((entry) => entry.title === skillTitle).id }));
  if (skillRoom.status === 'running') {
    await api(client, 'stop', { roomId: skillRoom.id });
    await waitFor(client, `(async () => (await window.agentDesktop.groupRooms.get({roomId:${JSON.stringify(skillRoom.id)}})).data.status !== 'running')()`, 'previous skill run stop');
    skillRoom = await api(client, 'get', { roomId: skillRoom.id });
  }
  await openRoom(client, skillTitle);
  const skillMember = skillRoom.members.find((member) => member.source.kind === 'custom');
  const beforeMessageIds = new Set(skillRoom.messages.map((message) => message.id));
  await api(client, 'dispatch', {
    roomId: skillRoom.id,
    content: '请主持人委派“摘要执行员”调用 Skill 工具中的 summarize，总结：权限弹窗必须允许用户停止本轮。',
  });
  await waitFor(client, `[...document.querySelectorAll('button')].some((element) => (element.textContent || '').trim() === '允许一次' && element.offsetParent !== null) && [...document.querySelectorAll('button')].some((element) => (element.textContent || '').trim() === '停止当前执行' && element.offsetParent !== null)`, 'stoppable permission modal', 3 * 60_000);
  screenshots.permission = await client.screenshot('ui-permission.png');
  await clickText(client, '停止当前执行');
  const stopped = await waitForRoomRun(client, skillRoom.id, { approvePermissions: false });
  const stoppedRun = latestRun(stopped.room);
  assert.equal(stoppedRun.status, 'interrupted');
  assert.ok(stoppedRun.turns.some((turn) => turn.status === 'interrupted'));
  assert.ok(stopped.room.messages.filter((message) => !beforeMessageIds.has(message.id)).every((message) => message.authorType === 'human'));
  await waitFor(client, `![...document.querySelectorAll('button')].some((element) => (element.textContent || '').trim() === '允许一次' && element.offsetParent !== null)`, 'permission modal dismissal');
  await clickText(client, skillMember.displayName);
  await waitFor(client, `document.body.innerText.includes('执行记录') && document.body.innerText.includes('已由主持人停止')`, 'interrupted member execution record');
  screenshots.execution = await client.screenshot('ui-execution-after-stop.png');

  return { screenshots, minimumWindowMetrics, stoppedRun: { id: stoppedRun.id, status: stoppedRun.status } };
}

async function finalizeScenarioFixtures(client) {
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await clickText(client, '群聊');
  await sleep(250);
  const prefix = '[群聊验收]';
  for (const room of await api(client, 'list')) {
    if ([`${prefix} 4-技能调用与权限`, `${prefix} 5-只读连接器`].includes(room.title)) {
      await api(client, 'delete', { roomId: room.id });
    }
  }
  const resources = await api(client, 'listResources');
  const summarize = resources.skills.find((skill) => skill.command === 'summarize');
  assert.ok(summarize, 'The summarize skill is unavailable.');

  const skillRoom = await createScenarioRoom(client, {
    title: `${prefix} 4-技能调用与权限`,
    topic: '验证自定义成员的精确技能授权和一次性工具确认。',
    settings: { permissionMode: 'ask' },
    invitationIds: ['SeniorProjectManager'],
    customMembers: [{
      displayName: '摘要执行员',
      role: '调用已授权摘要技能',
      prompt: '当任务要求时必须调用 Skill 工具中的 summarize；完成后只输出60字内结论。',
      skillIds: [summarize.id],
    }],
  });
  const skillMember = skillRoom.members.find((member) => member.source.kind === 'custom');
  await openRoom(client, skillRoom.title);
  await api(client, 'dispatch', {
    roomId: skillRoom.id,
    content: '请主持人委派“摘要执行员”调用 Skill 工具，skill=summarize，总结这段文字：群聊把公开结论与私有工具记录分离。',
  });
  let settled = await waitForRoomRun(client, skillRoom.id);
  let run = assertCompleted(settled.room);
  const completedSkillTurn = run.turns.find((turn) => turn.memberId === skillMember.id);
  assert.ok(completedSkillTurn?.trace.some((event) => event.type === 'tool_call' && event.name === 'Skill'));
  assert.ok(completedSkillTurn?.trace.some((event) => event.type === 'tool_result' && !event.isError));
  assert.equal(settled.room.messages.at(-1).authorType, 'moderator');

  const authRoom = await createScenarioRoom(client, {
    title: `${prefix} 5-只读连接器`,
    topic: '验证连接器授权失效时暂停房间且不发布伪结论。',
    invitationIds: ['SeniorProjectManager'],
    customMembers: [{
      displayName: '知识库检索员',
      role: '只读检索乐享知识库',
      prompt: '必须使用已授权乐享连接器进行只读检索；禁止登录、创建、修改或删除内容。授权不可用时按群房间协议报告。',
    }],
  });
  const authMember = authRoom.members.find((member) => member.source.kind === 'custom');
  const authWithGrant = await api(client, 'updateMemberGrants', {
    roomId: authRoom.id,
    memberId: authMember.id,
    grants: { connectors: [{ id: 'lexiang', access: 'read' }], skills: [] },
    expectedRevision: authRoom.revision,
  });
  await api(client, 'dispatch', {
    roomId: authRoom.id,
    content: '请主持人委派“知识库检索员”只读搜索 MOSS_GROUP_ROOM_E2E_NO_MATCH_20260901。不要调用登录或授权工具。',
  });
  settled = await waitForRoomRun(client, authRoom.id, { approvePermissions: false });
  run = latestRun(settled.room);
  assert.equal(run.status, 'failed');
  assert.equal(settled.room.status, 'paused');
  assert.ok(run.stopReason.includes('连接器授权需要在连接器中心刷新: lexiang'));
  assert.equal(settled.room.messages.filter((message) => message.authorType === 'agent').length, 0);
  assert.deepEqual(authWithGrant.members.find((member) => member.id !== authMember.id).grants.connectors, []);

  await openRoom(client, skillRoom.title);
  await clickText(client, skillMember.displayName);
  await waitFor(client, `document.body.innerText.includes('调用技能') && document.body.innerText.includes('已完成')`, 'clean skill execution record');
  const screenshot = await client.screenshot('final-real-fixtures.png');
  return {
    screenshot,
    skillRoom: { id: skillRoom.id, runId: assertCompleted(await api(client, 'get', { roomId: skillRoom.id })).id },
    authorizationRoom: { id: authRoom.id, runId: run.id, status: run.status },
  };
}

const client = await CdpClient.connect();
try {
  await sleep(100);
  client.exceptions = [];
  const result = process.argv[2] === 'scenarios'
    ? await realScenarios(client)
    : process.argv[2] === 'complex-code'
      ? await complexCodeDiscussion(client)
    : process.argv[2] === 'scenarios-resume'
      ? await resumeRealScenarios(client)
      : process.argv[2] === 'ui-audit'
        ? await uiAudit(client)
      : process.argv[2] === 'finalize-fixtures'
          ? await finalizeScenarioFixtures(client)
        : process.argv[2] === 'transcript-ui'
          ? await transcriptUiSmoke(client)
      : await uiSmoke(client);
  assert.deepEqual(client.exceptions, []);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  client.close();
}
