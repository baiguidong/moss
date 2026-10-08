import { randomUUID } from 'node:crypto';
import { CUA_VERSION, CUA_HOST_BUNDLE_ID } from './manifest.mjs';

export function normalizeComputerUseSettings(value = {}) {
  return {
    version: 1, enabled: value?.enabled === true,
    apps: Array.isArray(value?.apps) ? value.apps
      .filter(a => typeof a?.bundleId === 'string' && /^[\w.-]{1,240}$/.test(a.bundleId))
      .map(a => ({ bundleId: a.bundleId, name: String(a.name || a.bundleId).slice(0, 240) })) : [],
  };
}
const fields = {
  get_window_state: ['query', 'include_screenshot', 'max_elements', 'max_depth'],
  click: ['element_token', 'x', 'y', 'button', 'count', 'action', 'modifier'],
  type_text: ['element_token', 'x', 'y', 'text'],
  press_key: ['element_token', 'x', 'y', 'key', 'modifiers'],
  hotkey: ['element_token', 'x', 'y', 'keys'],
  scroll: ['element_token', 'x', 'y', 'direction', 'amount', 'by'],
  set_value: ['element_token', 'value'],
};
const actions = new Set(['status', 'list_apps', 'launch_app', 'list_windows', 'end_session', ...Object.keys(fields)]);
const errorText = e => e?.inner?.reason || e?.message || String(e);
export function structured(result) {
  if (result?.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'Cua 操作失败。');
  return result?.structuredContent || {};
}
function windowNumber(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('窗口标识无效，请重新列出窗口。');
  return Number(value);
}

