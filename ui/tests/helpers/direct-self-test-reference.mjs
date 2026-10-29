// Independent benchmark: persistent Playwright connection and direct model sessions.
// Reuses only case/evidence contracts, not the App service, worker or review queue.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createDesktopSettingsStore } from '../../src/desktop-settings.mjs';
import { launchTestInstance } from '../../src/app-testing/instance.mjs';
import { inheritTestApps, inheritTestResources, clearTestAppCredentials, clearTestResources } from '../../src/app-testing/profile.mjs';
import { AppCredentialAdapter } from '../../src/apps/app-runtime.mjs';
import { normalizeAppOwner, DEFAULT_APP_OWNER } from '../../../packages/app-runtime/src/state/index.mjs';
import { attachReviewEvidence } from '../../src/app-testing/review-evidence.mjs';
import { TEST_REVIEW_SYSTEM_PROMPT, TEST_SYSTEM_PROMPT, TEST_ALLOWED_TOOLS } from '../../src/app-testing/browser.mjs';

export async function runDirectReference({ packageRoot, settingsFile, caseIds, preserveAppearance = false }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-direct-reference-')));
  try {
  const sourceHome = path.dirname(settingsFile), mainHome = path.join(root, 'main'), home = path.join(root, 'target');
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'app.moss.json')));
  const importSource = name => import(pathToFileURL(path.join(packageRoot, 'source/apps/self-test/src/backend', name)).href);
  const { loadTestCatalog, materializeTestCases } = await importSource('catalog.mjs');
  const { prepareUiRecipes } = await importSource('ui-recipes.mjs');
  const { buildReviewPrompt } = await importSource('review-prompt.mjs');
  const { renderSelfTestReport } = await importSource('report.mjs');
  const { inspectNativePdf } = await importSource('pdf-probe.mjs');
  const { inspectAppWebview } = await importSource('webview-probe.mjs');
  const { disabledBrowserTools } = await importSource('browser-policy.mjs');
  const { chromium } = await import(pathToFileURL(path.join(packageRoot, 'dist/playwright-cdp/node_modules/playwright-core/index.mjs')).href);
  const catalog = await loadTestCatalog(path.join(packageRoot, 'resources/self-tests'));
  const stored = createDesktopSettingsStore({ settingsPath: settingsFile }).value;
  const settings = Object.fromEntries(['model','url','apiKey','fastModel','thinkingMode','thinkingBudgetTokens','effortLevel','maxTurns','appearance','toolLoading','language','models','image','webSearch'].map(key => [key, stored[key]]));
  if (!preserveAppearance) settings.appearance = { ...settings.appearance, themeMode: 'light' };
  const makeRuntime = (directory, state) => ({ rootDir: directory, appsDir: path.join(directory, 'apps'), state: { snapshot: () => state },
    credentialAdapter: new AppCredentialAdapter(directory), storageAppId: (id, owner) => normalizeAppOwner(owner).key === DEFAULT_APP_OWNER.key ? id : `owners/${Buffer.from(normalizeAppOwner(owner).key).toString('base64url')}/${id}` });
  const sourceState = JSON.parse(await fs.readFile(path.join(sourceHome, 'app-runtime-state.json')));
  // Same fixture setup as the installed-App acceptance helper, outside run time.
  await inheritTestApps({ runtime: makeRuntime(sourceHome, sourceState), home: mainHome });
  await inheritTestResources({ sourceHome, home: mainHome });
  const state = JSON.parse(await fs.readFile(path.join(mainHome, 'app-runtime-state.json')));
  for (const installed of Object.values(state.installations)) if (installed.appId === manifest.id) installed.activeVersion = manifest.version;
  const newPackage = path.join(mainHome, 'apps', manifest.id, 'versions', manifest.version);
  await fs.cp(packageRoot, newPackage, { recursive: true });
  await fs.writeFile(path.join(mainHome, 'app-runtime-state.json'), JSON.stringify(state));
  const run = { id: randomUUID(), directory: root, home, evidenceDir: path.join(root, 'evidence'), model: settings.model, permissionMode: 'bypassPermissions',
    appVersion: '0.0.1', selfTestAppVersion: manifest.version, catalogRevision: catalog.revision, appearance: settings.appearance,
    selfTestPackageHash: createHash('sha256').update(await fs.readFile(path.join(packageRoot, 'checksums.json'))).digest('hex'),
    benchmarkMode: 'direct-reference', cases: materializeTestCases(catalog.cases.filter(test => caseIds ? caseIds.includes(test.id) : test.default), randomUUID()), results: {}, controllerSessions: [] };
  run.cases = materializeTestCases(catalog.cases.filter(test => caseIds ? caseIds.includes(test.id) : test.default), run.id);
  run.targetId = run.id; run.fixturePath = path.join(home, 'self-test-workspace/self-test-note.txt');
  await fs.mkdir(run.evidenceDir, { recursive: true });
  for (const test of run.cases) run.results[test.id] = { status: 'pending' };
  let target, browser, page, reviewing = null, queued = [], diagnostics = new Set();
  const lifetime = new AbortController();
  const cancel = () => { lifetime.abort(new Error('Reference interrupted')); void browser?.close().catch(() => {}); };
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  const log = text => process.stdout.write(`DIRECT_REFERENCE: ${text}\n`);
  process.env.MOSS_CONFIG_DIR = path.join(root, 'controller-profile');
  await fs.mkdir(process.env.MOSS_CONFIG_DIR);
  globalThis.MACRO ||= { VERSION: 'test', BUILD_TIME: '', PACKAGE_URL: 'moss', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' };
  const { ClaudeSession } = await import('../../electron-direct.mjs');
  const tool = manifest.contributes.tools[0], toolName = 'self_test';
  const descriptor = { ...tool, appId: manifest.id, id: manifest.id + '/' + tool.id, name: toolName, inputSchemaDocument: JSON.parse(await fs.readFile(path.join(packageRoot, tool.inputSchema))) };
  const save = () => fs.writeFile(path.join(root, 'report.json'), JSON.stringify(run, null, 2));
  const reconnect = async () => { browser = await chromium.connectOverCDP(target.endpoint); page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('moss-self-test=' + run.id)); };
  const review = async (tests, diagnostic = false, budget = 45000) => {
    const sessionId = randomUUID(), entry = { sessionId, caseIds: tests.map(test => test.id), evidenceReview: !diagnostic, stage: diagnostic ? 'diagnosis' : 'review', startedAt: Date.now() };
    run.controllerSessions.push(entry);
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(budget)]);
    const resolved = new Set(); let session;
    session = new ClaudeSession({ cwd: root, projectDir: path.join(root, 'sessions', sessionId), sessionId,
      model: settings.model, url: settings.url, apiKey: settings.apiKey, permissionMode: 'bypassPermissions',
      thinkingConfig: settings.thinkingMode === 'disabled' ? { type: 'disabled' } : settings.thinkingMode === 'enabled' ? { type: 'enabled', budgetTokens: settings.thinkingBudgetTokens } : { type: 'adaptive' },
      effort: null, maxTurns: settings.maxTurns, customSystemPrompt: diagnostic ? TEST_SYSTEM_PROMPT : TEST_REVIEW_SYSTEM_PROMPT,
      allowedTools: diagnostic ? TEST_ALLOWED_TOOLS : [toolName], appTools: [descriptor], appToolPolicy: { appIds: [manifest.id], mcpServers: {} },
      mcpServers: diagnostic ? { moss_test_browser: { type: 'stdio', command: process.execPath, args: [path.join(packageRoot, 'dist/backend/browser-proxy.mjs'), '--cdp-endpoint', target.endpoint, '--output-dir', run.evidenceDir], disabledTools: disabledBrowserTools } } : {},
      onAppEvent: async event => {
        if (event.type !== 'app_tool_invoke') return { ok: false, error: 'Only result submissions are allowed' };
        try {
          const input = event.input.input;
          if (input.run_id && input.run_id !== run.id) throw new Error('运行标识无效');
          const items = input.action === 'review' ? input.reviews : [input];
          for (const item of items) {
            const test = tests.find(test => test.id === item.case_id); if (!test) throw new Error('不属于当前批次');
            const previous = run.results[test.id];
            if (input.action === 'inspect') { if (diagnostic || !item.notes) throw new Error('补查无效'); previous.inspection = { reason: item.notes }; diagnostics.add(test.id); resolved.add(test.id); continue; }
            if (!['review','record'].includes(input.action) || !['passed','failed','blocked'].includes(item.status)) throw new Error('提交格式无效');
            const checks = input.action === 'review' ? previous.observation.checks : item.checks || [];
            if (item.status === 'passed' && (checks.length !== test.expected.length || checks.some(check => !check.passed))) throw new Error('通过必须覆盖全部预期');
            if (item.status === 'passed' && previous.observation?.error && (!diagnostic || item.correction?.kind !== 'test-error' || !item.correction.reason)) throw new Error('未完成页面检查不得通过');
            const evidence = item.evidence || previous.evidence;
            if (item.status === 'passed' && !evidence?.length) throw new Error('通过必须提供截图');
            for (const file of evidence || []) { const actual = await fs.realpath(path.resolve(run.evidenceDir, file)); if (!actual.startsWith(run.evidenceDir + path.sep)) throw new Error('证据越界'); }
            Object.assign(previous, { status: item.status, notes: item.notes, checks, evidence, recordedAt: Date.now(), controllerSessionId: sessionId }); resolved.add(test.id);
          }
          if (resolved.size === tests.length) session.completeTurn();
          return { ok: true, result: { recorded: items.map(item => ({ caseId: item.case_id, status: item.status })) } };
        } catch (error) { return { ok: false, error: error.message }; }
      },
      environment: { MOSS_RUNTIME_ADVANCED_SETTINGS: JSON.stringify({ moss_response_language: settings.language, moss_tool_loading: settings.toolLoading }), MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }), MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }) },
    });
    try {
      for (let turn = 0; turn < 2 && resolved.size < tests.length; turn++) {
        const missing = tests.filter(test => !resolved.has(test.id));
        const text = buildReviewPrompt(run, missing, { evidenceReview: !diagnostic, retry: turn > 0 });
        const images = [...new Set(missing.flatMap(test => run.results[test.id].evidence || []))].filter(file => /\.(png|jpe?g|webp)$/i.test(file));
        const prompt = images.length ? await attachReviewEvidence(text, images, run.evidenceDir) : text;
        for await (const message of session.send(prompt, signal)) {
          if (message.type === 'result' && message.is_error) entry.error = message.result;
        }
      }
    } catch (error) { entry.error = error.message; }
    finally { await session.dispose(); entry.finishedAt = Date.now(); }
    for (const test of tests) if (!resolved.has(test.id)) Object.assign(run.results[test.id], { status: 'blocked', reasonCode: 'review-incomplete', notes: entry.error || 'AI 未提交有效结果' });
    log(`review ${entry.caseIds.join(',')}: ${entry.finishedAt - entry.startedAt}ms`);
  };
  const flush = async (all = false) => {
    if (reviewing) { await reviewing; reviewing = null; }
    if (queued.length) {
      const batch = []; let images = 0, bytes = 0, pixels = 0;
      while (queued.length && batch.length < 3) {
        const test = queued[0], weight = run.results[test.id].weight;
        if (batch.length && (images + weight.images > 10 || bytes + weight.bytes > 8 * 1024 * 1024 || pixels + weight.pixels > 4_500_000)) break;
        queued.shift(); batch.push(test); images += weight.images; bytes += weight.bytes; pixels += weight.pixels;
      }
      reviewing = review(batch);
      if (all) { await reviewing; reviewing = null; if (queued.length) await flush(true); }
    }
  };
  log(`artifacts ${root}`);
  try {
    run.startedAt = Date.now();
    const fixtures = JSON.parse(await fs.readFile(path.join(packageRoot, 'resources/fixtures.json')));
    target = await launchTestInstance({ run, executable: createRequire(import.meta.url)('electron'), args: [fileURLToPath(new URL('../..', import.meta.url))], cwd: fileURLToPath(new URL('../..', import.meta.url)),
      settings, appRuntime: makeRuntime(mainHome, state), runtimeHome: path.join(sourceHome, 'runtimes'), env: { ...process.env, MOSS_MCP_PYTHON_HOME: path.join(sourceHome, 'mcp/python') },
      fixtures: fixtures.fixtures, fixtureTitle: fixtures.title, signal: lifetime.signal });
    run.endpoint = target.endpoint; run.environmentReadyAt = Date.now();
    const scripts = await prepareUiRecipes(run); await reconnect();
    for (const test of run.cases) {
      lifetime.signal.throwIfAborted();
      if (!scripts[test.id]) throw new Error('Reference currently requires a fixed recipe: ' + test.id);
      if (test.requiresModel) await flush(true);
      const result = run.results[test.id]; result.startedAt = Date.now();
      let timer;
      try {
        const fn = new vm.Script('(' + await fs.readFile(scripts[test.id], 'utf8') + ')').runInThisContext();
        result.observation = await Promise.race([fn(page, { nativePdf: (targetFile, options = {}) => inspectNativePdf({ endpoint: target.endpoint, evidenceDir: run.evidenceDir, ...options }, targetFile), appWebview: (source, options) => inspectAppWebview({ endpoint: target.endpoint, evidenceDir: run.evidenceDir }, source, options) }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('页面检查超时')), Math.min(test.timeoutSeconds || 90, test.requiresModel ? Infinity : 90) * 1000); })]);
      } catch (error) { result.observation = { error: error.message, checks: [], evidence: [] }; await browser.close(); await reconnect(); }
      finally { clearTimeout(timer); }
      Object.assign(result, { evidence: result.observation.evidence, checks: result.observation.checks, executionFinishedAt: Date.now(), executionMs: Date.now() - result.startedAt });
      const images = result.evidence.filter(file => /\.(png|jpe?g|webp)$/i.test(file));
      const pixelCounts = await Promise.all(images.map(async file => { const bytes = await fs.readFile(path.resolve(run.evidenceDir, file)); return bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ? bytes.readUInt32BE(16) * bytes.readUInt32BE(20) : 4_500_000; }));
      result.weight = { pixels: pixelCounts.reduce((a,b) => a+b,0), images: images.length, bytes: (await Promise.all(images.map(async file => (await fs.stat(path.resolve(run.evidenceDir, file))).size))).reduce((a,b) => a+b, 0) };
      if (images.length) queued.push(test); else diagnostics.add(test.id);
      if (queued.length >= 3 || (!reviewing && queued.length)) await flush();
      log(`execute ${test.id}: ${result.executionMs}ms`); await save();
    }
    await flush(true);
    const diagnosticDeadline = Date.now() + 120000;
    for (const id of diagnostics) {
      const remaining = diagnosticDeadline - Date.now();
      if (remaining > 0) await review([run.cases.find(test => test.id === id)], true, Math.min(60000, remaining));
      else Object.assign(run.results[id], { status: 'blocked', reasonCode: 'diagnosis-budget', notes: '本轮补查预算已用尽' });
    }
    run.phase = run.cases.every(test => run.results[test.id].status === 'passed') ? 'completed' : 'failed';
    run.finishedAt = Date.now();
    await fs.writeFile(path.join(root, 'report.html'), await renderSelfTestReport(run));
    run.benchmarkFinishedAt = Date.now(); await save();
    log(`${run.phase}: ${run.benchmarkFinishedAt - run.startedAt}ms`); return root;
  } finally {
    process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
    await reviewing?.catch(() => {}); await browser?.close(); await target?.close();
    for (const directory of [mainHome, home]) { await clearTestAppCredentials(directory); await clearTestResources(directory); await fs.rm(path.join(directory, 'settings.json'), { force: true }); for (const name of ['electron','mcp','runtimes']) await fs.rm(path.join(directory, name), { recursive: true, force: true }); }
  }
  } finally {
    // Even setup failures must not leave inherited credentials or package copies.
    for (const name of ['main', 'target', 'controller-profile']) await fs.rm(path.join(root, name), { recursive: true, force: true });
  }
}
