import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getHostRequestContext } from '../host/request-registry.mjs';
import { createFileBrowser } from './file-browser.mjs';

export function createWebInteractions({ registry, timeoutMs = 10 * 60_000 }) {
  const entries = new Map(), browser = createFileBrowser();
  const changed = () => registry.publish('web:interactions-changed', {});
  const request = (kind, input, { signal } = {}) => {
    if (signal?.aborted) return Promise.resolve(null);
    if (entries.size >= 16) throw new Error('待处理操作过多。');
    return new Promise((resolve, reject) => {
      const id = randomUUID(), context = getHostRequestContext();
      const item = { id, kind, input, originViewId: context?.viewId || null };
      const settle = value => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); entries.delete(id); changed(); resolve(value); };
      const cancel = () => settle(null);
      const timer = setTimeout(cancel, timeoutMs); timer.unref?.();
      signal?.addEventListener('abort', cancel, { once: true });
      entries.set(id, { item, settle, reject }); changed();
    });
  };
  return {
    request,
    dialog: {
      web: true,
      async showOpenDialog(options) {
        const paths = await request('pick', { title: options.title || '选择云电脑文件或上传本机文件', kind: options.properties?.includes('openDirectory') ? 'directory' : 'file', multiple: options.properties?.includes('multiSelections'), extensions: options.filters?.flatMap(filter => filter.extensions) }, { signal: options.signal });
        return { canceled: !paths, filePaths: paths || [] };
      },
      async showSaveDialog(options) {
        const paths = await request('pick', { title: '选择云电脑中的保存目录', kind: 'directory', multiple: false }, { signal: options.signal });
        return { canceled: !paths, filePath: paths?.[0] ? path.join(paths[0], path.basename(options.defaultPath || 'download')) : undefined };
      },
    },
    handlers: new Map([
      ['web:interactions-list', () => [...entries.values()].map(entry => entry.item)],
      ['web:interactions-respond', async (_context, { id, result }) => {
        const entry = entries.get(id);
        if (!entry) throw new Error('此操作已取消或过期。');
        if (result === null) { entry.settle(null); return { ok: true }; }
        if (entry.item.kind === 'pick' || entry.item.kind === 'screen') {
          const selected = await browser.select({ ...entry.item.input, ...(entry.item.kind === 'screen' ? { kind: 'file', extensions: ['png'] } : {}), paths: result });
          if (!entries.has(id)) throw new Error('此操作已取消或过期。');
          entry.settle(selected.map(item => item.path));
        } else if (result === true) entry.settle(true);
        else throw new Error('操作结果无效。');
        return { ok: true };
      }],
    ]),
    close() { for (const entry of [...entries.values()]) entry.settle(null); },
  };
}
