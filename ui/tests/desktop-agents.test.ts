import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildExplicitAgentDispatchInstruction,
  createDesktopAgentStore,
  findProjectBoundary,
  parseAgentDocument,
} from '../src/desktop-agents.mjs';

const temporaryRoots: string[] = [];

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-desktop-agents-'));
  temporaryRoots.push(root);
  const userAgentsDir = path.join(root, 'home', '.moss', 'agents');
  const projectRoot = path.join(root, 'project');
  const workspace = path.join(projectRoot, 'packages', 'app');
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  return {
    root,
    userAgentsDir,
    projectRoot,
    workspace,
    store: createDesktopAgentStore({ userAgentsDir }),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('desktop Agents store', () => {
  it('creates, reads, renames and deletes custom Agents', async () => {
    const fixture = createFixture();
    const created = await fixture.store.create({
      workspace: fixture.workspace,
      scope: 'user',
      name: 'code-reviewer',
      description: 'Review risky changes',
      prompt: 'Review the implementation and report concrete defects.',
      model: 'inherit',
      tools: ['Read', 'Grep', 'Read'],
      background: true,
    });

    expect(created.path).toBe(path.join(fs.realpathSync(fixture.userAgentsDir), 'code-reviewer.md'));
    expect(await fixture.store.read({
      workspace: fixture.workspace,
      scope: 'user',
      fileName: 'code-reviewer.md',
    })).toMatchObject({
      name: 'code-reviewer',
      tools: ['Read', 'Grep'],
      background: true,
    });

    const parsed = parseAgentDocument(fs.readFileSync(created.path, 'utf8'));
    expect(parsed.metadata.description).toBe('Review risky changes');
    expect(parsed.prompt).toContain('report concrete defects');
    fs.writeFileSync(
      created.path,
      fs.readFileSync(created.path, 'utf8').replace('---\n', '---\nmemory: project\n'),
    );

    const updated = await fixture.store.update({
      workspace: fixture.workspace,
      previousScope: 'user',
      previousFileName: 'code-reviewer.md',
      scope: 'project',
      name: 'release-reviewer',
      description: 'Review releases',
      prompt: 'Verify the release.',
      model: '',
      tools: [],
      background: false,
    });
    expect(updated.path).toBe(path.join(
      fs.realpathSync(path.join(fixture.projectRoot, '.moss', 'agents')),
      'release-reviewer.md',
    ));
    expect(fs.existsSync(created.path)).toBe(false);
    expect(parseAgentDocument(fs.readFileSync(updated.path, 'utf8')).metadata.memory)
      .toBe('project');

    await fixture.store.remove({
      workspace: fixture.workspace,
      scope: 'project',
      fileName: 'release-reviewer.md',
    });
    expect(fs.existsSync(updated.path)).toBe(false);
  });

  it('uses the git root for project Agents', () => {
    const fixture = createFixture();
    expect(findProjectBoundary(fixture.workspace)).toBe(fixture.projectRoot);
    expect(fixture.store.getRoots(fixture.workspace).project)
      .toBe(path.join(fixture.projectRoot, '.moss', 'agents'));
  });

  it('rejects unsafe names and symlink Agent files', async () => {
    const fixture = createFixture();
    await expect(fixture.store.create({
      workspace: fixture.workspace,
      scope: 'user',
      name: '../escape',
      description: 'unsafe',
      prompt: 'unsafe',
    })).rejects.toThrow(/名称/);

    fs.mkdirSync(fixture.userAgentsDir, { recursive: true });
    const outside = path.join(fixture.root, 'outside.md');
    fs.writeFileSync(outside, '---\nname: linked\ndescription: linked\n---\nprompt\n');
    fs.symlinkSync(outside, path.join(fixture.userAgentsDir, 'linked.md'));
    await expect(fixture.store.read({
      workspace: fixture.workspace,
      scope: 'user',
      fileName: 'linked.md',
    })).rejects.toThrow(/符号链接/);
  });

  it('builds a mandatory explicit Boss dispatch instruction', () => {
    const instruction = buildExplicitAgentDispatchInstruction('code-reviewer');
    expect(instruction).toContain('MUST call the Agent tool');
    expect(instruction).toContain('subagent_type="code-reviewer"');
    expect(instruction).toContain('Do not silently substitute another Agent type.');
  });
});
