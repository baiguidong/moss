import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';

export async function readCronTaskStore(filePath) {
  let raw;
  try { raw = await readFile(filePath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.tasks)) throw new Error('Invalid cron task file.');
  return parsed.tasks;
}

// Both the Agent and desktop mutate this file. Lock the entire update and
// replace atomically so a timer cannot overwrite a concurrent create/delete.
export async function updateCronTaskStore(filePath, update) {
  await mkdir(dirname(filePath), { recursive: true });
  const release = await lockfile.lock(filePath, {
    realpath: false,
    stale: 10_000,
    retries: { retries: 50, minTimeout: 10, maxTimeout: 100 },
  });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const tasks = await readCronTaskStore(filePath);
    const result = update(tasks);
    await writeFile(temporary, `${JSON.stringify({ tasks }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, filePath);
    return result;
  } finally {
    await unlink(temporary).catch(() => {});
    await release();
  }
}
