import { describe, expect, test } from 'bun:test';
import { createWorkspaceDirectoryLoader } from '../src/renderer-react/lib/workspace-directory-loader';

function setup() {
  let scope = { sessionId: 'session-a', workspace: '/workspace' };
  const cache = new Map<string, string[]>();
  const requests: Array<{ resolve: (files: string[]) => void; reject: (error: Error) => void }> = [];
  const loader = createWorkspaceDirectoryLoader({
    getScope: () => scope,
    readDirectory: () => new Promise<string[]>((resolve, reject) => requests.push({ resolve, reject })),
    applyDirectory: (dir, files) => cache.set(dir, files),
  });
  return { loader, cache, requests, get scope() { return scope; }, switchTo(next: typeof scope) { scope = next; } };
}

describe('workspace directory refresh', () => {
  test('a slow initial root listing cannot hide a newly created root file', async () => {
    const state = setup();
    const initial = state.loader.load(state.scope, '/workspace');
    const changed = state.loader.load(state.scope, '/workspace');
    state.requests[1]!.resolve(['new.html']);
    await changed;
    state.requests[0]!.resolve([]);
    await initial;
    expect(state.cache.get('/workspace')).toEqual(['new.html']);
  });

  test('root refresh preserves a folder expanded while the refresh is pending', async () => {
    const state = setup();
    const root = state.loader.load(state.scope, '/workspace');
    const folder = state.loader.load(state.scope, '/workspace/nested');
    state.requests[1]!.resolve(['nested.html']);
    await folder;
    state.requests[0]!.resolve(['nested']);
    await root;
    expect(state.cache.get('/workspace/nested')).toEqual(['nested.html']);
    expect(state.cache.get('/workspace')).toEqual(['nested']);
  });

  test('a failed refresh keeps the last successful directory contents', async () => {
    const state = setup();
    state.cache.set('/workspace', ['existing.html']);
    const failed = state.loader.load(state.scope, '/workspace');
    state.requests[0]!.reject(new Error('Temporary read failure'));
    await expect(failed).rejects.toThrow('Temporary read failure');
    expect(state.cache.get('/workspace')).toEqual(['existing.html']);
  });

  test('old requests cannot populate another session or a reopened workspace', async () => {
    const state = setup();
    const old = state.loader.load(state.scope, '/workspace');
    state.switchTo({ sessionId: 'session-b', workspace: '/workspace' });
    state.requests[0]!.resolve(['from-session-a']);
    await old;
    expect(state.cache.size).toBe(0);
    const pending = state.loader.load(state.scope, '/workspace');
    state.loader.reset();
    state.requests[1]!.resolve(['from-previous-open']);
    await pending;
    expect(state.cache.size).toBe(0);
  });
});
