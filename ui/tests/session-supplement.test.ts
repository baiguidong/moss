import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSupplementPreparation } from '../src/session-supplement.mjs';

test('current-task attachments, App document references, skills and explicit agents use validated foreground instructions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-supplement-'));
  try {
    const file = path.join(root, 'data.txt'); await writeFile(file, 'fixture');
    let localized: string[] = [];
    const prepare = createSupplementPreparation({ localizeFiles: async (_record: any, paths: string[]) => { localized = paths; return paths; },
      isResourceUri: (uri: string) => uri.startsWith('app://'), resolveResource: async () => ({ path: file }),
      getAgentCatalog: async () => ({ agents: [{ agentType: 'reviewer', active: true }] }) });
    const record = { workspace: root, isCoordinatorMode: true };
    const details = { intent: 'boss', files: [{ name: 'data.txt', path: file }, { name: 'app.txt', resource: { uri: 'app://document', selection: 'full-file' } }], skills: [{ name: 'review' }], agentType: 'reviewer' };
    const text = await prepare(record, { prompt: 'keep working', details });
    expect(text).toContain('keep working'); expect(text).toContain(file); expect(text).toContain('review'); expect(text).toContain('reviewer');
    expect(localized).toEqual([file, file]);
    await expect(prepare(record, { prompt: 'bad agent', details: { intent: 'boss', agentType: 'missing' } })).rejects.toThrow('不可用');
    await expect(prepare(record, { prompt: 'missing file', details: { intent: 'boss', files: [{ path: path.join(root, 'missing') }] } })).rejects.toThrow();
    for (const value of [{ prompt: '/compact', details: {} }, { prompt: 'switch', details: { intent: 'chat' } }, { prompt: 'app', details: { appSelection: { providerId: 'app/flow' } } }]) {
      expect(await prepare(record, value)).toBeNull();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
