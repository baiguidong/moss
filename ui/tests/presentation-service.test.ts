import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPresentationService } from '../src/presentation/presentation-service.mjs';
import { initialPresentationState, transitionPresentation, validatePresentationInput } from '../src/shared/presentation-contracts.mjs';
import { parseFileReference } from '../src/shared/file-reference.mjs';
import { createPresentationResolver } from '../src/presentation/resource-resolver.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function setup(resolveOverride?: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-presentation-')); roots.push(root);
  const records = { a: { id: 'a', workspace: '/a', agentMode: 'local' }, b: { id: 'b', workspace: '/b', agentMode: 'local' } };
  const events: any[] = [];
  const options = { storageRoot: root, waitMs: 0, getSessionRecord: (id: string) => records[id], emit: (_channel: string, event: any) => events.push(event),
    resolveItem: resolveOverride || (async (_session: any, item: any) => ({ kind: 'file', title: item.path, revision: '1', source: { type: 'file', path: item.path }, capabilities: { preview: true } })),
    loadResource: async () => ({ content: 'file' }) };
  const service = createPresentationService(options);
  await service.snapshot('a', { activate: true }); await service.beginTurn('a', 'turn-a');
  return { service, records, events, options };
}
describe('presentation lifecycle', () => {
  test('validates exclusive references and primary roles', () => {
    expect(() => validatePresentationInput({ items: [{ path: '/a', artifact_id: 'x' }] })).toThrow();
    expect(() => validatePresentationInput({ items: [{ path: '/a', role: 'primary' }, { path: '/b', role: 'primary' }] })).toThrow();
    expect(() => validatePresentationInput({ items: [{ path: '/a' }], forceFocus: true })).toThrow();
  });
  test('registers idempotently and requires a valid visible-render acknowledgement', async () => {
    const { service } = await setup();
    const input = { items: [{ path: '/a/file.md' }] }, context = { turnId: 'turn-a', requestId: 'tool-1' };
    const result = await service.present('a', input, context);
    expect(result.presentation.state).toBe('pending');
    expect(await service.present('a', input, context)).toBe(result);
    const snapshot = await service.snapshot('a'), item = result.items[0];
    expect(snapshot.resources).toHaveLength(1);
    expect(await service.acknowledge('b', { requestId: 'tool-1', epoch: snapshot.epoch, revision: item.revision, state: 'shown' })).toEqual({ accepted: false });
    expect(await service.acknowledge('a', { requestId: 'tool-1', epoch: snapshot.epoch, revision: item.revision, state: 'shown' })).toEqual({ accepted: true });
    expect(result.presentation.state).toBe('shown');
  });
  test('a late file read cannot reopen a manually closed panel', async () => {
    let release: () => void; let started: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const { service } = await setup(async (_session: any, item: any) => { started(); await new Promise<void>(resolve => { release = resolve; }); return { kind: 'file', title: item.path, revision: '1', source: { type: 'file', path: item.path } }; });
    const request = service.present('a', { items: [{ path: '/a/result.pdf' }] }, { turnId: 'turn-a' });
    await ready; await service.action('a', { type: 'close' }); release!();
    expect((await request).presentation.state).toBe('deferred');
    const snapshot = await service.snapshot('a'); expect(snapshot.state.visible).toBe(false); expect(snapshot.resources).toHaveLength(1);
  });
  test('background results and restored history do not activate another session', async () => {
    const { service, options } = await setup();
    await service.beginTurn('b', 'turn-b');
    expect((await service.present('b', { items: [{ path: '/b/result' }] }, { turnId: 'turn-b' })).presentation.reason).toBe('background_session');
    const second = createPresentationService(options), restored = await second.snapshot('b', { activate: true });
    expect(restored.resources).toHaveLength(1); expect(restored.state.visible).toBe(false);
    expect((await service.present('a', { items: [{ artifact_id: restored.resources[0].id }] })).ok).toBe(false);
  });
  test('pins survive new turns; internal replays cannot reset user intent', () => {
    let state = initialPresentationState();
    state = transitionPresentation(state, { type: 'select', id: 'report' });
    state = transitionPresentation(state, { type: 'pin', value: true });
    state = transitionPresentation(state, { type: 'turn', turnId: 'next' });
    const next = transitionPresentation(state, { type: 'auto', id: 'other', seq: 1, turnId: 'next', userIntentVersion: state.userIntentVersion, foreground: true });
    expect(next.activeId).toBe('report');
  });
  test('parses platform file locations without treating protocols as paths', () => {
    expect(parseFileReference('C:\\project\\app.ts:12:4')).toEqual({ path: 'C:\\project\\app.ts', line: 12, column: 4 });
    expect(parseFileReference('file:///tmp/Quarter%20Report.pdf')).toEqual({ path: '/tmp/Quarter Report.pdf' });
    expect(parseFileReference('src/app.ts#L24')).toEqual({ path: 'src/app.ts', line: 24 });
    expect(parseFileReference('javascript:alert(1)')).toBeNull();
    expect(parseFileReference('https://example.com/a.ts')).toBeNull();
    expect(parseFileReference('src/Quarter%20Report.pdf')).toEqual({ path: 'src/Quarter Report.pdf' });
    expect(parseFileReference('App.tsx:42:3')).toEqual({ path: 'App.tsx', line: 42, column: 3 });
    expect(parseFileReference('javascript:alert:42')).toBeNull();
    expect(parseFileReference('javascript%3Aalert:42')).toBeNull();
  });
  test('invalidates late results on workspace rebinding and rejects forged controller events', async () => {
    const { service, records } = await setup();
    const result = await service.present('a', { items: [{ path: '/a/one.md' }] }, { requestId: 'before-rebind', turnId: 'turn-a' });
    const before = await service.snapshot('a');
    records.a.workspace = '/new-workspace';
    const after = await service.snapshot('a');
    expect(after.epoch).not.toBe(before.epoch); expect(after.resources).toEqual([]);
    expect(await service.acknowledge('a', { requestId: result.request_id, epoch: before.epoch, revision: '1', state: 'shown' })).toEqual({ accepted: false });
    await expect(service.action('a', { type: 'turn', turnId: 'forged' })).rejects.toThrow();
  });
  test('background registration of an already visible file remains deferred; pin and dirty state suppress replacement', async () => {
    const { service } = await setup();
    const input = { items: [{ path: '/a/file.md' }] };
    await service.present('a', input, { turnId: 'turn-a' });
    expect((await service.present('a', { ...input, mode: 'background' })).presentation.state).toBe('deferred');
    await service.action('a', { type: 'dirty', value: true });
    const next = await service.present('a', { items: [{ path: '/a/second.md' }] });
    expect(next.presentation.reason).toBe('unsaved_edits');
    expect((await service.snapshot('a')).resources).toHaveLength(2);
  });
  test('a repeated turn-start cannot clear a manual close', () => {
    let state = transitionPresentation(initialPresentationState(), { type: 'turn', turnId: 'same' });
    state = transitionPresentation(state, { type: 'close' });
    expect(transitionPresentation(state, { type: 'turn', turnId: 'same' }).manualHold).toBe(true);
  });
  test('canonical workspace aliases load correctly and literal colon names beat line suffixes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-resolver-')); roots.push(root);
    const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
    const alias = path.join(root, 'alias'); await fs.symlink(workspace, alias);
    await fs.writeFile(path.join(workspace, 'note.md:42'), 'literal');
    const resolver = createPresentationResolver({ resolveResourceFile: async () => { throw new Error('no provider'); }, readWorkspaceFile: async (record: any, filePath: string) => {
      expect(filePath.startsWith(record.workspace + path.sep)).toBe(true);
      return { path: filePath, content: await fs.readFile(filePath, 'utf8') };
    } });
    const session = { id: 'alias', workspace: alias, agentMode: 'local' };
    const resource = await resolver.resolveItem(session, { path: 'note.md:42' });
    expect(resource.location).toBeUndefined();
    expect((await resolver.loadResource(session, resource)).content).toBe('literal');
    await expect(resolver.resolveItem(session, { path: root })).rejects.toThrow('outside');
  });
  test('identical provider call IDs in two sessions keep independent acknowledgements', async () => {
    const { service } = await setup();
    const first = await service.present('a', { items: [{ path: '/a/file' }] }, { requestId: 'shared-id', turnId: 'turn-a' });
    await service.snapshot('b', { activate: true }); await service.beginTurn('b', 'turn-b');
    const second = await service.present('b', { items: [{ path: '/b/file' }] }, { requestId: 'shared-id', turnId: 'turn-b' });
    const a = await service.snapshot('a', { activate: true });
    expect(await service.acknowledge('a', { requestId: 'shared-id', epoch: a.epoch, revision: '1', state: 'shown' })).toEqual({ accepted: true });
    const b = await service.snapshot('b', { activate: true });
    expect(await service.acknowledge('b', { requestId: 'shared-id', epoch: b.epoch, revision: '1', state: 'shown' })).toEqual({ accepted: true });
    expect(first.presentation.state).toBe('shown'); expect(second.presentation.state).toBe('shown');
  });
  test('manual close updates and persists a pending tool-card status', async () => {
    const { service, options } = await setup();
    await service.present('a', { items: [{ path: '/a/file' }] }, { requestId: 'pending', turnId: 'turn-a' });
    await service.action('a', { type: 'close' });
    const restored = await createPresentationService(options).snapshot('a');
    expect(restored.results.find(result => result.request_id === 'pending').presentation).toMatchObject({ state: 'deferred', reason: 'user_closed' });
  });
  test('manual registration sequence stays monotonic across restart', async () => {
    let revision = 0;
    const { service, options } = await setup(async (_session: any, item: any) => ({ kind: 'file', title: 'file', source: { type: 'file', path: item.path }, revision: String(++revision) }));
    for (let index = 0; index < 3; index++) await service.present('a', { items: [{ path: '/a/file' }] }, { origin: 'manual' });
    const restored = createPresentationService(options);
    await restored.present('a', { items: [{ path: '/a/file' }] }, { origin: 'manual' });
    expect((await restored.snapshot('a')).resources[0].revision).toBe('4');
  });
});

