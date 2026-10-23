// Real streaming executor, persistence, SendMessage routing and file tools, with a local model fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCoordinatorStressFixture, bounded } from './helpers/coordinator-stress-fixture.mjs';

process.env.MOSS_RUNTIME_ADVANCED_SETTINGS = JSON.stringify({ moss_streaming_tool_execution: true });
const report = process.stdout.write.bind(process.stdout);
const fixture = await createCoordinatorStressFixture();
try {
  const item = await fixture.scenario('document', 1, async ({ run }) => {
    if (run === 1) return { error: 'fixture: worker interrupted before document generation' };
    if (run === 2) return { blocks: [{ type: 'tool_use', id: 'write_document', name: 'Write', input: {
      file_path: path.join(item.workspace, 'ESP32采购计划.md'), content: '# ESP32 玩具采购计划\n\n测试文档已实际保存。\n',
    } }] };
    return { delay: 50 };
  });
  const userId = randomUUID();
  const first = await bounded(item.send('STRESS_CASE:document 帮我保存成文档', undefined, {
    userMessageId: userId,
  }).done, 'failed worker receipt');
  const id = item.tasks()[0].agentId;
  assert.equal(item.tasks()[0].status, 'failed');
  assert(!first.some(message => message.type === 'user' && !message.isSynthetic && JSON.stringify(message.message).includes('<task-notification>')), 'Task notification leaked as human input');
  await item.restart();
  const transcript = (await readFile(path.join(item.workspace, `${item.session.sessionId}.jsonl`), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(transcript.find(message => message.uuid === userId)?.message.content, 'STRESS_CASE:document 帮我保存成文档');
  const notifications = transcript.filter(message => message.type === 'user' && JSON.stringify(message.message).includes('<task-notification>'));
  assert(notifications.length && notifications.every(message => message.isMeta), 'Persisted task receipts need provenance');
  const request = JSON.stringify(item.state.parentRequests[0]);
  assert(request.includes('帮我保存成文档'));
  assert.equal(item.session.getAppState()?.agentNameRegistry.size || 0, 0, 'Restore must exercise name resolution from disk');
  item.resume(0, 'Save the ESP32 document now.');
  const resumed = await bounded(item.send('STRESS_CASE:document 文档呢').done, 'resume named worker after runtime restart');
  assert.equal(item.tasks().length, 1);
  assert.equal(item.tasks()[0].agentId, id);
  assert.equal(item.tasks()[0].status, 'completed', JSON.stringify(resumed));
  assert((await readFile(path.join(item.workspace, 'ESP32采购计划.md'), 'utf8')).includes('测试文档已实际保存'));
  const other = await fixture.scenario('unknown', 0);
  other.resume(0, 'Do not deliver to another session.');
  const missing = await other.send().done;
  assert(missing.some(message => JSON.stringify(message).includes('No agent or teammate named')));
  assert.equal(other.state.workerRequests.length, 0);
  assert.deepEqual(fixture.errors, []);
  report('PASS: streaming worker resumes by saved name after runtime restart and writes a real document; unknown recipients fail; persisted task notifications remain distinct from human input.\n');
} catch (error) { report(String(error.stack || error) + '\n'); process.exitCode = 1; }
finally { await fixture.close(); }
