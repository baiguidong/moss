import { afterEach, describe, expect, it } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';

import {
  buildRemoteSkillArchive,
  synchronizeRemoteSkills,
} from '../src/remote-profile-sync.mjs';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => (
    fsp.rm(entry, { recursive: true, force: true })
  )));
});

describe('remote profile skill synchronization', () => {
  it('builds a deterministic archive rooted by skill name', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-remote-skills-'));
    cleanup.push(root);
    await fsp.mkdir(path.join(root, 'demo', 'scripts'), { recursive: true });
    await fsp.writeFile(path.join(root, 'demo', 'SKILL.md'), '# Demo\n');
    await fsp.writeFile(path.join(root, 'demo', 'scripts', 'run.sh'), '#!/bin/sh\n');
    await fsp.mkdir(path.join(root, 'demo', 'node_modules', 'ignored'), { recursive: true });
    await fsp.writeFile(path.join(root, 'demo', 'node_modules', 'ignored', 'x.js'), 'ignored');

    const first = await buildRemoteSkillArchive(root);
    const second = await buildRemoteSkillArchive(root);
    const zip = await JSZip.loadAsync(first.archive);

    expect(first.revision).toBe(second.revision);
    expect(first.fileCount).toBe(2);
    expect(Object.keys(zip.files).sort()).toEqual([
      'demo/SKILL.md',
      'demo/scripts/run.sh',
    ]);
  });

  it('skips upload when the server already has the local archive revision', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-remote-skills-'));
    cleanup.push(root);
    await fsp.mkdir(path.join(root, 'demo'), { recursive: true });
    await fsp.writeFile(path.join(root, 'demo', 'SKILL.md'), '# Demo\n');
    const local = await buildRemoteSkillArchive(root);
    let uploads = 0;

    const result = await synchronizeRemoteSkills({
      skillsDir: root,
      connection: { serverUrl: 'https://moss.example.com', authToken: 'token' },
      fetchStatus: async () => ({ revision: local.revision }),
      uploadArchive: async () => {
        uploads += 1;
        return {};
      },
    });

    expect(result.unchanged).toBe(true);
    expect(uploads).toBe(0);
  });
});
