import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { stringifyWire, parseWire } from '../client/wire.mjs';

export const MAX_REQUEST_AGE = 24 * 3600_000;
export function createOperationStore(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created INTEGER NOT NULL, result TEXT)');
  db.prepare('UPDATE operations SET result=? WHERE result IS NULL').run(stringifyWire({ ok: false, error: 'Host 已重启，此请求的结果需要核对。请求未自动重新执行。' }));
  db.prepare('DELETE FROM operations WHERE created < ?').run(Date.now() - MAX_REQUEST_AGE * 2);
  const pending = new Map();
  return {
    async run(request, principal, execute) {
      const { id, method, args, createdAt } = request;
      if (!/^[A-Za-z0-9_-]{16,100}$/.test(id || '') || !Number.isFinite(createdAt) ||
          createdAt > Date.now() + 60_000 || createdAt < Date.now() - MAX_REQUEST_AGE) {
        throw new Error('请求 ID 或时间无效，请刷新后核对操作状态。');
      }
      const key = `${principal.userId}:${id}`;
      const fingerprint = createHash('sha256').update(stringifyWire({ method, args })).digest('hex');
      const previous = db.prepare('SELECT * FROM operations WHERE id=?').get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('请求 ID 不能用于不同的操作。');
        return previous.result ? parseWire(previous.result) : pending.get(key);
      }
      db.prepare('INSERT INTO operations(id,fingerprint,created) VALUES(?,?,?)').run(key, fingerprint, createdAt);
      const result = Promise.resolve().then(execute).then(
        value => ({ ok: true, value }),
        error => ({ ok: false, error: error?.message || String(error) }),
      ).then(outcome => {
        db.prepare('UPDATE operations SET result=? WHERE id=?').run(stringifyWire(outcome), key);
        pending.delete(key);
        return outcome;
      });
      pending.set(key, result);
      return result;
    },
    async close() { await Promise.allSettled([...pending.values()]); db.close(); },
  };
}
