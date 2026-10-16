import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export class EnvironmentStore {
  constructor(directory, { maxUsers = 20 } = {}) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, 'environments.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS environments (id TEXT PRIMARY KEY, owner TEXT UNIQUE NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS controller (id INTEGER PRIMARY KEY, owner TEXT, until INTEGER);');
    this.maxUsers = maxUsers; this.instance = randomUUID();
  }
  acquire() {
    const now = Date.now();
    this.db.prepare('INSERT INTO controller(id,owner,until) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until=excluded.until WHERE controller.until < ? OR controller.owner=?').run(this.instance, now + 15000, now, this.instance);
    this.assertLease();
    this.heartbeat = setInterval(() => { try { this.db.prepare('UPDATE controller SET until=? WHERE id=1 AND owner=?').run(Date.now() + 15000, this.instance); } catch {} }, 4000);
    this.heartbeat.unref();
  }
  assertLease() {
    const lease = this.db.prepare('SELECT * FROM controller WHERE id=1').get();
    if (lease?.owner !== this.instance || lease.until < Date.now()) throw new Error('Another environment controller is active; retry after it stops.');
  }
  all() { return this.db.prepare('SELECT data FROM environments ORDER BY id').all().map(row => JSON.parse(row.data)); }
  get(id) { const row = this.db.prepare('SELECT data FROM environments WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  ensure(identity) {
    this.assertLease();
    const userId = identity.user?.id, orgId = identity.organization?.id || '';
    if (typeof userId !== 'string' || !userId || typeof orgId !== 'string') throw new Error('Authentication service returned no user identity');
    const owner = JSON.stringify([orgId, userId]);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let row = this.db.prepare('SELECT data FROM environments WHERE owner=?').get(owner);
      if (row) { this.db.exec('COMMIT'); return JSON.parse(row.data); }
      if (this.db.prepare('SELECT count(*) AS count FROM environments').get().count >= this.maxUsers) throw new Error('云电脑数量已达到部署配额，请联系管理员。');
      const id = `env-${createHash('sha256').update(owner).digest('hex').slice(0, 24)}`;
      const data = { id, userId, orgId, createdAt: Date.now(), containerId: null, state: 'creating', desiredState: 'running', controlToken: randomBytes(32).toString('base64url') };
      this.db.prepare('INSERT INTO environments(id,owner,data) VALUES(?,?,?)').run(id, owner, JSON.stringify(data));
      this.db.exec('COMMIT'); return data;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  update(id, patch) {
    this.assertLease(); const current = this.get(id);
    if (!current) throw new Error('Unknown environment');
    const result = { ...current, ...patch, id: current.id, userId: current.userId, orgId: current.orgId, controlToken: current.controlToken };
    this.db.prepare('UPDATE environments SET data=? WHERE id=?').run(JSON.stringify(result), id);
    return result;
  }
  close() { clearInterval(this.heartbeat); this.db.prepare('DELETE FROM controller WHERE owner=?').run(this.instance); this.db.close(); }
}
