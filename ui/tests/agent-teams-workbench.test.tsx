import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AgentTeamsStrip,
  AgentTeamsWorkbench,
} from '../src/renderer-react/components/agent-teams-workbench';
import type { AgentTeamsSessionState } from '../src/renderer-react/types';

const state: AgentTeamsSessionState = {
  sessionId: 'desktop-1',
  teams: [{
    schemaVersion: 1,
    sessionId: 'desktop-1',
    incarnationId: 'run-1',
    teamName: 'agent-team-demo',
    status: 'completed',
    createdAt: 1,
    updatedAt: '2026-09-16T10:00:01.000Z',
    deletedAt: '2026-09-16T10:00:01.000Z',
    snapshots: [0, 1].map((index) => ({
      capturedAt: `2026-09-16T10:00:0${index}.000Z`,
      phase: index === 0 ? 'executing' : 'completed',
      taskCounts: { total: 2, completed: index + 1, inProgress: index === 0 ? 1 : 0, pending: 0, blocked: 0 },
      team: {
        name: 'agent-team-demo',
        description: 'Ship Agent Teams',
        createdAt: 1,
        leadAgentId: 'lead',
        leadSessionId: 'engine-1',
        members: [
          { agentId: 'lead', name: 'team-lead', agentType: 'lead', model: 'sonnet', color: '', joinedAt: 1, cwd: '/tmp', status: 'idle' },
          { agentId: 'worker', name: 'worker', agentType: 'developer', model: 'sonnet', color: '', joinedAt: 1, cwd: '/tmp', status: 'idle' },
        ],
      },
      tasks: [
        { id: '1', subject: 'Implement', description: '', activeForm: '', owner: 'worker', status: 'completed', blocked: false, blocks: ['2'], blockedBy: [], metadata: {} },
        { id: '2', subject: 'Verify', description: '', activeForm: '', owner: null, status: index === 0 ? 'in_progress' : 'completed', blocked: false, blocks: [], blockedBy: ['1'], metadata: {} },
      ],
      messages: [],
    })),
  }],
};

test('Agent Teams strip and workbench expose archived DAG playback', () => {
  const strip = renderToStaticMarkup(<AgentTeamsStrip state={state} onOpen={() => {}} />);
  const workbench = renderToStaticMarkup(<AgentTeamsWorkbench state={state} onClose={() => {}} />);

  expect(strip).toContain('Agent Teams · agent-team-demo');
  expect(strip).toContain('回看');
  expect(workbench).toContain('Agent Teams · 共享任务图');
  expect(workbench).not.toContain('Ship Agent Teams');
  expect(workbench).not.toContain('按依赖分层 · 左至右');
  expect(workbench).toContain('团队任务');
  expect(workbench).not.toContain('未领取');
  expect(workbench).toContain('aria-label="缩小任务图"');
  expect(workbench).toContain('aria-label="重置任务图缩放"');
  expect(workbench).toContain('aria-label="放大任务图"');
  expect(workbench).toContain('marker-end="url(#agent-team-arrow)"');
  expect(workbench).toContain('aria-label="团队历史时间轴"');
  expect(workbench).toContain('aria-label="从头播放团队历史"');
  expect(workbench).toContain('lg:w-1/2');
});
