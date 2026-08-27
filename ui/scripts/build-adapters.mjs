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

fs.mkdirSync(outputDir, { recursive: true });
const result = spawnSync('bun', [
  'build',
  path.join(repoRoot, 'adapters', 'feishu', 'index.ts'),
  '--target=node',
  '--format=esm',
  `--outfile=${outputFile}`,
], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
