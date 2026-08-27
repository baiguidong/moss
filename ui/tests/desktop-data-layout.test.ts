import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import {
  createDesktopDataPaths,
  DESKTOP_PROJECT_KIND,
  DESKTOP_PROJECT_LAYOUT_VERSION,
  DESKTOP_SESSION_KIND,
  DESKTOP_SESSION_LAYOUT_VERSION,
  isDesktopProjectRecord,
  withDesktopProjectLayout,
} from '../src/desktop-data-layout.mjs';

describe('desktop data layout', () => {
  it('keeps durable projects and session runtime data in separate roots', () => {
    const home = path.resolve('moss-home');
    const paths = createDesktopDataPaths(home);

    expect(paths.projectWorkspaceDir('project-1'))
      .toBe(path.join(home, 'projects', 'project-1', 'workspace'));
    expect(paths.projectRunsDir('project-1'))
      .toBe(path.join(home, 'projects', 'project-1', 'runtime', 'runs'));
    expect(paths.sessionResourceManifestPath('session-1'))
      .toBe(path.join(home, 'sessions', 'session-1', 'runtime', 'resource-manifest.json'));
    expect(paths.sessionTranscriptPath('session-1', 'engine-1'))
      .toBe(path.join(home, 'sessions', 'session-1', 'runtime', 'engine', 'engine-1.jsonl'));
  });

  it('only recognizes records written for the new project layout', () => {
    const record = withDesktopProjectLayout({ id: 'project-1', name: 'Project' });

    expect(record.kind).toBe(DESKTOP_PROJECT_KIND);
    expect(record.layoutVersion).toBe(DESKTOP_PROJECT_LAYOUT_VERSION);
    expect(DESKTOP_PROJECT_LAYOUT_VERSION).toBe(3);
    expect(isDesktopProjectRecord(record)).toBe(true);
    expect(isDesktopProjectRecord({ ...record, layoutVersion: 2 })).toBe(false);
    expect(isDesktopProjectRecord({ id: 'legacy-project', name: 'Legacy' })).toBe(false);
    expect(DESKTOP_SESSION_KIND).toBe('moss-session');
    expect(DESKTOP_SESSION_LAYOUT_VERSION).toBe(2);
  });

  it('rejects path traversal in ids', () => {
    const paths = createDesktopDataPaths('/tmp/moss-home');

    expect(() => paths.projectDir('../outside')).toThrow('Invalid project id.');
    expect(() => paths.sessionDir('session/child')).toThrow('Invalid session id.');
  });
});
