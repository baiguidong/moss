import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { SQLITE_READONLY_CHECK } from '../sqlite-readonly.mjs';
test('validates committed WAL without creating sidecars and rejects checksum corruption', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-readonly-sqlite-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); const file = path.join(dir, 'database.db');
  execFileSync('python3', ['-c', 'import sqlite3,sys,os; db=sqlite3.connect(sys.argv[1]);db.execute("PRAGMA journal_mode=WAL");db.execute("CREATE TABLE example(value TEXT)");db.execute("INSERT INTO example VALUES (?)",("committed",));db.commit();os._exit(0)', file]);
  await fs.rm(file + '-shm', { force: true });
  const before = await fs.readFile(file), wal = await fs.readFile(file + '-wal');
  execFileSync('python3', ['-c', SQLITE_READONLY_CHECK, file]);
  assert.deepEqual(await fs.readFile(file), before); assert.deepEqual(await fs.readFile(file + '-wal'), wal);
  await assert.rejects(fs.stat(file + '-shm'), { code: 'ENOENT' });
  wal[70] ^= 1; await fs.writeFile(file + '-wal', wal);
  assert.throws(() => execFileSync('python3', ['-c', SQLITE_READONLY_CHECK, file], { stdio: 'pipe' }), /checksum mismatch/);
});
