import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function createRestoreState(env = process.env) {
  const managed = !!env.MOSS_ENVIRONMENT_ID;
  const file = path.join(os.tmpdir(), `moss-maintenance-${encodeURIComponent(env.MOSS_ENVIRONMENT_ID || 'unmanaged')}-${encodeURIComponent(env.MOSS_ENVIRONMENT_GENERATION || '0')}.json`);
  let value = { maintenance: null, automationsPaused: env.MOSS_RESTORED_PAUSED === '1' };
  if (managed) try { value = { ...value, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { get: () => ({ ...value }), update(patch) {
    value = { ...value, ...patch };
    if (managed) { fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); }
  } };
}
