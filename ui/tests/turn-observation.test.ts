import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkspaceVersionService } from '../src/workspace-versions/workspace-version-service.mjs';
import { createTurnObservationService } from '../src/workspace-versions/turn-observation-service.mjs';

const user = (uuid = 'user') => ({ type: 'user', uuid, message: { content: 'identical prompt' } });
const tool = (id = 'write', name = 'Write') => ({ type: 'assistant', uuid: 'message-' + id, message: { content: [{ type: 'tool_use', id, name, input: { file_path: '/wrong', content: 'not evidence' } }] } });
const receipt = { type: 'user', toolUseResult: { filePath: '/wrong', type: 'create', content: 'not evidence' }, message: { content: [{ type: 'tool_result', tool_use_id: 'write', content: 'created' }] } };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function setup(gitPath?: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-observation-')); roots.push(root);
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
  const versions = createWorkspaceVersionService({ rootDir: path.join(root, 'versions'), ...(gitPath ? { gitPath } : {}) });
  const observer = createTurnObservationService({ storageRoot: path.join(root, 'observations'), versions });
  return { workspace, observer, versions, session: { id: 'session', workspace, agentMode: 'local' } };
}
test('observes net changes including deletion and binary output without initializing the workspace', async () => {
  const { workspace, observer, versions, session } = await setup();
  await fs.writeFile(path.join(workspace, 'changed.txt'), 'original\n');
  await fs.writeFile(path.join(workspace, 'deleted.txt'), 'delete\n');
  await fs.writeFile(path.join(workspace, 'reverted.txt'), 'same\n');
  const turn = await observer.begin(session, 'turn');
  await fs.writeFile(path.join(workspace, 'changed.txt'), 'changed\nmore\n');
  await fs.rm(path.join(workspace, 'deleted.txt'));
  await fs.writeFile(path.join(workspace, 'binary.bin'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(workspace, 'reverted.txt'), 'temporary');
  await fs.writeFile(path.join(workspace, 'reverted.txt'), 'same\n');
  const result = await observer.finish(turn, 'user');
  expect(result.coverage).toBe('complete');
  expect(result.changes.map(file => [file.path, file.status])).toEqual(expect.arrayContaining([['changed.txt', 'modified'], ['deleted.txt', 'deleted'], ['binary.bin', 'added']]));
  expect(result.changes).toHaveLength(3);
  expect(await fs.stat(path.join(workspace, '.git')).catch(() => null)).toBeNull();
  expect((await versions.status(workspace)).versions).toHaveLength(0);
  const diff = await observer.diff(session.id, turn.id, result.changes.find(file => file.path === 'changed.txt').filePath);
  expect(diff.structuredPatch[0].lines).toContain('+more');
});
test('complete zero changes overrides tool candidates, including pre-existing dirty files', async () => {
  const { workspace, observer, session } = await setup();
  await fs.writeFile(path.join(workspace, 'a'), 'existing dirty state');
  const turn = await observer.begin(session, 'turn'); await observer.finish(turn, 'user');
  const results = await observer.turnsForHistory(session.id, [user(), tool(), receipt]);
  expect(results[0].files).toEqual([]); expect(results[0].coverage).toBe('complete');
});
test('an excluded end state is not a deleted file', async () => {
  const { workspace, observer, session } = await setup();
  const file = path.join(workspace, 'growing.bin'); await fs.writeFile(file, 'small');
  const turn = await observer.begin(session, 'turn');
  await fs.truncate(file, 51 * 1024 * 1024);
  const result = await observer.finish(turn, 'user');
  expect(result.coverage).toBe('partial'); expect(result.changes).toEqual([]);
});
test('missing Git degrades explicitly and overlapping sessions are recorded', async () => {
  const { observer, session } = await setup('/nonexistent/moss-test-git');
  const turn = await observer.begin(session, 'turn');
  const second = await observer.begin({ ...session, id: 'other' }, 'other-turn');
  expect(turn.overlaps).toContain('other-turn');
  const result = await observer.finish(turn, 'user'); await observer.finish(second, 'other-user');
  expect(result.coverage).toBe('unavailable'); expect(result.reasons.join(' ')).toContain('Git');
});
test('timeout and workspace rebinding never finalize a complete observation', async () => {
  const { workspace, versions, session } = await setup();
  const timedOut = createTurnObservationService({ storageRoot: path.join(workspace, 'timeout-store'), captureMs: 10, versions: { captureObservation: (_root: string, { signal }: any) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) } });
  const missing = await timedOut.finish(await timedOut.begin(session, 'timeout'), 'user');
  expect(missing.coverage).toBe('unavailable'); expect(missing.reasons.join(' ')).toContain('超时');
  const observer = createTurnObservationService({ storageRoot: path.join(workspace, 'rebind-store'), versions, getSessionRecord: () => session });
  const turn = await observer.begin(session, 'rebind');
  session.workspace += '-different';
  const rebound = await observer.finish(turn, 'user');
  expect(rebound.coverage).toBe('unavailable'); expect(rebound.reasons.join(' ')).toContain('切换');
});
test('retention protects an open historical diff', async () => {
  const { workspace, versions, session } = await setup();
  const observer = createTurnObservationService({ storageRoot: path.join(path.dirname(workspace), 'retained-observations'), versions, maxTurns: 1, getRetainedObservationIds: async () => ['first'] });
  await fs.writeFile(path.join(workspace, 'note'), 'before');
  const first = await observer.begin(session, 'first');
  await fs.writeFile(path.join(workspace, 'note'), 'after');
  await observer.finish(first, 'user-first');
  await observer.finish(await observer.begin(session, 'second'), 'user-second');
  expect((await observer.list(session.id)).map(record => record.id)).toEqual(['first', 'second']);
  expect((await observer.diff(session.id, 'first', first.changes[0].filePath)).structuredPatch.length).toBeGreaterThan(0);
});