test('closing during a slow disk write cancels delivery and never resurrects a request', async () => {
  const { service, events, options } = await setup();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { entered = resolve; });
  const original = fs.rename; let once = true;
  const rename = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (once && String(to).startsWith(options.storageRoot)) { once = false; entered(); await new Promise<void>(resolve => { release = resolve; }); }
    return original(from, to);
  });
  try {
    const pending = service.present('a', { items: [{ path: '/a/slow' }] }, { requestId: 'slow' });
    await blocked;
    const close = service.action('a', { type: 'close' });
    expect((await service.snapshot('a')).state.visible).toBe(false);
    release(); await close;
    expect((await pending).presentation).toMatchObject({ state: 'deferred', reason: 'user_closed' });
    expect(events.filter(event => event.request?.requestId === 'slow')).toHaveLength(0);
    expect((await service.snapshot('a')).request).toBeUndefined();
  } finally { release?.(); rename.mockRestore(); }
});

test('rebind rejects old native results and deduplicates requests within the new epoch only', async () => {
  const { service, records } = await setup();
  const before = await service.snapshot('a');
  const context = { turnId: 'turn-a', requestId: 'same' };
  const first = await service.present('a', { items: [{ path: '/a/old' }] }, context);
  records.a.workspace = '/new';
  const second = await service.present('a', { items: [{ path: '/new/file' }] }, context);
  expect(second).not.toBe(first);
  const old = await service.register('a', { kind: 'app-view', source: { type: 'app-view', appId: 'old' } }, { epoch: before.epoch });
  expect(old.ok).toBe(false);
  expect((await service.snapshot('a')).resources.map(item => item.source.path)).toEqual(['/new/file']);
});

