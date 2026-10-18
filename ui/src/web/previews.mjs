import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createWebPreviews({ registry, resources, resolveResource }) {
  const pages = new Map();
  const decorated = new Map();
  const own = (context, id) => {
    const page = pages.get(id);
    if (!page || page.userId !== context.principal.userId || page.expiresAt < Date.now()) throw new Error('预览已过期，请重新打开文件。');
    return page;
  };
  async function decorate(context, file, reuse = true) {
    if (!file || file.contentType !== 'html') return file;
    const definition = resolveResource ? await resolveResource(file) : { root: path.dirname(file.path), entryPath: file.path };
    const key = JSON.stringify([context.principal.userId, definition.root, definition.entryPath, file.metadata?.remoteContentUrl]);
    for (const [key, handle] of decorated) if (!handle.active()) decorated.delete(key);
    let handle = reuse ? decorated.get(key) : null;
    if (!handle) {
      handle = await resources.create({ ...definition, ownerId: context.principal.userId });
      if (reuse) decorated.set(key, handle);
    }
    return { ...file, metadata: { ...file.metadata, previewResourceToken: handle.token, previewBaseUrl: handle.url.slice(0, handle.url.lastIndexOf('/') + 1) } };
  }
  const handlers = new Map([
    ['web:preview-resource', (context, { file }) => decorate(context, file)],
    ['preview.open', async (context, payload) => {
      for (const [id, page] of pages) if (page.expiresAt < Date.now()) { resources.revoke(page.payload.file.metadata?.previewResourceToken); pages.delete(id); }
      if (pages.size >= 128) throw new Error('预览页面过多，请稍后重试。');
      const file = payload?.file;
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string' || file.content.length > 16 * 1024 * 1024) throw new Error('预览内容无效。');
      const id = randomUUID();
      pages.set(id, { userId: context.principal.userId, payload: { ...payload, file: await decorate(context, file, false) }, expiresAt: Date.now() + 24 * 3600_000 });
      return { ok: true, url: `/?window=preview&previewId=${id}` };
    }],
    ['web:preview-close', (context, { id }) => { const page = own(context, id); resources.revoke(page.payload.file.metadata?.previewResourceToken); pages.delete(id); return { ok: true }; }],
    ['web:preview-get', (context, { id }) => own(context, id).payload],
  ]);
  return { handlers, decorate, close() { for (const page of pages.values()) resources.revoke(page.payload.file.metadata?.previewResourceToken); for (const handle of decorated.values()) handle.revoke(); decorated.clear(); pages.clear(); } };
}
