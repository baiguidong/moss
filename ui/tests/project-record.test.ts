import { describe, expect, it } from 'bun:test';
import { softDeleteProjectRecord } from '../src/shared/project-record.mjs';

describe('project soft deletion', () => {
  it('only marks the project deleted and preserves related metadata', () => {
    const project = {
      id: 'project-1',
      name: 'Project',
      archivedAt: null,
      updatedAt: 100,
      connectorIds: ['connector-1'],
      expertIds: ['expert-1'],
      skillIds: ['skill-1'],
      customMetadata: 'preserved',
      assetCount: 2,
      sessionCount: 3,
      pendingDecisionCount: 4,
    };

    expect(softDeleteProjectRecord(project, 200)).toEqual({
      ...project,
      archivedAt: 200,
      updatedAt: 200,
    });
    expect(project.archivedAt).toBeNull();
  });

  it('keeps the original deletion timestamp on repeated deletion', () => {
    expect(softDeleteProjectRecord({ archivedAt: 150, updatedAt: 150 }, 200)).toEqual({
      archivedAt: 150,
      updatedAt: 200,
    });
  });
});