export class ComputerUseService {
  constructor({ host, getSettings, saveSettings, requestAccess, publish = () => {}, expectedBundleId = CUA_HOST_BUNDLE_ID }) {
    Object.assign(this, { host, getSettings, saveSettings, requestAccess, publish, expectedBundleId });
    this.phase = this.settings().enabled ? 'not-checked' : 'disabled'; this.error = ''; this.permissions = null;
    this.sessionGrants = new Map(); this.blocked = new Set(); this.snapshots = new Map();
    this.epoch = 0; this.suspended = false;
    host.onExit = message => { this.error = message; this.phase = 'error'; void this.stop('driver-exit'); };
  }
  settings() { return normalizeComputerUseSettings(this.getSettings()); }
  status() {
    return { version: CUA_VERSION, supported: this.host.supported, enabled: this.settings().enabled,
      phase: !this.settings().enabled ? 'disabled' : this.phase, permissions: this.permissions,
      active: this.owner ? { sessionId: this.owner.id, title: this.owner.title, app: this.owner.app,
        action: this.owner.action, foreground: Boolean(this.owner.foreground) } : null,
      apps: this.settings().apps,
      sessionApps: [...this.sessionGrants.entries()].flatMap(([sessionId, grants]) => [...grants].map(bundleId => ({ sessionId, bundleId }))),
      error: this.error, captureVerified: Boolean(this.captureVerified) };
  }
  changed() { this.publish(this.status()); }
  assertLocal(session) {
    if (!session?.id || session.agentMode === 'remote-direct' || session.sessionKind === 'cron'
      || session.isSubAgent || session.parentSessionId || session.activeAgentMailTurn
      || (session.originChannel && !['desktop', 'local'].includes(session.originChannel))) {
      throw new Error('电脑操控只允许本机交互式主会话使用。');
    }
  }
  guard(session, epoch = this.epoch) {
    if (!this.settings().enabled) throw new Error('请先在设置 → 工具中开启应用控制。');
    if (this.suspended || this.blocked.has(session.id) || epoch !== this.epoch) throw new Error('电脑操控已停止。请发送新的请求后继续。');
  }
  beginTurn(sessionId) { this.blocked.delete(sessionId); }
  async check({ restart = false, duringControl = false } = {}) {
    if (!this.settings().enabled || !this.host.supported) return this.status();
    if (this.owner && !duringControl) return this.status();
    if (this.checking) return this.checking;
    const epoch = this.epoch;
    this.checking = (async () => {
      this.phase = 'starting'; this.error = ''; this.changed();
      try {
        if (restart) { await this.host.stop(); this.captureVerified = false; }
        const p = structured(await this.host.call('check_permissions'));
        if (epoch !== this.epoch) return this.status();
        const health = structured(await this.host.call('health_report', { include: ['bundle_identity'] }));
        if (epoch !== this.epoch) return this.status();
        const identity = health.checks?.find(c => c.name === 'bundle_identity');
        const identityOk = p.source?.attribution === 'host' && p.source?.host_bundle_id === this.expectedBundleId
          && identity?.status === 'pass' && identity.data?.bundle_identifier === this.expectedBundleId
          && identity.data?.identity_source === 'parent_application' && identity.data?.parent_process_id === process.pid;
        this.permissions = { accessibility: p.accessibility === true, screenRecording: p.screen_recording === true,
          hostIdentity: identityOk, bundleId: identity.data?.bundle_identifier || p.source?.host_bundle_id };
        if (!identityOk) throw new Error('驱动未归属当前 Moss 应用。请从应用程序文件夹打开打包后的 Moss。');
        this.phase = p.accessibility && p.screen_recording ? 'ready' : 'needs-permission';
      } catch (error) { if (epoch === this.epoch) { this.phase = 'error'; this.error = errorText(error); } }
      this.changed(); return this.status();
    })().finally(() => { this.checking = null; });
    return this.checking;
  }
  async ensureReady(session, epoch) {
    if (!this.permissions?.hostIdentity || !this.permissions.accessibility || !this.permissions.screenRecording || !this.host.client) {
      await this.check({ duringControl: true });
    }
    this.guard(session, epoch);
    if (!this.permissions?.hostIdentity || !this.permissions.accessibility || !this.permissions.screenRecording) {
      throw new Error(this.error || '请在系统设置开启辅助功能和屏幕录制，然后回到设置 → 工具重新检查。');
    }
  }
  async listApps(signal) {
    const result = structured(await this.host.call('list_apps', {}, signal));
    return (result.apps || []).filter(a => a.kind === 'desktop' && a.bundle_id)
      .map(a => ({ name: a.name, bundleId: a.bundle_id, running: a.running, pid: a.pid }));
  }
  async authorize(session, app, foreground, signal, epoch) {
    const grants = this.sessionGrants.get(session.id) || new Set();
    const hasApp = grants.has(app.bundleId) || this.settings().apps.some(a => a.bundleId === app.bundleId);
    const needsForeground = foreground && !this.owner?.foreground;
    if (!hasApp || needsForeground) {
      const decision = await this.requestAccess({ session, app, foreground: needsForeground, signal });
      this.guard(session, epoch);
      if (!['session', 'always'].includes(decision)) throw new Error('用户未允许本次应用控制。');
      if (decision === 'always' && !needsForeground) {
        const settings = this.settings();
        await this.saveSettings({ ...settings, apps: [...settings.apps.filter(a => a.bundleId !== app.bundleId), { bundleId: app.bundleId, name: app.name }] });
      } else {
        grants.add(app.bundleId); this.sessionGrants.set(session.id, grants);
      }
      if (needsForeground) this.owner.foreground = true;
      this.changed();
    }
  }
  async invoke(input, session, signal) {
    this.assertLocal(session);
    if (!actions.has(input?.action)) throw new Error('不支持的电脑操控操作。');
    if (input.action === 'status') return { content: [{ type: 'text', text: JSON.stringify(this.status()) }] };
    if (input.action === 'end_session') { await this.finish(session.id); return { content: [{ type: 'text', text: '控制已结束。' }] }; }
    this.guard(session);
    if (this.stopping || this.inFlight || (this.owner && this.owner.id !== session.id)) throw new Error('电脑正在由另一个操作或会话控制，请等待其结束。');
    const epoch = this.epoch;
    this.owner ||= { id: session.id, title: session.title || '当前会话', cuaSession: `moss-${randomUUID()}` };
    this.owner.action = input.action;
    const controller = new AbortController(); this.controller = controller;
    const cancel = () => { void this.stop('abort', session.id); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    this.inFlight = true; this.changed();
    try {
      await this.ensureReady(session, epoch);
      const apps = await this.listApps(controller.signal); this.guard(session, epoch);
      if (input.action === 'list_apps') {
        const q = String(input.query || '').toLowerCase();
        return { content: [{ type: 'text', text: JSON.stringify({ apps: apps.filter(a => !q || `${a.name} ${a.bundleId}`.toLowerCase().includes(q)) }) }] };
      }
      const matches = apps.filter(a => a.bundleId === input.app || a.name === input.app);
      if (matches.length !== 1) throw new Error('应用不存在或名称不唯一，请先 list_apps，再使用准确 Bundle ID。');
      let app = matches[0]; this.owner.app = { name: app.name, bundleId: app.bundleId }; this.changed();
      await this.authorize(session, app, input.foreground === true, controller.signal, epoch);
      this.guard(session, epoch);
      const cuaSession = this.owner.cuaSession;
      if (input.action === 'launch_app') return await this.host.call('launch_app', { bundle_id: app.bundleId, session: cuaSession }, controller.signal);
      app = (await this.listApps(controller.signal)).find(a => a.bundleId === app.bundleId && a.pid === app.pid && a.running);
      this.guard(session, epoch);
      if (!app) throw new Error('应用进程已变化，请重新列出应用和窗口。');
      if (!app.running || !Number.isSafeInteger(app.pid) || app.pid <= 0) throw new Error('应用未运行，请先 launch_app。');
      const windows = await this.host.call('list_windows', { pid: app.pid, session: cuaSession }, controller.signal);
      const windowData = structured(windows);
      this.guard(session, epoch);
      if (input.action === 'list_windows') return windows;
      const windowId = windowNumber(input.window_id);
      if (!(windowData.windows || []).some(w => w.pid === app.pid && String(w.window_id) === String(windowId))) throw new Error('目标窗口已关闭或不属于该应用，请重新列出窗口。');
      const args = { pid: app.pid, window_id: windowId, session: cuaSession };
      for (const key of fields[input.action]) {
        if (key === 'action') { if (input.ax_action !== undefined) args.action = input.ax_action; }
        else if (input[key] !== undefined) args[key] = input[key];
      }
      const key = `${app.pid}:${windowId}`;
      if (input.action === 'get_window_state') {
        args.max_elements = Math.min(Math.max(Number(args.max_elements) || 600, 1), 1500);
        args.max_depth = Math.min(Math.max(Number(args.max_depth) || 25, 1), 40);
        args.timeout_ms = 5000; args.max_image_dimension = 1440;
      } else {
        const snapshot = this.snapshots.get(key);
        if (!snapshot || snapshot.id !== input.snapshot_id || Date.now() - snapshot.time > 60_000) throw new Error('需要先获取当前窗口的新快照，再使用它的 snapshot_id 执行动作。');
        if (args.element_token && !snapshot.tokens.has(args.element_token)) throw new Error('元素不属于当前窗口快照。');
        if (args.x !== undefined || args.y !== undefined) {
          if (!Number.isFinite(args.x) || !Number.isFinite(args.y) || args.x < 0 || args.y < 0 || args.x >= snapshot.width || args.y >= snapshot.height) throw new Error('坐标不在当前窗口截图内。');
          if (input.action === 'click') args.capture_id = snapshot.captureId;
        }
        if (input.action === 'click' && !args.element_token && args.x === undefined) throw new Error('点击需要元素 token 或截图坐标。');
        if (input.action === 'set_value' && !args.element_token) throw new Error('设置控件值需要元素 token。');
        if (typeof args.text === 'string' && args.text.length > 10000) throw new Error('单次输入最多 10000 字符。');
        if (input.action !== 'set_value') args.delivery_mode = input.foreground === true ? 'foreground' : 'background';
        this.snapshots.delete(key);
      }
      this.guard(session, epoch);
      const result = await this.host.call(input.action, args, controller.signal);
      if (input.action === 'get_window_state' && !result.isError) {
        const state = structured(result);
        this.snapshots.clear();
        this.snapshots.set(key, { id: state.snapshot_id, captureId: state.capture_id, time: Date.now(),
          tokens: new Set((state.elements || []).map(e => e.element_token)), width: state.screenshot_width, height: state.screenshot_height });
        if (result.content?.some(c => c.type === 'image')) this.captureVerified = true;
      }
      this.phase = 'ready'; this.error = '';
      return result;
    } catch (error) {
      this.error = errorText(error);
      if (!controller.signal.aborted && /timeout|closed|connection/i.test(this.error)) await this.stop('transport-error', session.id);
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      this.inFlight = false;
      if (this.controller === controller) this.controller = null;
      this.changed();
    }
  }
  async finish(sessionId) {
    if (this.owner?.id !== sessionId) return;
    if (this.inFlight) return this.stop('turn-ended', sessionId);
    const owner = this.owner;
    try { if (this.host.client) await this.host.call('end_session', { session: owner.cuaSession }); }
    finally { this.owner = null; this.snapshots.clear(); this.changed(); }
  }
  async stop(reason = 'user', sessionId) {
    if (sessionId && this.owner?.id !== sessionId) return;
    if (this.stopping) return this.stopping;
    if (this.owner) this.blocked.add(this.owner.id);
    this.epoch++; this.controller?.abort(); this.snapshots.clear();
    this.captureVerified = false;
    this.phase = 'stopping'; this.changed();
    this.stopping = (async () => {
      try { await this.host.stop(); this.phase = this.settings().enabled ? 'not-checked' : 'disabled'; }
      catch (error) { this.error = `停止失败：${errorText(error)}`; this.phase = 'error'; throw error; }
      finally { this.owner = null; this.changed(); }
    })().finally(() => { this.stopping = null; });
    return this.stopping;
  }
  async revoke(bundleId) {
    for (const grants of this.sessionGrants.values()) grants.delete(bundleId);
    await this.saveSettings({ ...this.settings(), apps: this.settings().apps.filter(a => a.bundleId !== bundleId) });
    if (this.owner?.app?.bundleId === bundleId) await this.stop('revoked');
    this.changed();
  }
  async disposeSession(id) { this.sessionGrants.delete(id); await this.stop('disposed', id); this.blocked.delete(id); }
}
