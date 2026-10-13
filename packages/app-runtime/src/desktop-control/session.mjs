import { randomUUID } from 'node:crypto';

// bundleId is the legacy wire field for an opaque adapter-defined app identity.
// macOS uses a Bundle ID; other platforms may use a path-derived stable ID.
export function normalizeDesktopControlSettings(value = {}) {
  return { version: 1, enabled: value?.enabled === true,
    apps: Array.isArray(value?.apps) ? value.apps
      .filter(a => typeof a?.bundleId === 'string' && /^[\w.-]{1,240}$/.test(a.bundleId))
      .map(a => ({ bundleId: a.bundleId, name: String(a.name || a.bundleId).slice(0, 240) })) : [] };
}

// Host-owned policy and lease. The trusted adapter owns observation/action data.
export class DesktopControlSession {
  constructor({ getSettings, saveSettings, requestAccess, publish = () => {}, isCurrent = () => true }) {
    Object.assign(this, { getSettings, saveSettings, requestAccess, publish, isCurrent });
    this.sessionGrants = new Map(); this.blocked = new Set(); this.epoch = 0; this.suspended = false;
  }
  settings() { return normalizeDesktopControlSettings(this.getSettings()); }
  status() {
    return { version: '', supported: false, phase: 'not-installed', ...this.adapter?.status(), enabled: this.settings().enabled,
      active: this.owner ? { sessionId: this.owner.id, title: this.owner.title, app: this.owner.app,
        action: this.owner.action, foreground: Boolean(this.owner.foreground) } : null,
      apps: this.settings().apps,
      sessionApps: [...this.sessionGrants].flatMap(([sessionId, grants]) => [...grants].map(bundleId => ({ sessionId, bundleId }))) };
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
    if (!this.isCurrent(session)) throw new Error('控制 App 已停用、权限被撤销或已移出当前会话。');
    if (!this.settings().enabled) throw new Error('请先打开电脑操控 App 并开启控制。');
    if (this.suspended || this.failedStop || this.blocked.has(session.id) || epoch !== this.epoch) throw new Error('电脑操控已停止。请发送新的请求后继续。');
  }
  beginTurn(id) { this.blocked.delete(id); }
  async authorize(session, app, foreground, signal, epoch) {
    this.guard(session, epoch);
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
      } else { grants.add(app.bundleId); this.sessionGrants.set(session.id, grants); }
      this.guard(session, epoch);
      if (needsForeground) this.owner.foreground = true;
      this.changed();
    }
  }
  async run(session, signal, operation) {
    this.assertLocal(session); this.guard(session);
    signal?.throwIfAborted();
    if (this.stopping || this.inFlight || (this.owner && this.owner.id !== session.id)) throw new Error('电脑正在由另一个操作或会话控制，请等待其结束。');
    const epoch = this.epoch;
    this.owner ||= { id: session.id, title: session.title || '当前会话', runId: `moss-${randomUUID()}` };
    const controller = new AbortController(); this.controller = controller;
    const cancel = () => { void this.stop('abort', session.id).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    this.inFlight = true; this.changed();
    try {
      const result = await operation(controller.signal, epoch);
      this.guard(session, epoch);
      return result;
    } finally {
      signal?.removeEventListener('abort', cancel);
      this.inFlight = false;
      if (this.controller === controller) this.controller = null;
      this.changed();
    }
  }
  async finish(id) {
    if (this.owner?.id !== id) return;
    if (this.inFlight) return this.stop('turn-ended', id);
    try { await this.adapter?.finish(this.owner.runId); }
    catch (error) { await this.stop('finish-failed', id); throw error; }
    finally { this.owner = null; this.changed(); }
  }
  async stop(reason = 'user', id) {
    if (id && this.owner?.id !== id) return;
    if (this.stopping) return this.stopping;
    if (this.owner) this.blocked.add(this.owner.id);
    this.epoch++; this.controller?.abort();
    this.stopping = Promise.resolve().then(() => this.adapter?.stop(reason)).then(() => { this.failedStop = false; })
      .catch(error => { this.failedStop = true; throw error; })
      .finally(() => { this.owner = null; this.stopping = null; this.changed(); });
    return this.stopping;
  }
  async revoke(bundleId) {
    for (const grants of this.sessionGrants.values()) grants.delete(bundleId);
    if (this.owner?.app?.bundleId === bundleId) await this.stop('revoked');
    await this.saveSettings({ ...this.settings(), apps: this.settings().apps.filter(a => a.bundleId !== bundleId) });
    this.changed();
  }
  async disposeSession(id) { this.sessionGrants.delete(id); await this.stop('disposed', id); this.blocked.delete(id); }
}
