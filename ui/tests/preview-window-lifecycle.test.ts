import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

// Exercise the actual lifecycle without starting the rest of the desktop host.
const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const source = main.slice(main.indexOf('function createPreviewWindow()'), main.indexOf('function getMainWindowAppearance()'));

function setup() {
  const windows: FakeWindow[] = [];
  class FakeWindow extends EventEmitter {
    messages: unknown[] = [];
    shown = 0;
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler() {},
      send: (channel: string, payload: unknown) => this.messages.push([channel, payload]),
    });
    constructor() { super(); windows.push(this); }
    async loadFile() {}
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    show() { this.shown++; }
    focus() {}
    close() { this.destroyed = true; this.emit('closed'); }
    navigate(isMainFrame: boolean, isSameDocument = false) {
      this.webContents.emit('did-start-navigation', { isMainFrame, isSameDocument, url: 'about:srcdoc' });
      if (!isSameDocument) this.webContents.emit('did-start-loading');
    }
  }
  const api = runInNewContext(`
    let previewWindow = null;
    let previewWindowReady = false;
    let revealPreviewWindowWhenReady = false;
    let pendingPreviewMessages = [];
    ${source}
    ({open: openPreviewWindow, ready: markPreviewWindowReady, sync: syncPreviewWindow, close: closePreviewWindow});
  `, {
    BrowserWindow: FakeWindow, path, __dirname: '/ui/src', rendererDevServerUrl: null,
    rendererHtml: '/ui/dist/renderer/index.html', hasFile: () => true, mossLog: () => {},
  });
  return { api, windows };
}

describe('preview window readiness', () => {
  test('HTML iframe loads do not strand subsequent open or sync requests', async () => {
    const { api, windows } = setup();
    const first = { file: { path: '/workspace/first.html' } };
    const next = { file: { path: '/workspace/next.html' } };
    await api.open(first);
    const window = windows[0]!;
    expect(window.messages).toEqual([]);
    api.ready(window.webContents);
    window.navigate(false);
    await api.open(next);
    const sync = { files: [next.file] };
    api.sync(sync);
    expect(window.messages).toEqual([
      ['preview.open', first], ['preview.open', next], ['preview.sync', sync],
    ]);
    expect(window.shown).toBe(2);
    expect(windows).toHaveLength(1);
  });

  test('a reload waits for new renderer listeners, but in-page navigation does not', async () => {
    const { api, windows } = setup();
    await api.open({ content: 'first' });
    const window = windows[0]!;
    api.ready(window.webContents);
    window.navigate(true, true);
    await api.open({ content: 'second' });
    expect(window.messages).toHaveLength(2);
    window.navigate(true);
    await api.open({ content: 'after reload' });
    api.ready(new EventEmitter());
    expect(window.messages).toHaveLength(2);
    api.ready(window.webContents);
    expect(window.messages.at(-1)).toEqual(['preview.open', { content: 'after reload' }]);
    expect(window.shown).toBe(3);
  });

  test('closing and reopening creates a window with a fresh ready handshake', async () => {
    const { api, windows } = setup();
    await api.open({ content: 'old' });
    api.close();
    await api.open({ content: 'new' });
    expect(windows).toHaveLength(2);
    api.ready(windows[0]!.webContents);
    expect(windows[1]!.messages).toEqual([]);
    api.ready(windows[1]!.webContents);
    expect(windows[1]!.messages).toEqual([['preview.open', { content: 'new' }]]);
  });
});