test('manual visits stay out of Results while explicit output and dirty metadata survive reopening', async () => {
  const { service, options } = await setup();
  const opened = await service.present('a', { items: [{ path: '/a/file' }] }, { origin: 'manual' });
  expect((await service.snapshot('a')).resources[0].isResult).toBe(false);
  await service.documentChanged({ path: '/a/file', dirty: true });
  await service.present('a', { items: [{ path: '/a/file' }] }, { origin: 'tool' });
  await service.action('a', { type: 'dirty', value: false });
  const current = await service.snapshot('a');
  expect(current.resources[0]).toMatchObject({ id: opened.items[0].artifact_id, dirty: true, isResult: true });
  expect(current.state.dirty).toBe(true);
  expect((await createPresentationService(options).snapshot('a')).state.dirty).toBe(true);
  await service.documentChanged({ path: '/a/file', dirty: false });
  expect((await service.snapshot('a')).state.dirty).toBe(false);
});

test('new requests supersede old render acknowledgements and survive a renderer snapshot', async () => {
  const { service } = await setup();
  const input = { items: [{ path: '/a/file' }] };
  const first = await service.present('a', input, { requestId: 'one' });
  const second = await service.present('a', input, { requestId: 'two' });
  const current = await service.snapshot('a');
  expect(current.request.requestId).toBe('two');
  expect(first.presentation).toMatchObject({ state: 'deferred', reason: 'superseded' });
  expect(await service.acknowledge('a', { ...current.request, requestId: 'one', state: 'shown' })).toEqual({ accepted: false });
  expect(await service.acknowledge('a', { ...current.request, state: 'shown' })).toEqual({ accepted: true });
  expect(second.presentation.state).toBe('updated');
});

