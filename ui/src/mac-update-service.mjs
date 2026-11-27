import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { verifyUpdateFile } from './update-download-service.mjs';

// Electron's patched fs treats app.asar as a virtual directory during cleanup.
const require = createRequire(import.meta.url);
const fs = (process.versions.electron ? require('original-fs') : require('node:fs')).promises;
const run = promisify(execFile);
const plist = async (app, key) => (await run('/usr/bin/plutil', [
  '-extract', key, 'raw', '-o', '-', path.join(app, 'Contents/Info.plist'),
])).stdout.trim();

export function createMacUpdateService({ executable, downloader, quit, logPath }) {
  const installed = path.resolve(executable, '../../..');
  const helper = path.join(installed, 'Contents/Helpers/MossUpdate');
  let staged;
  async function discard() {
    if (staged) await fs.rm(staged.directory, { recursive: true, force: true });
    staged = undefined;
  }
  return {
    download: downloader.download,
    discard,
    async stage(candidate, zip) {
      await discard();
      if (path.extname(installed) !== '.app' || installed.includes('/AppTranslocation/')) {
        throw new Error('请从可写的“应用程序”目录启动 Moss，再更新。');
      }
      const before = await fs.lstat(installed, { bigint: true });
      if (!before.isDirectory()) throw new Error('无法识别当前安装位置。');
      const directory = await fs.mkdtemp(path.join(path.dirname(installed), '.moss-update-')).catch(error => {
        throw new Error('无法写入当前安装目录，请从可写的“应用程序”目录启动 Moss。', { cause: error });
      });
      staged = { directory, id: candidate.id, inode: String(before.ino) };
      let validatingBundle = false;
      try {
        // Snapshot even if another process replaces the download cache entry.
        const snapshot = path.join(directory, 'update.zip');
        await fs.copyFile(zip, snapshot, fs.constants.COPYFILE_FICLONE);
        await verifyUpdateFile(snapshot, candidate.asset);
        await run('/usr/bin/ditto', ['-x', '-k', snapshot, directory]);
        await fs.unlink(snapshot);
        validatingBundle = true;
        const next = path.join(directory, 'Moss.app');
        if (!(await fs.lstat(next)).isDirectory() || await fs.realpath(next) !== await fs.realpath(directory) + '/Moss.app') {
          throw new Error('更新包缺少 Moss.app。');
        }
        const id = await plist(next, 'CFBundleIdentifier');
        if (id !== 'com.moss.ai' || await plist(next, 'CFBundleShortVersionString') !== candidate.version ||
            await plist(next, 'CFBundleExecutable') !== 'Moss') throw new Error('更新包的应用标识或版本不匹配。');
        const signature = (await run('/usr/bin/codesign', ['-dvv', installed])).stderr;
        let requirement = 'identifier "com.moss.ai"';
        if (!/^Signature=adhoc$/m.test(signature)) {
          const { stdout, stderr } = await run('/usr/bin/codesign', ['-dr', '-', installed]);
          requirement = (stdout + stderr).match(/^designated => (.+)$/m)?.[1];
          if (!requirement) throw new Error('无法验证当前应用的签名身份。');
        }
        await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R=' + requirement, next]);
        await run(helper, ['--verify-architecture', next]);
      } catch (error) {
        await discard();
        if (validatingBundle) throw Object.assign(new Error('更新包的签名、版本或架构验证失败，请重新获取更新。', { cause: error }), { code: 'INVALID_UPDATE_BUNDLE' });
        throw error;
      }
    },
    async install(candidate) {
      if (staged?.id !== candidate.id) throw new Error('请重新校验更新包。');
      const log = await fs.open(logPath, 'a', 0o600);
      try {
        const child = spawn(helper, [String(process.pid), installed, staged.directory, staged.inode], {
          detached: true, stdio: ['ignore', log.fd, log.fd],
        });
        await once(child, 'spawn');
        child.unref();
        staged = undefined;
        quit();
      } finally { await log.close(); }
    },
  };
}
