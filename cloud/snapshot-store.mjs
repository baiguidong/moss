import { randomUUID } from 'node:crypto';

// Shares the controller database so promotion and its journal are one transaction.
export class SnapshotStore {
  constructor(environments) {
    this.environments = environments; this.db = environments.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, environment TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot_operations (id TEXT PRIMARY KEY, environment TEXT NOT NULL, request_key TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(environment,request_key));`);
  }
  list(environment) { return this.db.prepare('SELECT data FROM snapshots WHERE environment=? ORDER BY rowid DESC').all(environment).map(r => JSON.parse(r.data)); }
  get(environment, id) { const r = this.db.prepare('SELECT data FROM snapshots WHERE environment=? AND id=?').get(environment, id); if (!r) throw new Error('快照不存在'); return JSON.parse(r.data); }
  save(snapshot) { this.environments.assertLease(); this.db.prepare('INSERT INTO snapshots VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(snapshot.id, snapshot.environmentId, JSON.stringify(snapshot)); return snapshot; }
  remove(environment, id) { this.environments.assertLease(); this.db.prepare('DELETE FROM snapshots WHERE environment=? AND id=?').run(environment, id); }
  operations(environment) { return this.db.prepare('SELECT data FROM snapshot_operations WHERE environment=? ORDER BY rowid DESC').all(environment).map(r => JSON.parse(r.data)); }
  operation(environment, id) { const r = this.db.prepare('SELECT data FROM snapshot_operations WHERE environment=? AND id=?').get(environment, id); if (!r) throw new Error('任务不存在'); return JSON.parse(r.data); }
  byKey(environment, key) { const r = this.db.prepare('SELECT data FROM snapshot_operations WHERE environment=? AND request_key=?').get(environment, key); return r ? JSON.parse(r.data) : null; }
  update(operation, patch) { this.environments.assertLease(); Object.assign(operation, patch, { updatedAt: Date.now() }); this.db.prepare('UPDATE snapshot_operations SET data=? WHERE id=? AND environment=?').run(JSON.stringify(operation), operation.id, operation.environmentId); return operation; }
  begin(row, key, input, reservation, details = {}) {
    this.environments.assertLease();
    if (row.operation || row.upgrade) throw new Error('环境已有维护任务，请等待完成');
    const id = randomUUID();
    const operation = { id, original: structuredClone(row), preflight: details.preflight,
      snapshotId: input.action === 'create' ? randomUUID() : input.snapshotId,
      protectionId: details.preflight?.protection ? randomUUID() : null, helperName: `moss-snapshot-${id}`, candidateName: `moss-restore-${id}`,
      newVolume: input.action === 'restore' && input.includesDataVolume ? `moss-restore-${id}-home` : null, environmentId: row.id, requestKey: key, input, reservation, phase: 'queued', status: 'running', createdAt: Date.now(), generation: row.generation || 0 };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO snapshot_operations VALUES(?,?,?,?)').run(operation.id, row.id, key, JSON.stringify(operation));
      this.environments.update(row.id, { operation: operation.id });
      this.db.exec('COMMIT'); return operation;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  finish(operation, status) {
    this.environments.assertLease();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.environments.update(operation.environmentId, { operation: null });
      this.update(operation, { phase: status, status, cleanupError: null });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  promote(operation, patch) {
    this.environments.assertLease(); const row = this.environments.get(operation.environmentId);
    if (row.operation !== operation.id || (row.generation || 0) !== operation.generation) throw new Error('环境代际已变化');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const next = { ...row, ...patch, generation: operation.generation + 1 };
      this.db.prepare('UPDATE environments SET data=? WHERE id=?').run(JSON.stringify(next), row.id);
      this.update(operation, { promoted: true, phase: 'activating' });
      this.db.exec('COMMIT'); return next;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