test('late collection reads cannot replace a newer title or revision', async () => {
  let unblock!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { entered = resolve; });
  const { service } = await setup(async (_session, item) => {
    if (item.path === '/a/old') { entered(); await new Promise<void>(resolve => { unblock = resolve; }); }
    return { kind: 'file', title: item.path, revision: '1', source: { type: 'file', path: item.path } };
  });
  const old = service.present('a', { items: [{ path: '/a/old' }, { path: '/a/old2' }], title: 'old' });
  await blocked;
  await service.present('a', { items: [{ path: '/a/new' }, { path: '/a/new2' }], title: 'new' });
  unblock(); expect((await old).presentation.state).toBe('deferred');
  expect((await service.snapshot('a')).resources.find(item => item.kind === 'collection').title).toBe('new');
  expect((await service.snapshot('a')).resources.find(item => item.kind === 'collection').source.memberIds).toHaveLength(4);
});

test('App results reveal the workbench entry without claiming the business page was shown', async () => {
  const { service, events } = await setup();
  const result = await service.register('a', { kind: 'app-view', title: 'Report App', revision: '1', source: { type: 'app-view', appId: 'report', route: '#/result' } }, { requestId: 'app-result' });
  expect(result.presentation).toMatchObject({ state: 'deferred', reason: 'open_workbench_entry' });
  const delivery = events.find(event => event.request?.requestId === 'app-result');
  expect(delivery).toBeDefined();
  expect(await service.acknowledge('a', { ...delivery.request, state: 'shown' })).toEqual({ accepted: false });
});

test('visible provider status refresh preserves content revision, reading location and pin; unchanged polling is silent', async () => {
  let reviewedPages = 0, reads = 0;
  const { service, events } = await setup(async (_session: any, item: any) => {
    reads++;
    return { kind: 'file', title: '演示文稿', revision: 'original-file', source: { type: 'provider', uri: item.resource_uri }, creation: { quality: { state: 'pending', reviewedPages, totalPages: 12 } }, availability: 'ready' };
  });
  await service.present('a', { items: [{ resource_uri: 'moss-presentations://works/test' }] }, { origin: 'manual' });
  await service.action('a', { type: 'pin', value: true });
  const before = await service.snapshot('a'), count = events.length;
  await service.refresh('a', { activeOnly: true });
  expect(events.length).toBe(count); expect((await service.snapshot('a')).version).toBe(before.version);
  reviewedPages = 8; await service.refresh('a', { activeOnly: true });
  const after = await service.snapshot('a');
  expect(after.resources[0].creation.quality.reviewedPages).toBe(8);
  expect(after.resources[0].revision).toBe('original-file'); expect(after.resources[0].sequence).toBe(before.resources[0].sequence);
  expect(after.state).toEqual(before.state);
  const changedEvents = events.length;
  await service.snapshot('b', { activate: true }); const readCount = reads;
  await service.refresh('a', { activeOnly: true }); expect(reads).toBe(readCount); expect(events.length).toBe(changedEvents);
  await service.snapshot('a', { activate: true }); await service.action('a', { type: 'close' });
  const closedReads = reads; await service.refresh('a', { activeOnly: true }); expect(reads).toBe(closedReads);
});

test('older status refreshes cannot overwrite a newer provider response', async () => {
  let mode = 'initial', release: () => void, entered: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  const { service } = await setup(async (_session: any, item: any) => {
    const status = mode;
    if (status === 'old') { entered(); await new Promise<void>(resolve => { release = resolve; }); }
    return { kind: 'file', revision: '1', source: { type: 'provider', uri: item.resource_uri }, creation: { status } };
  });
  await service.present('a', { items: [{ resource_uri: 'moss-pdf://works/test' }] }, { origin: 'manual' });
  mode = 'old'; const old = service.refresh('a', { activeOnly: true }); await pending;
  mode = 'new'; await service.refresh('a', { activeOnly: true }); release!(); await old;
  expect((await service.snapshot('a')).resources[0].creation.status).toBe('new');
});
