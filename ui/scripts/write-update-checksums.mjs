import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function writeUpdateChecksums({ directory, version, arch = 'x64' }) {
  if (!/^[0-9A-Za-z.+-]+$/.test(version) || !['x64', 'arm64'].includes(arch)) throw new Error('Invalid update target');
  const lines = [];
  for (const kind of ['Setup', 'Portable']) {
    const name = `Moss-${kind}-${version}-${arch}.exe`;
    const file = path.join(directory, name);
    const stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`Missing final installer: ${name}`);
    const hash = createHash('sha512');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    lines.push(`${hash.digest('hex')}  ${name}`);
  }
  await fsp.writeFile(path.join(directory, 'SHA512SUMS'), `${lines.join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
  await writeUpdateChecksums({ directory: path.join(root, 'dist/installers'), version });
}
