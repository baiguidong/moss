import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(uiRoot, '..');
const outputDir = path.join(uiRoot, 'dist', 'adapters');
const outputFile = path.join(outputDir, 'feishu.mjs');
const feishuAppRoot = path.join(repoRoot, 'apps', 'feishu');
const appBackendFile = path.join(feishuAppRoot, 'dist', 'backend', 'main.mjs');

fs.mkdirSync(outputDir, { recursive: true });

const result = spawnSync('bun', ['run', 'build'], {
  cwd: feishuAppRoot,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

fs.copyFileSync(appBackendFile, outputFile);
