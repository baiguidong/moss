// Real Git worktrees + real runtime, local model fixture; delay only worktree status inspection.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCoordinatorStressFixture, pause, bounded } from './helpers/coordinator-stress-fixture.mjs';

const report = process.stdout.write.bind(process.stdout);
let stage = 'setup';
const watchdog = setTimeout(() => { report(`Timed out during ${stage}\n`); process.exit(1); }, 45000);
const shimRoot = await mkdtemp(path.join(tmpdir(), 'moss-git-delay-'));
const originalPath = process.env.PATH;
const git = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
await mkdir(path.join(shimRoot, 'bin'));
await writeFile(path.join(shimRoot, 'bin/git'), `#!/bin/sh
case "$PWD" in
  */.moss/worktrees/*)
    if [ "$1" = status ] && [ "$2" = --porcelain ]; then sleep 0.6; fi
    ;;
esac
exec ${quote(git)} "$@"
`, { mode: 0o755 });
process.env.PATH = `${path.join(shimRoot, 'bin')}:${originalPath}`;
stage = 'runtime import';
const fixture = await createCoordinatorStressFixture();
function initializeGit(item) {
  for (const args of [
    ['init', '-q'], ['config', 'user.name', 'Moss Test'], ['config', 'user.email', 'moss-test@example.invalid'],
    ['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'Fixture'],
  ]) execFileSync(git, args, { cwd: item.workspace, stdio: 'pipe' });
  item.state.batch[0].input.isolation = 'worktree';
}
try {
  stage = 'scenario';
  const item = await fixture.scenario('worktreedelayed');
  stage = 'git init';
  initializeGit(item);
  stage = 'send';
  const turn = item.send();
  try { await bounded(turn.done, 'worktree result', 20000); }
  catch (error) { report(JSON.stringify({ tasks: item.tasks(), messages: turn.messages.slice(-3), errors: fixture.errors }) + '\n'); item.session.abort(); await turn.settled; throw error; }
  const context = JSON.stringify(item.state.parentRequests.at(-1));
  assert(context.includes('RESULT:worktreedelayed:0:1'), `Boss returned before receiving the worker result: ${JSON.stringify(item.tasks().map(task => ({ status: task.status, notified: task.notified })))}`);
  report('PASS: Boss receives its worker result despite delayed Git worktree cleanup\n');

  let resumedWorktree;
  const resumed = await fixture.scenario('worktreeresume', 1, async ({ run }) => {
    if (run === 2) {
      const id = resumed.tasks()[0].agentId;
      const meta = JSON.parse(await readFile(path.join(resumed.workspace, resumed.session.sessionId, 'subagents', `agent-${id}.meta.json`), 'utf8'));
      resumedWorktree = meta.worktreePath;
    }
    return {};
  });
  initializeGit(resumed);
  let stopped = false;
  const unsubscribe = resumed.session.subscribe(() => {
    if (!stopped && resumed.tasks().some(task => task.status === 'completed')) {
      stopped = true;
      resumed.session.abort();
    }
  });
  await bounded(resumed.send().settled, 'stop during cleanup');
  unsubscribe();
  assert(stopped);
  resumed.resume();
  await bounded(resumed.send('Resume during old cleanup').done, 'resume during cleanup');
  assert.equal(resumed.state.runs.get(0), 2);
  assert.equal(resumed.tasks()[0].status, 'completed');
  assert.equal(resumedWorktree, undefined, 'Resume entered a worktree that the old execution was still removing');
  report('PASS: immediate resume waits for old worktree cleanup and uses a valid workspace\n');
  assert.deepEqual(fixture.errors, []);
} catch (error) { report(String(error.stack || error) + '\n'); process.exitCode = 1; }
finally {
  stage = 'cleanup';
  await pause(1000); // Let deliberately delayed Git subprocesses finish before removing their temporary repo.
  await bounded(fixture.close(), 'fixture close', 5000);
  process.env.PATH = originalPath;
  await rm(shimRoot, { recursive: true, force: true });
  clearTimeout(watchdog);
}
// Git repository watchers are process-wide runtime caches, independent of the
// two disposed test sessions. The test has finished all its explicit cleanup.
process.exit(process.exitCode || 0);
