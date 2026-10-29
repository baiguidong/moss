import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const within = (root, file) => { const rel = path.relative(root, file); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };

// One draft and one writer per physical file, independent of conversation/window.
export function createPreviewOwnership({ storageRoot, getSessionRecord, readFile, writeFile, emit, transferMs = 2000 }) {
  const documents = new Map(), queues = new Map(), transfers = new Map(), retiredSenders = new Set();
  const binding = session => JSON.stringify([session?.id, session?.workspace, session?.agentMode, Boolean(session?.deleted)]);
  const connected = client => !retiredSenders.has(client.slice(0, client.indexOf(':')));
  const serial = (id, fn) => { const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(fn); queues.set(id, next); return next; };
  const draftPath = id => path.join(storageRoot, id + '.json');
  const publicState = doc => ({ id: doc.id, path: doc.path, content: doc.content, originalContent: doc.originalContent,
    dirty: doc.content !== doc.originalContent, owner: doc.owner, generation: doc.generation, sequence: doc.sequence });
  async function persist(doc) {
    await fs.mkdir(storageRoot, { recursive: true, mode: 0o700 });
    if (doc.content === doc.originalContent) { await fs.rm(draftPath(doc.id), { force: true }); return; }
    const temp = draftPath(doc.id) + '.' + randomUUID();
    try { await fs.writeFile(temp, JSON.stringify({ ...publicState(doc), baseHash: doc.baseHash }), { mode: 0o600 }); await fs.rename(temp, draftPath(doc.id)); }
    finally { await fs.rm(temp, { force: true }); }
  }
  const notify = doc => emit?.('preview-document:changed', publicState(doc));
  async function resolve(sessionId, filePath) {
    const session = getSessionRecord(sessionId);
    if (!session || session.deleted || session.agentMode === 'remote-direct' || !session.workspace) throw new Error('没有本地编辑工作区');
    const sessionBinding = binding(session);
    const root = await fs.realpath(session.workspace), target = await fs.realpath(path.resolve(root, filePath));
    if (!within(root, target)) throw new Error('文件不在所属工作区中');
    return { session: { ...session, workspace: root }, sessionBinding, target, id: digest(target) };
  }
  async function readStable(session, target) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = digest(await fs.readFile(target)), file = await readFile(session, target), after = digest(await fs.readFile(target));
      if (before !== after) continue;
      if (file.truncated || file.metadata?.previewEditable === false || !['text', 'code', 'markdown', 'html', 'diff', 'ofv', 'unsupported'].includes(file.contentType)) throw new Error('文件不支持文本编辑');
      return { content: file.content, baseHash: after };
    }
    throw new Error('文件正在被外部修改，请稍后重试');
  }
  function validBinding(sessionId, sessionBinding, client) {
    if (!connected(client)) throw new Error('编辑窗口已断开');
    if (binding(getSessionRecord(sessionId)) !== sessionBinding) throw new Error('工作区已切换，请重新打开文件');
  }
  function owned(input, client) {
    const doc = documents.get(input.id);
    if (!doc || doc.owner !== client || doc.generation !== input.generation) throw new Error('编辑权已交接，当前草稿未覆盖文件');
    validBinding(doc.ownerSessionId, doc.ownerBinding, client);
    if (transfers.get(doc.id)?.acknowledged) throw new Error('正在交接编辑权，请稍后重试');
    return doc;
  }
  return {
    async acquire({ sessionId, filePath, takeOwnership = false }, client) {
      const { session, sessionBinding, target, id } = await resolve(sessionId, filePath);
      await serial(id, async () => {
        if (!documents.has(id)) {
          const file = await readStable(session, target);
          let saved; try { saved = JSON.parse(await fs.readFile(draftPath(id), 'utf8')); } catch {}
          const doc = { id, path: target, content: file.content, originalContent: file.content, baseHash: file.baseHash, owner: null, generation: 0, sequence: 0 };
          if (saved?.path === target && typeof saved.content === 'string' && typeof saved.originalContent === 'string' && typeof saved.baseHash === 'string') Object.assign(doc, { content: saved.content, originalContent: saved.originalContent, baseHash: saved.baseHash });
          documents.set(id, doc);
        }
      });
      const doc = documents.get(id);
      const grant = () => {
        validBinding(sessionId, sessionBinding, client);
        doc.owner = client; doc.ownerSessionId = sessionId; doc.ownerBinding = sessionBinding; doc.generation++; doc.sequence++;
        notify(doc); return publicState(doc);
      };
      if (doc.owner && doc.owner !== client && takeOwnership) {
        if (transfers.has(id)) throw new Error('正在交接编辑权，请稍后重试');
        const transferId = randomUUID(), owner = doc.owner, generation = doc.generation;
        let resolveAck; const ack = new Promise(resolve => { resolveAck = resolve; });
        transfers.set(id, { transferId, owner, generation, resolve: resolveAck });
        emit?.('preview-document:prepare-transfer', { id, transferId, owner, generation });
        let timer;
        try {
          const accepted = await Promise.race([ack, new Promise(resolve => { timer = setTimeout(() => resolve(false), transferMs); })]);
          if (!accepted) throw new Error('原窗口未完成草稿同步，编辑权仍留在原窗口');
          return await serial(id, async () => {
            if (doc.owner !== owner || doc.generation !== generation) throw new Error('编辑权已变化，请重试');
            // Grant atomically: no owner:null gap for another window to acquire.
            return grant();
          });
        } finally { clearTimeout(timer); transfers.delete(id); emit?.('preview-document:transfer-ended', { id, transferId, owner, released: doc.owner !== owner }); }
      }
      return serial(id, async () => {
        validBinding(sessionId, sessionBinding, client);
        if (!doc.owner) {
          if (doc.content === doc.originalContent) { const file = await readStable(session, target); doc.content = file.content; doc.originalContent = file.content; doc.baseHash = file.baseHash; }
          return grant();
        }
        doc.sequence++; notify(doc); return publicState(doc);
      });
    },
    update(input, client) {
      return serial(input.id, async () => {
        const doc = owned(input, client);
        if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > 8 * 1024 * 1024) throw new Error('草稿内容过大');
        doc.content = input.content; doc.sequence++;
        await persist(doc); notify(doc); return publicState(doc);
      });
    },
    save(input, client) {
      return serial(input.id, async () => {
        const doc = owned(input, client), { session, target } = await resolve(input.sessionId, doc.path);
        if (input.sessionId !== doc.ownerSessionId) throw new Error('编辑会话不匹配');
        if (target !== doc.path) throw new Error('文件身份已变化');
        const bytes = await fs.readFile(target);
        if (digest(bytes) !== doc.baseHash) throw new Error('文件已在外部修改。草稿已保留，请先比较磁盘内容后再保存。');
        // A recovery copy survives a failed/non-atomic filesystem write.
        await fs.mkdir(path.join(storageRoot, 'backups'), { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(storageRoot, 'backups', doc.id), bytes, { mode: 0o600 });
        validBinding(doc.ownerSessionId, doc.ownerBinding, client);
        const file = await writeFile(session, target, doc.content);
        doc.originalContent = doc.content; doc.baseHash = digest(Buffer.from(doc.content, 'utf8')); doc.sequence++;
        await persist(doc); notify(doc); return { state: publicState(doc), file };
      });
    },
    async acknowledge(input, client) {
      const transfer = transfers.get(input.id);
      if (!transfer || transfer.owner !== client || transfer.transferId !== input.transferId) return { accepted: false };
      await serial(input.id, async () => {
        await persist(owned({ id: input.id, generation: transfer.generation }, client));
        transfer.acknowledged = true;
      });
      if (transfers.get(input.id) !== transfer) return { accepted: false };
      transfer.resolve(true); return { accepted: true };
    },
    release(input, client) {
      return serial(input.id, async () => {
        const doc = documents.get(input.id); if (!doc || doc.owner !== client || doc.generation !== input.generation) return;
        await persist(doc); doc.owner = null; doc.generation++; doc.sequence++; notify(doc);
      });
    },
    async releaseSender(prefix) {
      retiredSenders.add(prefix);
      for (const doc of documents.values()) if (doc.owner?.startsWith(prefix + ':')) await this.release({ id: doc.id, generation: doc.generation }, doc.owner);
    },
    hasSessionEdits(sessionId) {
      return [...documents.values()].some(doc => doc.ownerSessionId === sessionId && (doc.owner || doc.content !== doc.originalContent));
    },
    async assertUnowned(sessionId, filePath) {
      const { id } = await resolve(sessionId, filePath), doc = documents.get(id);
      if (doc && (doc.owner || doc.content !== doc.originalContent)) throw new Error('请在持有编辑权的预览中保存，已有草稿已保留');
    },
  };
}

export function registerPreviewOwnershipIpc({ ipcMain, service }) {
  const watched = new WeakSet();
  const client = (event, input) => {
    if (event.sender && !watched.has(event.sender)) { watched.add(event.sender); const id = String(event.sender.id); event.sender.once('destroyed', () => void service.releaseSender(id)); }
    if (typeof input?.clientId !== 'string' || !/^[\w-]{1,128}$/.test(input.clientId)) throw new Error('Invalid preview client');
    const sender = event.sender?.id ?? (event.connectionId ? 'web-' + event.connectionId : null);
    if (sender === null) throw new Error('Preview requires a connected client');
    return String(sender) + ':' + input.clientId;
  };
  for (const method of ['acquire', 'update', 'save', 'acknowledge', 'release']) ipcMain.handle('preview-document:' + method, async (event, input) => {
    const owner = client(event, input), value = await service[method](input, owner);
    // Public owner IDs carry no authorization; writes are bound to the transport sender too.
    return { ...value, client: owner };
  });
  ipcMain.handle('preview-document:disconnect', event => {
    if (event.transport !== 'web' || !event.connectionId) throw new Error('Invalid disconnect');
    return service.releaseSender('web-' + event.connectionId);
  });
}
