import { execFile, exec } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import electron from 'electron';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const { app } = electron;
const LIBREOFFICE_VERSION = '26.2.1';
const LIBREOFFICE_BUILD = '26.2.1.2';
const DOWNLOAD_BASE = `https://downloadarchive.documentfoundation.org/libreoffice/old/${LIBREOFFICE_BUILD}`;
const EXPECTED_SHA256 = Object.freeze({
  'darwin-arm64': '6814d25db1d64ffe0f617d5b5ab626ddbd2f017b14b937b81d5d43d1551ea384',
  'darwin-x64': '88956ae008860cbe2d11c979528f35624385c58a6feb4a58c612b087a230a810',
  'win32-arm64': 'cd4ce87f791f16c7159ecc5d9087d2c02b0824ccb2bbae4aec8aafb1ce41da39',
  'win32-x64': '045e03473c5cc2f07bce9fe7709394d84236e744fe08c58407dd18d8eb002e10',
  'linux-arm64': '9c89379c7b73603ddcc84e3d48083a331658f3ed29a38bf9f3d02d352d1fd889',
  'linux-x64': '9807363c8fabf79fc3562f606ce1673c4b29c3c53baca513f84e762845a093b2',
});

function getArchNames() {
  if (process.arch === 'arm64') {
    return { dir: 'aarch64', file: 'aarch64' };
  }
  return { dir: 'x86_64', file: 'x86-64' };
}

export class LibreOfficeService {
  async checkInstalled() {
    if (process.platform === 'darwin') return this.checkInstalledMac();
    if (process.platform === 'win32') return this.checkInstalledWindows();
    return this.checkInstalledLinux();
  }

  async checkInstalledMac() {
    const appPath = '/Applications/LibreOffice.app';
    if (!fs.existsSync(appPath)) return { installed: false };
    try {
      const { stdout } = await execAsync(`defaults read "${appPath}/Contents/Info.plist" CFBundleShortVersionString`);
      return { installed: true, version: stdout.trim() || undefined };
    } catch {
      return { installed: true };
    }
  }

  async checkInstalledWindows() {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const candidates = [
      path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
      path.join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return { installed: true };
    }
    return { installed: false };
  }

  async checkInstalledLinux() {
    try {
      const { stdout } = await execAsync('which libreoffice 2>/dev/null || which soffice 2>/dev/null');
      return { installed: Boolean(stdout.trim()) };
    } catch {
      return { installed: false };
    }
  }

  getDownloadUrl() {
    const { dir, file } = getArchNames();
    if (process.platform === 'darwin') {
      return `${DOWNLOAD_BASE}/mac/${dir}/LibreOffice_${LIBREOFFICE_BUILD}_MacOS_${file}.dmg`;
    }
    if (process.platform === 'win32') {
      return `${DOWNLOAD_BASE}/win/${dir}/LibreOffice_${LIBREOFFICE_BUILD}_Win_${file}.msi`;
    }
    return `${DOWNLOAD_BASE}/deb/${dir}/LibreOffice_${LIBREOFFICE_BUILD}_Linux_${file}_deb.tar.gz`;
  }