test('finishing the same turn twice keeps a single diff and baseline interval', async () => {
  const { workspace, observer, session } = await setup();
  const turn = await observer.begin(session, 'once');
  await fs.writeFile(path.join(workspace, 'file.txt'), 'created');
  const [first, second] = await Promise.all([observer.finish(turn, 'user'), observer.finish(turn, 'user')]);
  expect(first).toBe(second); expect(first.changes).toHaveLength(1);
  await fs.writeFile(path.join(workspace, 'later.txt'), 'after the turn');
  expect((await observer.finish(turn, 'user')).changes).toHaveLength(1);
});

test('partial coverage never fills excluded files using old tool candidates', async () => {
  const { workspace, observer, session } = await setup();
  const filePath = path.join(workspace, 'large.txt'); await fs.writeFile(filePath, 'small');
  const turn = await observer.begin(session, 'partial'); await fs.truncate(filePath, 51 * 1024 * 1024); await observer.finish(turn, 'user');
  const [merged] = await observer.turnsForHistory(session.id, [user(), tool(), receipt]);
  expect(merged.coverage).toBe('partial'); expect(merged.files).toEqual([]); expect(merged.hasUnverifiedChanges).toBe(true);
});


test('unobserved and unavailable turns never report Write-only changes', async () => {
  const { observer, session } = await setup('/missing/git');
  const history = [user(), tool(), receipt, tool('bash', 'Bash')];
  const [legacy] = await observer.turnsForHistory(session.id, history);
  expect(legacy).toMatchObject({ coverage: 'unavailable', files: [], hasUnverifiedChanges: true });
  const record = await observer.begin(session, 'unavailable'); await observer.finish(record, 'user');
  const [unavailable] = await observer.turnsForHistory(session.id, history);
  expect(unavailable).toMatchObject({ coverage: 'unavailable', files: [], hasUnverifiedChanges: true });
});

test('persisted runtime anchors recover canonical IDs without presentation tools', async () => {
  const { workspace, observer, session } = await setup();
  const record = await observer.begin(session, 'turn');
  observer.observeMessage(record, tool('bash', 'Bash'));
  await fs.writeFile(path.join(workspace, 'bash.txt'), 'written outside Write');
  await observer.finish(record, 'ui-id');
  const [reloaded] = await observer.turnsForHistory(session.id, [user('engine-id'), tool('bash', 'Bash')]);
  expect(reloaded).toMatchObject({ userMessageId: 'engine-id', coverage: 'complete', stats: { filesChanged: 1 } });
  expect((await observer.list(session.id))[0].userMessageId).toBe('engine-id');
  // Rewinding or removing the anchored turn must not attach its diff to an identical prompt.
  expect(await observer.turnsForHistory(session.id, [user('later'), tool('different', 'Bash')])).toMatchObject([{ userMessageId: 'later', coverage: 'unavailable', files: [] }]);
});

test('ambiguous anchors, conflicting observations and nested tools cannot cross-associate turns', async () => {
  const { workspace, versions, session } = await setup();
  const observer = createTurnObservationService({ storageRoot: path.join(path.dirname(workspace), 'conflicts'), versions,
    getTurnBindings: async () => [{ turnId: 'first', sourceToolUseId: 'shared' }],
  });
  const first = await observer.begin(session, 'first');
  await fs.writeFile(path.join(workspace, 'one.txt'), 'first'); await observer.finish(first, 'missing');
  const history = [user('a'), tool('shared'), user('b'), tool('shared')];
  expect((await observer.turnsForHistory(session.id, history)).every(turn => turn.coverage === 'unavailable')).toBe(true);
  const nested = [user('c'), { ...tool('shared'), parent_tool_use_id: 'parent' }, tool('top')];
  expect((await observer.turnsForHistory(session.id, nested))[0].coverage).toBe('unavailable');
  const second = await observer.begin(session, 'second'); await observer.finish(second, 'c');
  const conflicting = [user('c'), tool('shared')];
  expect((await observer.turnsForHistory(session.id, conflicting))[0].observationNote).toContain('冲突');
});
