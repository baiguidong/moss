import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// npm's node-pty tarball does not preserve spawn-helper's executable bit.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/node-pty');
const prebuilds = path.join(root, 'prebuilds');
const directories = fs.existsSync(prebuilds)
  ? fs.readdirSync(prebuilds).map((entry) => path.join(prebuilds, entry)) : [];
for (const directory of [path.join(root, 'build/Release'), ...directories]) {
  const helper = path.join(directory, 'spawn-helper');
  if (fs.existsSync(helper) && process.platform !== 'win32') fs.chmodSync(helper, 0o755);
}
