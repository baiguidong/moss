// Local model fixture, real built runtime. Build: bun run build:electron-direct.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCoordinatorStressFixture, bounded, deferred, pause } from './helpers/coordinator-stress-fixture.mjs';

const output = process.stdout.write.bind(process.stdout);
const fixture = await createCoordinatorStressFixture();
const results = [];
async function metadata(item) {
  const id = item.tasks()[0].agentId;
  return JSON.parse(await readFile(path.join(item.workspace, item.session.sessionId, 'subagents', `agent-${id}.meta.json`), 'utf8'));
}
async function check(name, fn) {
  if (process.env.MOSS_STRESS_FILTER && !new RegExp(process.env.MOSS_STRESS_FILTER).test(name)) return;
  const start = performance.now();
  try { await bounded(fn(), name, 30000); results.push({ name, ok: true, ms: Math.round(performance.now() - start) }); }
  catch (error) { results.push({ name, ok: false, error: String(error.stack || error) }); process.exitCode = 1; }
  output(JSON.stringify(results.at(-1)) + '\n');
}
try {
  await check('delayed workers survive successful Agent tool completion', async () => {
    const item = await fixture.scenario('delayed', 4, async () => ({ delay: 300 }));
    const turn = item.send();
    await turn.done;
    assert.equal(item.tasks().length, 4);
    assert(item.tasks().every(task => task.status === 'completed'), JSON.stringify(item.tasks().map(task => ({ status: task.status, error: task.error }))));
    const context = JSON.stringify(item.state.parentRequests.at(-1));
    for (let i = 0; i < 4; i++) assert(context.includes(`RESULT:delayed:${i}:1`), `Missing worker result ${i}`);
  });

  await check('6 concurrent sessions x 12 workers deliver every result to its owner', async () => {
    const batch = await Promise.all(Array.from({ length: 6 }, (_, i) => fixture.scenario(`burst${i}`, 12, async ({ index }) => ({ delay: 20 + ((index * 37) % 130) }))));
    await Promise.all(batch.map(async (item, i) => {
      await item.send().done;
      assert.equal(item.tasks().length, 12);
      assert(item.tasks().every(task => task.status === 'completed'), `Session ${i} has non-completed workers`);
      const context = JSON.stringify(item.state.parentRequests.at(-1));
      for (let worker = 0; worker < 12; worker++) assert(context.includes(`RESULT:burst${i}:${worker}:1`), `Missing ${i}/${worker}`);
      for (let other = 0; other < 6; other++) if (i !== other) assert(!context.includes(`RESULT:burst${other}:`), 'Cross-session notification');
    }));
  });

  await check('concurrent worker output paths are inside the owning engine session', async () => {
    const batch = await Promise.all([fixture.scenario('paths1'), fixture.scenario('paths2')]);
    await Promise.all(batch.map(async item => {
      const messages = await item.send().done;
      const launched = messages.find(message => message.tool_use_result?.status === 'async_launched')?.tool_use_result;
      assert(launched, 'Missing launch receipt');
      assert(launched.outputFile.includes(`${path.sep}${item.session.sessionId}${path.sep}`), `Wrong session path: ${launched.outputFile}; owner=${item.session.sessionId}`);
    }));
  });

  await check('25 continuations keep one worker and a duplicate-free transcript', async () => {
    const item = await fixture.scenario('resume');
    await item.send().done;
    const id = item.tasks()[0].agentId;
    for (let turn = 1; turn <= 25; turn++) {
      item.resume(0, `Follow-up ${turn}`);
      await item.send(`Continue ${turn}`).done;
      assert.equal(item.tasks().length, 1);
      assert.equal(item.tasks()[0].agentId, id);
      assert.equal(item.tasks()[0].status, 'completed');
      assert.equal(item.state.runs.get(0), turn + 1);
    }
    await item.session.prepareForIdleDispose();
    const transcript = (await readFile(path.join(item.workspace, item.session.sessionId, 'subagents', `agent-${id}.jsonl`), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line)).filter(entry => ['user', 'assistant'].includes(entry.type));
    assert.equal(new Set(transcript.map(entry => entry.uuid)).size, transcript.length);
    for (let turn = 1; turn <= 25; turn++) assert(transcript.some(entry => entry.message?.content === `Follow-up ${turn}` || JSON.stringify(entry.message?.content).includes(`Follow-up ${turn}`)));
  });

  await check('API failure can be resumed and return to completed', async () => {
    const item = await fixture.scenario('failure', 1, async ({ run }) => run === 1 ? { error: 'invalid request from stress fixture' } : {});
    const failing = item.send();
    try { await bounded(failing.done, 'failure notification', 5000); }
    catch (error) { output(JSON.stringify({ diagnostic: 'failure', tasks: item.tasks().map(t => ({status:t.status,error:t.error})), runs:[...item.state.runs], requests:item.state.parentRequests.length, errors:fixture.errors, messages:failing.messages.slice(-3) })+'\n'); item.session.abort(); await failing.settled; throw error; }
    assert.equal(item.tasks()[0].status, 'failed');
    item.resume();
    await item.send('Retry after reducing context').done;
    assert.equal(item.tasks()[0].status, 'completed');
    assert.equal((await metadata(item)).status, 'completed');
  });

  await check('Stop inside task registration prevents any worker API request', async () => {
    const item = await fixture.scenario('registration', 12);
    const unsubscribe = item.session.subscribe(() => {
      if (item.tasks().some(task => task.status === 'running')) item.session.abort();
    });
    await item.send().settled;
    unsubscribe();
    await pause(100);
    assert.equal(item.state.workerRequests.length, 0);
    assert(item.tasks().every(task => task.status !== 'running'));
  });

  await check('20 immediate Stop and resume cycles do not leave old workers running', async () => {
    const item = await fixture.scenario('stopresume', 1, async ({ run }) => ({ delay: run % 2 === 1 ? 300 : 0 }));
    for (let cycle = 0; cycle < 20; cycle++) {
      const started = deferred();
      item.state.onWorker = started.resolve;
      if (cycle) item.resume();
      const interrupted = item.send();
      await bounded(Promise.race([started.promise, interrupted.done.then(() => { throw new Error('Worker ended before Stop'); })]), 'worker start');
      item.session.abort();
      item.session.abort();
      await interrupted.settled;
      item.resume();
      const resumed = await item.send('Resume immediately').done;
      assert.equal(item.tasks().length, 1);
      assert.equal(item.tasks()[0].status, 'completed', `Cycle ${cycle}: ${JSON.stringify(resumed.filter(message=>message.type==='user'))}`);
      const persisted = await metadata(item);
      assert.equal(persisted.status, 'completed');
      assert.equal(persisted.errorCode, undefined);
    }
  });

  await check('pre-aborted send starts no workers and the same session remains usable', async () => {
    const item = await fixture.scenario('preabort', 4);
    const controller = new AbortController();
    controller.abort();
    await item.send(undefined, controller.signal).settled;
    assert.equal(item.state.parentRequests.length, 0);
    assert.equal(item.state.workerRequests.length, 0);
    await item.send().done;
    assert.equal(item.tasks().length, 4);
    assert(item.tasks().every(task => task.status === 'completed'));
  });

  await check('aborting and disposing two sessions preserves 48 workers in three other sessions', async () => {
    const batch = await Promise.all(Array.from({ length: 5 }, (_, i) => fixture.scenario(`isolation${i}`, 16, async () => ({ delay: 800 }))));
    const ready = batch.map(() => deferred());
    batch.forEach((item, i) => { item.state.onWorker = () => { if (item.state.workerRequests.length === 16) ready[i].resolve(); }; });
    const turns = batch.map(item => item.send());
    await bounded(Promise.all(ready.map(item => item.promise)), 'all 80 workers started');
    const controllers = batch.slice(0, 2).flatMap(item => item.tasks().map(task => task.abortController));
    batch[0].session.abort();
    await batch[1].session.dispose();
    await Promise.all(turns.slice(0, 2).map(turn => turn.settled));
    assert(controllers.every(controller => controller.signal.aborted));
    assert(batch[0].tasks().every(task => task.status === 'killed'));
    await Promise.all(turns.slice(2).map(turn => turn.done));
    for (const item of batch.slice(2)) {
      assert.equal(item.tasks().length, 16);
      assert(item.tasks().every(task => task.status === 'completed'));
    }
  });
  assert.deepEqual(fixture.errors, []);
} finally {
  await fixture.close();
  output(JSON.stringify({ summary: { passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, ...fixture.stats() } }) + '\n');
}
