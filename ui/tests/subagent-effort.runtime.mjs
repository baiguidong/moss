// Build first: bun run build:electron-direct. Real Agent/SendMessage requests to a local fixture.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCoordinatorStressFixture, bounded } from './helpers/coordinator-stress-fixture.mjs';

process.env.MOSS_RUNTIME_ADVANCED_SETTINGS = JSON.stringify({ moss_streaming_tool_execution: true });
process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1';
delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
delete process.env.CLAUDE_CODE_DISABLE_THINKING;
const report = process.stdout.write.bind(process.stdout);
const fixture = await createCoordinatorStressFixture();
try {
  // Reproduce the observed gateway behavior: disabled thinking is translated
  // to unsupported effort "none", even when output_config.effort is explicit.
  const adaptive = await fixture.scenario('adaptive', 1, async ({ body }) => body.thinking?.type === 'disabled'
    ? { error: 'gpt-6.1-sol does not support reasoning effort "none"; use low, medium, high, xhigh or max' }
    : {}, {
    model: 'gpt-6.1-sol', thinkingConfig: { type: 'adaptive' }, effort: null,
  });
  const check = async (item, thinking, effort) => {
    const before = item.state.workerRequests.length;
    const messages = await bounded(item.send().done, 'subagent thinking/effort inheritance');
    assert.equal(item.tasks().length, 1, JSON.stringify(messages.filter(message => message.type === 'user' || message.type === 'result')));
    assert.equal(item.tasks()[0].status, 'completed', JSON.stringify(item.tasks().map(task => ({ status: task.status, error: task.error }))));
    assert.equal(item.state.workerRequests.length, before + 1, 'Worker must succeed without compatibility retries');
    const parent = item.state.parentRequests.at(-1);
    const child = item.state.workerRequests.at(-1).body;
    assert.equal(child.model, parent.model);
    assert.deepEqual(parent.thinking, thinking);
    assert.deepEqual(child.thinking, parent.thinking, 'Workers must inherit the main thinking mode and budget');
    if (thinking === undefined) {
      assert.equal(Object.hasOwn(parent, 'thinking'), false);
      assert.equal(Object.hasOwn(child, 'thinking'), false);
    }
    assert.equal(parent.output_config?.effort, effort);
    assert.equal(child.output_config?.effort, parent.output_config?.effort);
  };
  await check(adaptive, { type: 'adaptive' }, undefined);
  const agentId = adaptive.tasks()[0].agentId;
  adaptive.session.setEffort('high');
  adaptive.resume();
  await check(adaptive, { type: 'adaptive' }, 'high');
  await adaptive.restart();
  adaptive.session.setEffort('max');
  adaptive.resume();
  await check(adaptive, { type: 'adaptive' }, 'max');
  assert.equal(adaptive.tasks()[0].agentId, agentId, 'Resume must keep the original worker');

  const custom = await fixture.scenario('custom', 1, async () => ({}), {
    model: 'gpt-6.1-sol', thinkingConfig: { type: 'enabled', budgetTokens: 8000 }, effort: 'medium',
  });
  const agentsDir = path.join(custom.workspace, '.moss', 'agents');
  await mkdir(agentsDir, { recursive: true });
  await writeFile(path.join(agentsDir, 'effort-worker.md'), '---\nname: effort-worker\ndescription: Verify inherited effort\nmodel: inherit\neffort: low\n---\nComplete the requested fixture task.\n');
  custom.state.batch[0].input.subagent_type = 'effort-worker';
  await check(custom, { type: 'enabled', budget_tokens: 8000 }, 'medium');

  const disabled = await fixture.scenario('disabled', 1, async () => ({}), {
    model: 'gpt-6.1-sol', thinkingConfig: { type: 'disabled' }, effort: 'low',
  });
  await check(disabled, { type: 'disabled' }, 'low');
  disabled.session.setEffort(null);
  disabled.resume();
  await check(disabled, { type: 'disabled' }, undefined);

  const unspecified = await fixture.scenario('unspecified', 1, async () => ({}), {
    model: 'gpt-6.1-sol', thinkingConfig: undefined, effort: null,
  });
  await check(unspecified, undefined, undefined);
  await unspecified.restart();
  unspecified.resume();
  await check(unspecified, undefined, undefined);
  const auto = await fixture.scenario('auto', 1, async () => ({}), {
    model: 'gpt-6.1-sol', thinkingConfig: { type: 'auto' }, effort: 'low',
  });
  await check(auto, undefined, 'low');
  assert.deepEqual(fixture.errors, []);
  report('PASS: subagents inherit main thinking mode/budget and effort on HTTP requests; restored workers follow updated/auto effort; agent presets do not override the session; explicit disabled stays disabled; unset thinking/effort are omitted.\n');
} catch (error) {
  report(String(error.stack || error) + '\n');
  process.exitCode = 1;
} finally {
  await fixture.close();
}
