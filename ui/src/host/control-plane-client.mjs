import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';

export function createHostControlClient({ home, db, kind, environmentId, version, getConnection, fetchImpl = fetch,
  getStatus, execute, applyPolicy, onAccountChange = () => {}, onError = () => {} }) {
  const filename = path.join(home, 'control-plane.json');
  let state;
  try { state = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { state = {}; }
  state.deviceId ||= randomUUID();
  state.accounts ||= {};
  db.exec('CREATE TABLE IF NOT EXISTS control_usage_owners (event_id TEXT PRIMARY KEY, account_key TEXT NOT NULL)');
  let activeAccount;
  let generation = 0;
  const epoch = randomUUID();
  let timer, busy, stopped = false;
  const save = () => {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(filename + '.tmp', JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(filename + '.tmp', filename);
  };
  save();
  async function tick() {
    const current = generation;
    const connection = await getConnection();
    if (current !== generation || stopped) return;
    if (!connection?.serverUrl) { activeAccount = null; onAccountChange(null); return; }
    const accountKey = createHash('sha256').update(`${connection.serverUrl}:${connection.accountId || ''}`).digest('hex');
    activeAccount = accountKey;
    onAccountChange(accountKey);
    const account = state.accounts[accountKey] ||= {};
    if (kind === 'cloud' && !account.historyAssigned) {
      db.prepare('INSERT OR IGNORE INTO control_usage_owners(event_id,account_key) SELECT event_id,? FROM usage_events').run(accountKey);
      account.historyAssigned = true; save();
    }
    const id = environmentId || `desktop-${state.deviceId}-${accountKey.slice(0, 12)}`;
    const request = async (route, body, token = account.token) => {
      const response = await fetchImpl(`${connection.serverUrl}${route}`, { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...connection.headers },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) { delete account.token; save(); }
        throw new Error(`控制平面请求失败 (${response.status})`);
      }
      return response.json();
    };
    const heartbeat = { id, epoch, kind, name: kind === 'cloud' ? '我的云电脑' : os.hostname(), platform: process.platform, version, status: getStatus() };
    if (!account.token && !connection.authToken) return;
    const response = await request(account.token ? '/api/v1/hosts/heartbeat' : '/api/v1/hosts/enroll', heartbeat, account.token || connection.authToken);
    if (response.token) { account.token = response.token; save(); }
    if (current !== generation || stopped) return;
    await applyPolicy(response.policy);
    // Persist an acknowledgement before sending it. Network failures retry the
    // acknowledgement, never the already accepted command's side effect.
    account.acks ||= [];
    for (const command of response.commands || []) {
      if (current !== generation || stopped) return;
      let error;
      try { await execute(command); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
      account.acks.push({ id: command.id, epoch, state: error ? 'failed' : 'succeeded', error }); save();
    }
    while (account.acks.length) {
      if (current !== generation || stopped) return;
      const ack = account.acks[0];
      await request(`/api/v1/hosts/${id}/commands/${ack.id}`, ack);
      account.acks.shift(); save();
    }
    const events = db.prepare(`SELECT id,event_id AS eventId,occurred_at AS occurredAt,session_id AS sessionId,model,
      input_tokens AS inputTokens,output_tokens AS outputTokens,cache_read_tokens AS cacheReadTokens,cache_write_tokens AS cacheWriteTokens
      FROM usage_events WHERE id>? AND event_id IN (SELECT event_id FROM control_usage_owners WHERE account_key=?) ORDER BY id LIMIT 200`).all(account.usageCursor || 0, accountKey);
    if (events.length && current === generation && !stopped) {
      await request(`/api/v1/hosts/${id}/usage`, { events });
      account.usageCursor = events.at(-1).id; save();
    }
  }
  const refresh = () => {
    if (stopped) return Promise.resolve();
    return busy ||= tick().catch(onError).finally(() => { busy = null; });
  };
  return {
    attributeUsage(eventId) {
      if (activeAccount) db.prepare('INSERT OR IGNORE INTO control_usage_owners(event_id,account_key) VALUES(?,?)').run(eventId, activeAccount);
    },
    invalidate() { generation++; activeAccount = null; onAccountChange(null); if (busy) void busy.finally(refresh); },
    start() { stopped = false; void refresh(); timer ||= setInterval(() => void refresh(), 30000); timer.unref?.(); },
    refresh,
    async stop() { stopped = true; clearInterval(timer); timer = null; await busy; },
  };
}
