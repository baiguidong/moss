import { afterEach, expect, test } from 'bun:test';
import { _resetTaskOutputDirForTest, getTaskOutputDir } from '../../src/utils/task/diskOutput';
import { cwdOverrideStorage } from '../../src/utils/cwdContext';
import { runWithSessionIdContext } from '../../src/utils/sessionIdContext';
import { asSessionId } from '../../src/types/ids';

afterEach(_resetTaskOutputDirForTest);
function directory(id: string, cwd: string) {
  return runWithSessionIdContext(asSessionId(id), null, () => (
    cwdOverrideStorage.run({ cwd, originalCwd: cwd }, getTaskOutputDir)
  ));
}

test('concurrent sessions in one workspace never share an output directory', async () => {
  const entries = await Promise.all(Array.from({ length: 200 }, async (_, i) => directory(`session-${i}`, '/tmp/shared-project')));
  expect(new Set(entries).size).toBe(200);
  entries.forEach((entry, i) => expect(entry).toContain(`/session-${i}/tasks`));
});

test('a worker changing cwd keeps its session output directory without affecting another session', () => {
  const original = directory('parent', '/tmp/project-one');
  const other = directory('other', '/tmp/project-two');
  expect(original).not.toBe(other);
  expect(directory('parent', '/tmp/project-one/worktree')).toBe(original);
  expect(directory('other', '/tmp/project-two/worktree')).toBe(other);
});
