// Gate the worker response on actual queue acceptance, without timing sleeps.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCoordinatorStressFixture, deferred, bounded } from './helpers/coordinator-stress-fixture.mjs';

const report = process.stdout.write.bind(process.stdout);
const fixture = await createCoordinatorStressFixture();
try {
  for (const withTool of [false, true]) {
  const name = withTool ? 'queuedtool' : 'queuedmessage';
  const started = deferred(), accepted = deferred();
  const item = await fixture.scenario(name, 1, async ({ run }) => {
    if (run === 1) { started.resolve(); await accepted.promise; }
    if (run === 1 && withTool) return { blocks: [{
      type: 'tool_use', id: 'worker_read', name: 'Read', input: { file_path: path.join(item.workspace, 'fixture.txt') },
    }] };
    return {};
  });
  await writeFile(path.join(item.workspace, 'fixture.txt'), 'Local test content');
  const instructions = ['FOLLOWUP_ALPHA: inspect the UI', 'FOLLOWUP_BETA: inspect persistence'];
  item.state.onParent = async () => {
    if (item.state.parentRequests.length !== 2) return;
    await started.promise;
    for (const message of instructions) item.resume(0, message);
  };
  const unsubscribe = item.session.subscribe(() => {
    if (item.tasks()[0]?.pendingMessages?.length === instructions.length) accepted.resolve();
  });
  try {
    await bounded(item.send().done, 'messages queued while the worker ends without tool calls');
    assert.equal(item.state.runs.get(0), 2, 'Accepted follow-ups must trigger a worker continuation');
    const followup = JSON.stringify(item.state.workerRequests[1]?.body.messages);
    for (const message of instructions) assert.equal(followup.split(message).length - 1, 1, `Instruction must be delivered once: ${message}`);
    assert.deepEqual(item.tasks()[0].pendingMessages, []);
    assert.equal(item.tasks()[0].status, 'completed');
    const parentContext = JSON.stringify(item.state.parentRequests.at(-1));
    assert(parentContext.includes(`RESULT:${name}:0:2`), 'Boss needs the result after processing follow-ups');
    await item.session.prepareForIdleDispose();
    const transcript = await readFile(path.join(item.workspace, item.session.sessionId, 'subagents', `agent-${item.tasks()[0].agentId}.jsonl`), 'utf8');
    for (const message of instructions) assert(transcript.includes(message), 'Accepted instructions must survive resume');
    item.resume(0, 'Verify the earlier instructions are still in context');
    await bounded(item.send('Resume the same worker').done, 'resume after queued instructions');
    const restored = JSON.stringify(item.state.workerRequests.at(-1).body.messages);
    for (const message of instructions) assert.equal(restored.split(message).length - 1, 1, 'Resume must retain each earlier instruction exactly once');
    report(`PASS: ${withTool ? 'tool' : 'text-only'} boundary delivers and persists each instruction once, including after resume\n`);
  } finally { unsubscribe(); accepted.resolve(); }
  }
  assert.deepEqual(fixture.errors, []);
} catch (error) { report(String(error.stack || error) + '\n'); process.exitCode = 1; }
finally { await fixture.close(); }
