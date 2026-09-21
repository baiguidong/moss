import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBundledApps } from '../../scripts/bundled-apps.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '..');
const outputDir = path.join(uiRoot, 'dist', 'adapters');
const outputFile = path.join(outputDir, 'feishu.mjs');
const bundledApps = await prepareBundledApps();
const appBackendFile = path.join(bundledApps.outputDir, 'moss.feishu', 'dist', 'backend', 'main.mjs');

fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(appBackendFile, outputFile);