  getCachedFilePath() {
    const cacheDir = path.join(app.getPath('userData'), 'libreoffice-cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const ext = process.platform === 'darwin' ? 'dmg' : process.platform === 'win32' ? 'msi' : 'tar.gz';
    return path.join(cacheDir, `LibreOffice_${LIBREOFFICE_VERSION}.${ext}`);
  }

  async install(onProgress) {
    const cachedFilePath = this.getCachedFilePath();
    if (fs.existsSync(cachedFilePath) && fs.statSync(cachedFilePath).size > 0) {
      try {
        onProgress('verifying', 91);
        await this.verifyInstallerFile(cachedFilePath);
        return this.installVerifiedFile(cachedFilePath, onProgress);
      } catch {
        fs.rmSync(cachedFilePath, { force: true });
      }
    }
    return this.installFromLocalFile(await this.downloadToCache(onProgress), onProgress);
  }

  async installFromLocalFile(filePath, onProgress) {
    onProgress('verifying', 91);
    await this.verifyInstallerFile(filePath);
    return this.installVerifiedFile(filePath, onProgress);
  }

  async installVerifiedFile(filePath, onProgress) {
    if (process.platform === 'darwin') return this.installMacFromFile(filePath, onProgress);
    if (process.platform === 'win32') return this.installWindowsFromFile(filePath, onProgress);
    return this.installLinuxFromFile(filePath, onProgress);
  }

  async uninstall() {
    if (process.platform === 'darwin') {
      const appPath = '/Applications/LibreOffice.app';
      if (fs.existsSync(appPath)) fs.rmSync(appPath, { recursive: true, force: true });
    } else if (process.platform === 'win32') {
      const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
      for (const dir of [path.join(programFiles, 'LibreOffice'), path.join(programFilesX86, 'LibreOffice')]) {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      }
    } else {
      await execAsync('pkexec dpkg -r libreoffice-common libreoffice-core 2>/dev/null || true');
    }
    const cacheDir = path.join(app.getPath('userData'), 'libreoffice-cache');
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  async downloadToCache(onProgress) {
    const filePath = this.getCachedFilePath();
    await this.downloadFile(this.getDownloadUrl(), filePath, (percent) => {
      onProgress('downloading', Math.min(90, Math.round(percent * 0.9)));
    });
    return filePath;
  }

  async sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.once('error', reject);
      stream.once('end', () => resolve(hash.digest('hex')));
    });
  }

  async verifyInstallerFile(filePath) {
    const expected = EXPECTED_SHA256[`${process.platform}-${process.arch}`];
    if (!expected) {
      throw new Error(`LibreOffice installer is not available for ${process.platform}-${process.arch}`);
    }
    const actual = await this.sha256File(filePath);
    if (actual !== expected) {
      throw new Error('LibreOffice installer integrity check failed');
    }
    if (process.platform === 'darwin') {
      await execFileAsync('hdiutil', ['verify', filePath]);
    }
    if (process.platform === 'win32') {
      const script = [
        '$signature = Get-AuthenticodeSignature -LiteralPath $args[0]',
        "if ($signature.Status -ne 'Valid') { throw \"Invalid Authenticode signature: $($signature.Status)\" }",
        "if ($signature.SignerCertificate.Subject -notmatch 'The Document Foundation') { throw 'Unexpected installer publisher' }",
      ].join('; ');
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, filePath]);
    }
  }

  async installMacFromFile(filePath, onProgress) {
    let mountPoint;
    try {
      onProgress('mounting', 92);
      mountPoint = await this.mountDmg(filePath);
      onProgress('copying', 96);
      const appEntry = fs.readdirSync(mountPoint).find((entry) => entry.endsWith('.app'));
      if (!appEntry) throw new Error('No .app found in mounted DMG');
      const sourceApp = path.join(mountPoint, appEntry);
      await execFileAsync('codesign', ['--verify', '--deep', '--strict', sourceApp]);
      const signature = await execFileAsync('codesign', ['-dv', '--verbose=4', sourceApp]);
      const signatureDetails = `${signature.stdout || ''}\n${signature.stderr || ''}`;
      if (!signatureDetails.includes('TeamIdentifier=7P5S3ZLCN7')) {
        throw new Error('Unexpected LibreOffice application publisher');
      }
      const src = sourceApp.replace(/'/g, "'\\''");
      const script = `do shell script "cp -R '${src}' '/Applications/'" with administrator privileges`;
      await execFileAsync('osascript', ['-e', script]);
    } finally {
      if (mountPoint) {
        onProgress('unmounting', 98);
        try {
          await execFileAsync('hdiutil', ['detach', mountPoint, '-quiet']);
        } catch {}
      }
      onProgress('cleanup', 100);
    }
  }

  async installWindowsFromFile(filePath, onProgress) {
    try {
      onProgress('installing', 92);
      await execFileAsync('msiexec', ['/i', filePath, '/passive', '/norestart']);
    } finally {
      onProgress('cleanup', 100);
    }
  }

  async installLinuxFromFile(filePath, onProgress) {
    const extractDir = path.join(path.dirname(filePath), `libreoffice-extract-${Date.now()}`);
    try {
      onProgress('extracting', 92);
      if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
      await execFileAsync('tar', ['-xzf', filePath, '-C', extractDir]);
      onProgress('installing', 96);
      const debsDir = this.findDebsDir(extractDir);
      if (!debsDir) throw new Error('No DEBS directory found in LibreOffice package');
      const debPaths = fs.readdirSync(debsDir).filter((name) => name.endsWith('.deb')).map((name) => path.join(debsDir, name));
      if (debPaths.length === 0) throw new Error('No .deb files found');
      await execFileAsync('pkexec', ['dpkg', '-i', ...debPaths]);
    } finally {
      try {
        if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
      } catch {}
      onProgress('cleanup', 100);
    }
  }

  findDebsDir(extractDir) {
    try {
      for (const entry of fs.readdirSync(extractDir)) {
        const entryPath = path.join(extractDir, entry);
        if (!fs.statSync(entryPath).isDirectory()) continue;
        const debsPath = path.join(entryPath, 'DEBS');
        if (fs.existsSync(debsPath)) return debsPath;
      }
    } catch {}
    return undefined;
  }

  mountDmg(dmgPath) {
    return new Promise((resolve, reject) => {
      execFile('hdiutil', ['attach', dmgPath, '-nobrowse', '-plist'], (err, stdout) => {
        if (err) return reject(err);
        const match = stdout.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
        if (match?.[1]) return resolve(match[1]);
        reject(new Error('Could not determine DMG mount point'));
      });
    });
  }

  downloadFile(url, dest, onPercent) {
    return new Promise((resolve, reject) => {
      const partialDest = `${dest}.download`;
      fs.rmSync(partialDest, { force: true });
      const doRequest = (currentUrl, redirectCount = 0) => {
        if (redirectCount > 10) return reject(new Error('Too many redirects'));
        const mod = currentUrl.startsWith('https') ? https : http;
        mod.get(currentUrl, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return doRequest(new URL(res.headers.location, currentUrl).toString(), redirectCount + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          }
          const total = parseInt(res.headers['content-length'] ?? '0', 10);
          let received = 0;
          const file = fs.createWriteStream(partialDest, { flags: 'wx' });
          res.on('data', (chunk) => {
            received += chunk.length;
            if (total > 0) onPercent(Math.round((received / total) * 100));
          });
          res.pipe(file);
          file.on('finish', () => file.close(() => {
            try {
              fs.rmSync(dest, { force: true });
              fs.renameSync(partialDest, dest);
              resolve();
            } catch (error) {
              fs.rmSync(partialDest, { force: true });
              reject(error);
            }
          }));
          file.on('error', (error) => {
            file.destroy();
            fs.rmSync(partialDest, { force: true });
            reject(error);
          });
          res.on('error', (error) => {
            file.destroy();
            fs.rmSync(partialDest, { force: true });
            reject(error);
          });
        }).on('error', (error) => {
          fs.rmSync(partialDest, { force: true });
          reject(error);
        });
      };
      doRequest(url);
    });
  }
}

export const libreOfficeService = new LibreOfficeService();
