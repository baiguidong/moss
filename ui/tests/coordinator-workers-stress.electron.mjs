// Build the renderer first: node ui/scripts/build-renderer.mjs
// Run: ui/node_modules/.bin/electron ui/tests/coordinator-workers-stress.electron.mjs
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const out = path.resolve(repo, process.env.MOSS_UI_STRESS_OUTPUT || 'output/boss-mode-review3-20261016');
const profile = await mkdtemp(path.join(tmpdir(), 'moss-boss-ui-stress-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => { console.error('UI stress check timed out'); app.exit(1); }, 60000);
let win;
const results = [], errors = [];
void app.whenReady().then(async () => {
  try {
    await mkdir(out, { recursive: true });
    execFileSync('bun', ['build', 'tests/helpers/coordinator-workers-stress.tsx', '--target=browser', '--format=iife', `--outdir=${out}`], { cwd: path.join(repo, 'ui'), stdio: 'pipe' });
    const assets = path.join(repo, 'ui/dist/renderer/assets');
    // Entry chunks can be renamed or loaded dynamically. Identify the actual
    // global theme stylesheet instead of assuming Vite calls it index.css.
    const styles = await Promise.all((await readdir(assets)).filter(name => name.endsWith('.css'))
      .map(async name => readFile(path.join(assets, name), 'utf8')));
    const themes = styles.filter(css => css.includes('--background:') && css.includes('--color-sky-500:'));
    assert.equal(themes.length, 1, 'Build exactly one renderer global theme stylesheet before the test');
    await writeFile(path.join(out, 'workers.css'), themes[0]);
    await writeFile(path.join(out, 'workers.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="workers.css"></head><body><div id="root"></div><script type="module" src="coordinator-workers-stress.js"></script></body></html>');
    win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    win.webContents.on('render-process-gone', (_event, details) => errors.push(`Renderer gone: ${details.reason}`));
    const evaluate = code => win.webContents.executeJavaScript(code);
    const frame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const waitFor = async (predicate, label) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await evaluate(predicate)) return;
        await frame();
      }
      assert.fail(`Timed out waiting for ${label}`);
    };
    await win.loadFile(path.join(out, 'workers.html'));
    await frame();
    for (const [width, pane] of [[320, 320], [420, 420], [1440, 1440], [1440, 320], [1440, 420]]) {
      win.setContentSize(width, 900);
      await evaluate(`document.getElementById('root').style.width = '${pane}px'`);
      for (const theme of ['light', 'dark']) {
        await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
        for (const count of [0, 1, 4, 8, 9, 99, 100, 101, 500, 1000]) {
          const renderMs = await evaluate(`window.stress.update(${count})`);
          await frame();
          const layout = await evaluate(`({
            width: innerWidth, scroll: document.documentElement.scrollWidth,
            rows: document.querySelectorAll('[data-worker-id]').length,
            dots: [...document.querySelectorAll('[role=group] button')].filter(el => el.getClientRects().length > 0).length,
            available: document.querySelector('[role=group]')?.parentElement.parentElement.getBoundingClientRect().width ?? 0,
            overlap: (() => { const group = document.querySelector('[role=group]'); const outline = document.querySelector('[aria-label="查看会话大纲"]'); return group && group.getBoundingClientRect().right > outline.getBoundingClientRect().left; })(),
            header: document.querySelector('h2')?.parentElement.innerText,
            background: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
          })`);
          assert.equal(layout.width, width);
          if (count <= 100) assert.equal(layout.rows, count);
          else assert(layout.rows > 0 && layout.rows < 100, `Large list should render only visible rows: ${layout.rows}`);
          assert(layout.scroll <= width, `Horizontal overflow at ${width}px/${count}: ${JSON.stringify(layout)}`);
          assert(!layout.overlap, `Worker controls overlap toolbar at ${width}px/${count}`);
          const visible = layout.available >= 400 ? 8 : layout.available >= 240 ? 4 : layout.available >= 140 ? 2 : 1;
          assert.equal(layout.dots, Math.min(count, visible) + (count > visible ? 1 : 0));
          assert(layout.header.includes(`全部 ${count}`));
          const lightness = /^oklch\(([\d.]+)(%?)/.exec(layout.background);
          assert(lightness, `Missing theme background: ${layout.background}`);
          assert.equal(Number(lightness[1]) / (lightness[2] ? 100 : 1), theme === 'dark' ? 0.18 : 0.978);
          results.push({ width, pane, theme, count, mountedRows: layout.rows, renderMs: Math.round(renderMs * 10) / 10 });
          if (count === 1000) await writeFile(path.join(out, `workers-${width}-pane-${pane}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
        }
      }
    }
    await evaluate("document.getElementById('root').style.width = '100%'");
    const updates = [];
    for (let round = 0; round < 30; round++) {
      updates.push(await evaluate(`window.stress.update(1000, ${round})`));
      await frame();
    }
    // Exercise offscreen selection in all three groups, including the last row.
    for (const id of ['worker-0', 'worker-1', 'worker-2', 'worker-999']) {
      await evaluate(`window.stress.select('${id}')`);
      await frame();
      await frame();
      await waitFor(`document.querySelector('[data-worker-id="${id}"]')?.getAttribute('aria-current') === 'true'`, `selection ${id}`);
      assert(await evaluate(`(() => { const row = document.querySelector('[data-worker-id="${id}"]'); const rect = row.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('[data-worker-id]') === row; })()`), `Selected row ${id} should be visible and clickable`);
    }
    await evaluate(`document.querySelector('[data-worker-id="worker-999"]').click()`);
    assert.equal(await evaluate('window.openedWorker'), 'worker-999');
    for (const status of ['completed', 'running', 'failed']) {
      await evaluate(`window.stress.setStatus('${status}')`);
      await frame();
      await evaluate(`window.stress.select('worker-0')`);
      await waitFor(`document.querySelector('[data-worker-id="worker-0"]')?.getAttribute('aria-current') === 'true'`, `single ${status} group`);
    }
    await evaluate('window.stress.update(500, 0, "worker-999")');
    assert.equal(await evaluate('document.querySelectorAll("[data-worker-id][aria-current=true]").length'), 0);
    await evaluate(`document.querySelector('[aria-label="返回会话"]').click()`);
    await frame();
    assert.equal(await evaluate('document.querySelectorAll("[data-worker-id]").length'), 0);
    await evaluate(`document.querySelector('[role=group] button').click()`);
    await waitFor('document.querySelectorAll("[data-worker-id][aria-current=true]").length === 1', 'selected worker after reopening');
    assert.equal(await evaluate('document.querySelectorAll("[data-worker-id][aria-current=true]").length'), 1);
    assert.deepEqual(errors, []);
    const report = { cases: results, updates: { count: updates.length, workers: 1000, maxMs: Math.max(...updates), averageMs: updates.reduce((a, b) => a + b) / updates.length }, errors };
    await writeFile(path.join(out, 'ui-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: results.length, maxRenderMs: Math.max(...results.map(r => r.renderMs)), updates: report.updates, errors }));
  } catch (error) {
    if (win && !win.isDestroyed()) await writeFile(path.join(out, 'failure.png'), (await win.webContents.capturePage()).toPNG()).catch(() => {});
    if (win && !win.isDestroyed()) console.error(await win.webContents.executeJavaScript(`({ virtual: document.querySelector('[data-virtuoso-scroller]')?.outerHTML.slice(0, 2200), sizes: [...document.querySelectorAll('[data-virtuoso-scroller], [data-viewport-type], [data-testid="virtuoso-item-list"]')].map(el=>({ tag:el.tagName, height:el.getBoundingClientRect().height, scroll:el.scrollTop })) })`));
    console.error(error, errors); process.exitCode = 1;
  }
  finally {
    clearTimeout(watchdog);
    win?.destroy();
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
    app.exit(process.exitCode || 0);
  }
});
