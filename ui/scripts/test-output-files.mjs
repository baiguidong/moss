// Exercise React effects in Chromium: SSR cannot catch stale async results.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-output-files-test-'));
const moduleId = 'virtual:moss-output-files-test';
const fixture = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useAssistantOutputFiles } from '/src/renderer-react/components/chat/use-assistant-output-files.ts';

const pending = [];
window.agentDesktop = { preview: { resolveFiles: (payload) => new Promise((resolve, reject) => pending.push({ payload, resolve, reject })) } };
const timestamp = new Date(0);
const messages = [
  { id: 'user', type: 'user_text', role: 'user', timestamp, content: 'write' },
  { id: 'tool', type: 'tool_use', role: 'assistant', timestamp, toolUseId: 'write', toolName: 'Write', status: 'success' },
  { id: 'result', type: 'tool_result', role: 'assistant', timestamp, toolUseId: 'write', toolName: 'Write', isError: false,
    structuredResult: { type: 'create', filePath: '/tmp/report.md', content: '# report', originalFile: null, structuredPatch: [] } },
  { id: 'reply', type: 'assistant_text', role: 'assistant', timestamp, content: 'done' },
];
const root = createRoot(document.getElementById('root'));
const rendered = [];
function Fixture({ sessionId, agentMode = 'local', history = messages }) {
  const files = useAssistantOutputFiles(history, sessionId, agentMode);
  const paths = [...files.values()].flat().map(file => file.path);
  rendered.push({ sessionId, paths });
  return React.createElement('div', { id: 'paths' }, JSON.stringify(paths));
}
const show = (props) => flushSync(() => root.render(React.createElement(Fixture, props)));
const paths = () => JSON.parse(document.getElementById('paths').textContent);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await tick(); }
  throw new Error('Timed out waiting for React');
}
function finish(request, sessionId) {
  request.resolve([{ inputPath: '/tmp/report.md', file: { path: '/confirmed/' + sessionId + '/report.md', name: 'report.md', size: 8 } }]);
}
window.runOutputChecks = async () => {
  const checks = [];
  show({ sessionId: 'A' });
  await until(() => pending.length === 1);
  assert(paths().length === 0, 'pending files were visible');
  finish(pending[0], 'A');
  await until(() => paths()[0] === '/confirmed/A/report.md');
  checks.push('cards appear only after validation');

  show({ sessionId: 'B' });
  assert(paths().length === 0, 'previous session flashed during render');
  await until(() => pending.length === 2);
  show({ sessionId: 'C' });
  await until(() => pending.length === 3);
  finish(pending[1], 'B');
  await tick();
  assert(paths().length === 0, 'stale request displayed in a new session');
  finish(pending[2], 'C');
  await until(() => paths()[0] === '/confirmed/C/report.md');
  assert(rendered.filter(entry => entry.sessionId === 'C').every(entry => !entry.paths.some(path => path.includes('/B/'))), 'stale session was rendered');
  checks.push('session switches immediately hide old files and discard late responses');

  show({ sessionId: 'C', history: messages.map(entry => entry.id === 'reply' ? { ...entry, content: 'new reply text /tmp/guess.pdf' } : entry) });
  await tick();
  assert(pending.length === 3, 'text changes triggered another file check');
  checks.push('reply text never adds candidates or repeats file checks');

  show({ sessionId: 'C', agentMode: 'remote-direct' });
  assert(paths().length === 0, 'remote session retained local files');
  show({});
  await tick();
  assert(paths().length === 0 && pending.length === 3, 'remote or missing sessions accessed local files');
  checks.push('remote and missing sessions cannot validate local paths');

  show({ sessionId: 'D' });
  await until(() => pending.length === 4);
  pending[3].reject(new Error('IPC unavailable'));
  await tick();
  assert(paths().length === 0, 'failed validation showed files');
  checks.push('failed IPC validation leaves no clickable cards');
  flushSync(() => root.unmount());
  return checks;
};
`;

let server;
let child;
try {
  server = await createServer({
    root: uiRoot,
    configFile: path.join(uiRoot, 'vite.config.ts'),
    cacheDir: path.join(temp, 'vite'),
    server: { host: '127.0.0.1', port: 5188, strictPort: false, hmr: false },
    plugins: [{
      name: 'output-files-fixture',
      resolveId: (id) => id === moduleId ? `\0${moduleId}` : undefined,
      load: (id) => id === `\0${moduleId}` ? fixture : undefined,
      configureServer(vite) {
        vite.middlewares.use('/__output-files-test', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(`<html><body><div id="root"></div><script type="module" src="/@id/__x00__${moduleId}"></script></body></html>`);
        });
      },
    }],
  });
  await server.listen();
  const runner = path.join(temp, 'runner.cjs');
  await fs.writeFile(runner, String.raw`
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(process.env.OUTPUT_FILES_TEMP, 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadURL(process.env.OUTPUT_FILES_URL);
    let ready = false;
    for (let i = 0; i < 150; i++) {
      ready = await win.webContents.executeJavaScript('typeof window.runOutputChecks === "function"');
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Fixture failed to load');
    const checks = await win.webContents.executeJavaScript('window.runOutputChecks()');
    checks.forEach(check => console.log('PASS ' + check));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(require('electron'), [runner], {
    cwd: uiRoot, stdio: 'inherit',
    env: { ...env, OUTPUT_FILES_TEMP: temp, OUTPUT_FILES_URL: `http://127.0.0.1:${server.httpServer.address().port}/__output-files-test` },
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 45_000);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally { clearTimeout(timeout); }
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  await server?.close();
  await fs.rm(temp, { recursive: true, force: true });
}
