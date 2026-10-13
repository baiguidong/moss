import { expect, test } from 'bun:test';
import { registerSessionEffortIpc } from '../src/session-effort.mjs';

test('visual effort control updates only the chosen runtime and persists without sending a prompt', async () => {
  const handlers = new Map();
  const levels = ['low', 'medium', 'high', 'xhigh'];
  const configuration = (model, effort) => ({ model, configured: effort ?? null, applied: effort ?? null, levels, overridden: false });
  const saved = [];
  const applied = [];
  const sessions = new Map([
    ['a', { effort: null, runtime: {
      getEffort: () => configuration('gpt-5.5', applied.at(-1)),
      setEffort: effort => { applied.push(effort); return configuration('gpt-5.5', effort); },
      send: () => { throw new Error('UI must not send a command'); },
    } }],
    ['b', { effort: null }],
  ]);
  registerSessionEffortIpc({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    getSessionRecord: id => sessions.get(id), getSettings: () => ({ model: 'gpt-5.5' }),
    getRuntimeModule: async () => ({ getSessionEffortConfiguration: configuration }),
    persist: record => saved.push(record.effort), emit: () => {},
  });
  const set = (sessionId, effort) => handlers.get('agent:set-session-effort')(null, { sessionId, effort });
  expect((await set('a', 'low')).applied).toBe('low');
  expect(sessions.get('b').effort).toBeNull();
  expect(applied).toEqual(['low']);
  expect((await set('b', 'xhigh')).applied).toBe('xhigh');
  expect(applied).toEqual(['low']);
  expect(saved).toEqual(['low', 'xhigh']);
  await expect(set('a', 'max')).rejects.toThrow('不支持');
  await expect(set('a', 'bad')).rejects.toThrow('无效');
  expect(saved).toHaveLength(2);
  expect((await set('a', null)).applied).toBeNull();
});
