import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readTeamMemberHistory } from '../src/agent-teams/member-history.mjs';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const event = (id: string, time: number) => ({ type: 'assistant', uuid: id, isSidechain: true, timestamp: new Date(time).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: id }] } });
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-member-history-')); roots.push(dir);
  const run = { teamName: 'solar', status: 'interrupted', createdAt: 1000, snapshots: [
    { capturedAt: new Date(2000).toISOString(), team: { members: [{ agentId: 'mercury@solar', name: 'mercury' }] }, tasks: [] },
    { capturedAt: new Date(4000).toISOString(), team: { members: [] }, tasks: [] },
  ] };
  const write = async (id: string, history: unknown[], meta = {}) => {
    await fs.writeFile(path.join(dir, `agent-${id}.meta.json`), JSON.stringify({ teamName: 'solar', agentName: 'mercury', startedAt: 3500, ...meta }));
    await fs.writeFile(path.join(dir, `agent-${id}.jsonl`), history.map(item => JSON.stringify(item)).join('\n') + '\n{"partial":');
  };
  return { dir, run, write };
}

test('member history deduplicates continuations and restricts data to the selected frame and team run', async () => {
  const { dir, run, write } = await fixture();
  await write('first', [event('previous-run', 900), event('one', 1500), event('two', 3000), event('future', 5000)]);
  await write('continuation', [event('one', 1500), event('two', 3000), event('three', 3500)]);
  await write('other-member', [event('wrong-member', 1600)], { agentName: 'venus' });
  await write('other-team', [event('wrong-team', 1600)], { teamName: 'other' });
  const read = (frame: number, nextCreatedAt?: number) => readTeamMemberHistory({ subagentDir: dir, run, memberId: 'mercury@solar', frame, nextCreatedAt });
  expect((await read(0)).history.map(item => item.uuid)).toEqual(['one']);
  expect((await read(1)).history.map(item => item.uuid)).toEqual(['one', 'two', 'three']);
  expect((await read(1, 3200)).history.map(item => item.uuid)).toEqual(['one', 'two']);
  expect((await read(0)).history[0].isSidechain).toBe(false);
});

test('invalid member and frame requests cannot read unrelated transcripts', async () => {
  const { dir, run, write } = await fixture();
  await write('first', [event('one', 1500)]);
  await expect(readTeamMemberHistory({ subagentDir: dir, run, memberId: '../secret', frame: 0 })).rejects.toThrow('member not found');
  await expect(readTeamMemberHistory({ subagentDir: dir, run, memberId: 'mercury@solar', frame: 20 })).rejects.toThrow('Invalid team frame');
  await fs.unlink(path.join(dir, 'agent-first.jsonl'));
  await fs.symlink(path.join(dir, 'agent-first.meta.json'), path.join(dir, 'agent-first.jsonl'));
  expect((await readTeamMemberHistory({ subagentDir: dir, run, memberId: 'mercury@solar', frame: 0 })).history).toEqual([]);
});

test('retained assignment metadata resolves departed members after membership snapshots are trimmed', async () => {
  const { dir, run, write } = await fixture();
  await write('first', [event('one', 1500)]);
  run.snapshots = [{ ...run.snapshots[1], tasks: [{ metadata: { agentTeamAssignment: true, agentTeamAgentId: 'mercury@solar', agentTeamAgentName: 'mercury' } }] }];
  expect((await readTeamMemberHistory({ subagentDir: dir, run, memberId: 'mercury@solar', frame: 0 })).history).toHaveLength(1);
});
