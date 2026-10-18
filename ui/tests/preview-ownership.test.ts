import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPreviewOwnership } from '../src/presentation/preview-ownership.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-preview-owner-')); roots.push(root);
  const filePath = path.join(root, 'note.md'); await fs.writeFile(filePath, 'original');
  const events: Array<{ channel: string; payload: any }> = [];
  const options = { storageRoot: path.join(root, 'drafts'), transferMs: 30,
    getSessionRecord: (id: string) => ({ id, workspace: root, agentMode: 'local' }),
    readFile: async (_session: any, target: string) => ({ path: target, content: await fs.readFile(target, 'utf8'), contentType: 'markdown', metadata: {} }),
    writeFile: async (_session: any, target: string, content: string) => { await fs.writeFile(target, content); return { path: target, content, contentType: 'markdown' }; },
    emit: (channel: string, payload: any) => events.push({ channel, payload }),
  };
  const service = createPreviewOwnership(options);
  return { service, options, events, filePath };
}
test('same physical file has one writer across sessions; persisted dirty drafts survive host restart', async () => {
  const { service, filePath, options } = await setup();
  const first = await service.acquire({ sessionId: 'a', filePath }, 'one');
  await service.update({ id: first.id, generation: first.generation, content: 'draft' }, 'one');
  const other = await service.acquire({ sessionId: 'b', filePath }, 'two');
  expect(other.owner).toBe('one'); expect(other.content).toBe('draft');
  await expect(service.update({ id: first.id, generation: first.generation, content: 'wrong' }, 'two')).rejects.toThrow('编辑权');
  const restored = await createPreviewOwnership(options).acquire({ sessionId: 'a', filePath }, 'restored');
  expect(restored.content).toBe('draft'); expect(restored.dirty).toBe(true);
});
test('external writes conflict without overwriting disk or discarding drafts', async () => {
  const { service, filePath } = await setup();
  const state = await service.acquire({ sessionId: 'a', filePath }, 'one');
  await service.update({ ...state, content: 'draft' }, 'one');
  await fs.writeFile(filePath, 'external');
  await expect(service.save({ ...state, sessionId: 'a' }, 'one')).rejects.toThrow('外部修改');
  expect(await fs.readFile(filePath, 'utf8')).toBe('external');
  expect((await service.acquire({ sessionId: 'a', filePath }, 'one')).content).toBe('draft');
});
test('successful transfer includes flushed edits and rejects stale generations', async () => {
  const { service, filePath, options } = await setup();
  let first: any;
  const transferred = createPreviewOwnership({ ...options, emit: (channel: string, event: any) => {
    if (channel === 'preview-document:prepare-transfer') void (async () => {
      await transferred.update({ ...first, content: 'last keystroke' }, 'one');
      await transferred.acknowledge(event, 'one');
    })();
  } });
  first = await transferred.acquire({ sessionId: 'a', filePath }, 'one');
  const second = await transferred.acquire({ sessionId: 'b', filePath, takeOwnership: true }, 'two');
  expect(second.owner).toBe('two'); expect(second.content).toBe('last keystroke');
  await expect(transferred.update({ ...first, content: 'late' }, 'one')).rejects.toThrow('编辑权');
  const saved = await transferred.save({ ...second, sessionId: 'b' }, 'two');
  expect(saved.state.dirty).toBe(false); expect(await fs.readFile(filePath, 'utf8')).toBe('last keystroke');
});
test('failed or late handoff leaves the old owner and draft intact', async () => {
  const { service, filePath, events } = await setup();
  const first = await service.acquire({ sessionId: 'a', filePath }, 'one');
  await service.update({ ...first, content: 'unsaved' }, 'one');
  await expect(service.acquire({ sessionId: 'b', filePath, takeOwnership: true }, 'two')).rejects.toThrow('未完成');
  const event = events.find(event => event.channel.endsWith('prepare-transfer'))!.payload;
  expect(await service.acknowledge(event, 'one')).toEqual({ accepted: false });
  const current = await service.acquire({ sessionId: 'a', filePath }, 'one');
  expect(current.owner).toBe('one'); expect(current.content).toBe('unsaved');
  await service.release(first, 'one');
  expect((await service.acquire({ sessionId: 'b', filePath }, 'two')).content).toBe('unsaved');
});

test('acquisition detects a file changed between text preview and digest reads', async () => {
  const { options, filePath } = await setup();
  let first = true;
  const service = createPreviewOwnership({ ...options, readFile: async (session, target) => {
    const file = await options.readFile(session, target);
    if (first) { first = false; await fs.writeFile(filePath, 'external version'); }
    return file;
  } });
  const state = await service.acquire({ sessionId: 'a', filePath }, 'one');
  expect(state.content).toBe('external version');
  await service.save({ ...state, sessionId: 'a' }, 'one');
  expect(await fs.readFile(filePath, 'utf8')).toBe('external version');
});

test('workspace rebinding revokes the old writer even when the file is inside the new root', async () => {
  const { options, filePath } = await setup();
  const session = { id: 'a', workspace: path.dirname(filePath), agentMode: 'local' };
  const service = createPreviewOwnership({ ...options, getSessionRecord: () => session });
  const state = await service.acquire({ sessionId: 'a', filePath }, 'one');
  session.workspace = path.dirname(session.workspace);
  await expect(service.update({ ...state, content: 'wrong' }, 'one')).rejects.toThrow('工作区已切换');
  await expect(service.save({ ...state, sessionId: 'a' }, 'one')).rejects.toThrow('工作区已切换');
  expect(await fs.readFile(filePath, 'utf8')).toBe('original');
  await service.release(state, 'one');
});

test('a disconnected destination cannot receive ownership after the previous owner flushes', async () => {
  const { options, filePath } = await setup();
  let transfer;
  const service = createPreviewOwnership({ ...options, transferMs: 500, emit: (channel, event) => { if (channel.endsWith('prepare-transfer')) transfer = event; } });
  const state = await service.acquire({ sessionId: 'a', filePath }, 'one:editor');
  const taking = service.acquire({ sessionId: 'b', filePath, takeOwnership: true }, 'two:editor');
  while (!transfer) await new Promise(resolve => setTimeout(resolve, 1));
  await service.releaseSender('two');
  await service.acknowledge(transfer, 'one:editor');
  await expect(taking).rejects.toThrow('已断开');
  expect((await service.acquire({ sessionId: 'a', filePath }, 'one:editor')).owner).toBe('one:editor');
  await service.update({ ...state, content: 'still editable' }, 'one:editor');
});
