import path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';

/** Preview accepts missing directories without creating them. */
export async function validateProjectWorkspace(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('工作目录必须是绝对路径。');
  let candidate = path.resolve(directory);
  while (true) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isDirectory()) throw new Error(`路径不是目录：${candidate}`);
      await fs.access(candidate, constants.W_OK | constants.X_OK);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`工作目录不可用：${directory}（${error.message}）`);
      // Do not accept a dangling symlink as a directory we can create.
      if (await fs.lstat(candidate).catch(() => null)) throw new Error(`工作目录包含无效链接：${candidate}`);
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export async function prepareProjectWorkspaces(directories) {
  for (const directory of directories) await validateProjectWorkspace(directory);
  for (const directory of directories) {
    try { await fs.mkdir(directory, { recursive: true }); }
    catch (error) { throw new Error(`无法创建工作目录：${directory}（${error.message}）`); }
  }
}
