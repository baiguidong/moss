// Build first: bun run build:electron-direct. Uses only a local model fixture.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCoordinatorStressFixture, bounded } from './helpers/coordinator-stress-fixture.mjs';
import { buildProjectSystemPrompts } from '../src/shared/project-system-prompts.mjs';

process.env.MOSS_RUNTIME_ADVANCED_SETTINGS = JSON.stringify({ moss_streaming_tool_execution: true });
process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1';
const report = process.stdout.write.bind(process.stdout);
const fixture = await createCoordinatorStressFixture();
const projectPrompts = buildProjectSystemPrompts({ id: 'fixture-project', name: 'ESP32' }, { instructions: 'SHARED_PROJECT_CONSTRAINT' });
const text = body => JSON.stringify(body.system);
const names = body => (body.tools || []).map(tool => tool.name);
try {
  const ui = await fixture.scenario('ui', 1, async () => ({}), {
    ...projectPrompts,
    presentationEnabled: true,
    onAppEvent: async () => ({ ok: true }),
    projectMemory: async () => ({}), projectResult: async () => ({}),
    customSystemPrompt: 'MAIN_IDENTITY_RETAINED',
  });
  // Exercise a genuinely separate Agent definition, matching the reported case.
  const agentsDir = path.join(ui.workspace, '.moss', 'agents');
  await mkdir(agentsDir, { recursive: true });
  await writeFile(path.join(agentsDir, 'document-worker.md'), '---\nname: document-worker\ndescription: Generate the design document\n---\nDOCUMENT_WORKER_IDENTITY\nComplete the assigned task and return its result.\n');
  ui.state.batch[0].input.subagent_type = 'document-worker';
  const checkUi = async () => {
    const previousWorkers = ui.state.workerRequests.length;
    const messages = await bounded(ui.send().done, 'main and worker prompt scope');
    assert.ok(ui.state.workerRequests.length > previousWorkers, JSON.stringify(messages.filter(message => message.type === 'user' || message.type === 'result')));
    const parent = ui.state.parentRequests.at(-1);
    assert.match(text(parent), /MAIN_IDENTITY_RETAINED/);
    assert.match(text(parent), /SHARED_PROJECT_CONSTRAINT/);
    for (const tool of ['moss_present', 'ProjectResult', 'ProjectMemory']) {
      assert.match(text(parent), new RegExp(tool));
      assert.ok(names(parent).includes(tool), `${tool} missing from Boss main session`);
    }
    for (const { body } of ui.state.workerRequests) {
      assert.match(text(body), /DOCUMENT_WORKER_IDENTITY/);
      assert.doesNotMatch(text(body), /MAIN_IDENTITY_RETAINED|ProjectResult|ProjectMemory|moss_present|result previews/);
      assert.ok(!names(body).some(name => ['moss_present', 'ProjectResult', 'ProjectMemory'].includes(name)));
    }
  };
  await checkUi();
  ui.resume();
  await checkUi();
  await ui.restart();
  ui.resume();
  await checkUi();

  for (const [name, options] of [
    ['headless', {}],
    ['bridge_only', { onAppEvent: async () => ({ ok: true }) }],
    ['no_bridge', { presentationEnabled: true }],
    ['filtered', { presentationEnabled: true, onAppEvent: async () => ({ ok: true }), allowedTools: ['Agent', 'SendMessage'] }],
  ]) {
    const item = await fixture.scenario(name, 1, async () => ({}), options);
    await bounded(item.send().done, `${name} has no presentation instructions`);
    assert.ok(item.state.parentRequests.length && item.state.workerRequests.length);
    for (const body of [...item.state.parentRequests, ...item.state.workerRequests.map(item => item.body)]) {
      assert.doesNotMatch(text(body), /moss_present|result previews|已请求预览|File change counts are verified by Moss/);
      assert.ok(!names(body).includes('moss_present'));
    }
  }
  assert.deepEqual(fixture.errors, []);
  report('PASS: main-only host prompts/tools; separate worker identity; continued/restored workers; no UI instructions without capability, bridge or allowed tool.\n');
} catch (error) {
  report(String(error.stack || error) + '\n');
  process.exitCode = 1;
} finally {
  await fixture.close();
}
