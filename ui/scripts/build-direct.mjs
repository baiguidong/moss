import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const result = spawnSync('bun', ['run', 'build:electron-direct'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if ((result.status ?? 1) === 0) {
  const source = path.join(repoRoot, 'vendor', 'ripgrep');
  const target = path.resolve(__dirname, '..', 'vendor', 'ripgrep');
  if (fs.existsSync(source)) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
  }
}

process.exit(result.status ?? 1);
