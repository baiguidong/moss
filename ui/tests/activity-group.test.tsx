import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ActivityGroup,
  buildActivitySummary,
  type ActivityStep,
} from '../src/renderer-react/components/chat/activity-group';
import { ToolCallGroup } from '../src/renderer-react/components/chat/tool-call-group';
import { normalizeToolHeaderSubject } from '../src/renderer-react/components/chat/tool-call-block';
import { ToolDisplaySettingsProvider } from '../src/renderer-react/components/chat/tool-display-settings';
import { thinkingPreview } from '../src/renderer-react/components/chat/thinking-block';
import type { ThinkingRenderMessage, ToolUseRenderMessage } from '../src/renderer-react/lib/agent-transcript';

const timestamp = new Date('2026-09-17T00:00:00.000Z');

function thinking(id: string, content: string, streaming = false): ThinkingRenderMessage {
  return { id, timestamp, type: 'thinking', role: 'assistant', content, streaming };
}

function tool(id: string, toolName: string, input: unknown = {}): ToolUseRenderMessage {
  return {
    id,
    timestamp,
    type: 'tool_use',
    role: 'assistant',
    toolUseId: id,
    toolName,
    displayName: toolName,
    input,
    status: 'success',
  };
}

describe('merged activity group', () => {
  it('summarizes thinking and repeated tools in first-seen order', () => {
    const steps: ActivityStep[] = [
      { kind: 'thinking', message: thinking('thinking-1', 'first') },
      { kind: 'tool', toolCall: tool('task-1', 'TaskCreate') },
      { kind: 'thinking', message: thinking('thinking-2', 'second') },
      { kind: 'tool', toolCall: tool('task-2', 'TaskCreate') },
      { kind: 'tool', toolCall: tool('glob-1', 'Glob') },
      { kind: 'tool', toolCall: tool('bash-1', 'Bash', { command: 'pwd' }) },
    ];

    expect(buildActivitySummary(steps)).toBe(
      '思考 2 次，TaskCreate (2)，查找到文件，执行了一条命令',
    );
  });

  it('collapses a completed run and opens a live run as borderless rows', () => {
    const steps: ActivityStep[] = [
      { kind: 'thinking', message: thinking('thinking-1', 'Inspecting files') },
      { kind: 'tool', toolCall: tool('read-1', 'Read', { file_path: '/repo/a.ts' }) },
    ];
    const props = {
      steps,
      toolCalls: [steps[1]!.kind === 'tool' ? steps[1]!.toolCall : tool('unused', 'Read')],
      mergeable: true,
      resultMap: new Map(),
      childToolCallsByParent: new Map(),
    };

    const completed = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="merged">
        <ActivityGroup {...props} />
      </ToolDisplaySettingsProvider>,
    );
    expect(completed).toContain('data-expanded="false"');
    expect(completed).toContain('aria-label="工具调用"');
    expect(completed).toContain('h-7 w-7 shrink-0');
    expect(completed).toContain('data-activity-icon="true"');
    expect(completed).toContain('self-start');
    expect(completed).not.toContain('data-tool-call-chrome="row"');

    const live = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="merged">
        <ActivityGroup {...props} isLive />
      </ToolDisplaySettingsProvider>,
    );
    expect(live).toContain('data-expanded="true"');
    expect(live).toContain('data-tool-call-chrome="row"');
    expect(live).not.toContain('group/tool-call min-w-0 overflow-hidden');
  });

  it('measures a merged run from tool execution timestamps and ignores a bad thinking outlier', () => {
    const task = tool('task-1', 'TaskUpdate');
    task.timestamp = new Date('2026-09-11T02:18:46.504Z');
    const bash = tool('bash-1', 'Bash', { command: 'upload' });
    bash.timestamp = new Date('2026-09-11T02:19:18.111Z');
    const steps: ActivityStep[] = [
      { kind: 'tool', toolCall: task },
      { kind: 'thinking', message: { ...thinking('thinking-outlier', 'Uploading'), timestamp: new Date('2026-09-17T12:53:00.000Z') } },
      { kind: 'tool', toolCall: bash },
    ];
    const resultMap = new Map([
      ['task-1', {
        id: 'task-result',
        timestamp: new Date('2026-09-11T02:18:46.504Z'),
        type: 'tool_result' as const,
        role: 'assistant' as const,
        toolUseId: 'task-1',
        toolName: 'TaskUpdate',
        content: 'done',
      }],
      ['bash-1', {
        id: 'bash-result',
        timestamp: new Date('2026-09-11T02:19:19.511Z'),
        type: 'tool_result' as const,
        role: 'assistant' as const,
        toolUseId: 'bash-1',
        toolName: 'Bash',
        content: 'done',
      }],
    ]);
    const markup = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="merged">
        <ActivityGroup
          steps={steps}
          toolCalls={[task, bash]}
          mergeable
          resultMap={resultMap}
          childToolCallsByParent={new Map()}
        />
      </ToolDisplaySettingsProvider>,
    );

    expect(markup).toContain('33s');
    expect(markup).not.toContain('154h');
  });

  it('pins the ordinary tool-group icon to the first row', () => {
    const call = tool('task-top', 'TaskUpdate');
    const markup = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="expanded">
        <ToolCallGroup
          toolCalls={[call]}
          resultMap={new Map()}
          childToolCallsByParent={new Map()}
        />
      </ToolDisplaySettingsProvider>,
    );
    expect(markup).toContain('data-tool-group-icon="true"');
    expect(markup).toContain('self-start');
  });

  it('uses the standard tool icon for a single write row', () => {
    const write = tool('write-1', 'Write', { file_path: '/repo/welcome.md', content: 'hello' });
    const markup = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="merged">
        <ActivityGroup
          steps={[{ kind: 'tool', toolCall: write }]}
          toolCalls={[write]}
          mergeable
          resultMap={new Map()}
          childToolCallsByParent={new Map()}
        />
      </ToolDisplaySettingsProvider>,
    );

    expect(markup).toContain('data-tool-call-chrome="row"');
    expect(markup).toContain('aria-label="工具调用"');
    expect(markup).toContain('h-7 w-7 shrink-0');
    expect(markup).toContain('items-start gap-3');
    expect(markup).toContain('lucide-wrench');
    expect(markup).not.toContain('lucide-file-plus-2');
  });

  it('keeps a multiline Bash command on one header line with its icon at the top', () => {
    const command = "ls /tmp && python3 - <<'PY'\nprint('one')\nprint('two')\nPY";
    expect(normalizeToolHeaderSubject(command, true)).toBe(
      "ls /tmp && python3 - <<'PY' print('one') print('two') PY",
    );

    const bash = tool('bash-multiline', 'Bash', { command });
    const markup = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="merged">
        <ActivityGroup
          steps={[{ kind: 'tool', toolCall: bash }]}
          toolCalls={[bash]}
          mergeable
          resultMap={new Map()}
          childToolCallsByParent={new Map()}
        />
      </ToolDisplaySettingsProvider>,
    );
    expect(markup).toContain('data-row-tool-icon="true"');
    expect(markup).toContain('self-start');
    expect(markup).toContain('items-start gap-3');
    expect(markup).toContain('white-space:nowrap');
  });

  it('uses the current thought while streaming and a useful opening when settled', () => {
    const content = 'Diagnosis complete:\n## Inspect the renderer\n- Verify the group';
    expect(thinkingPreview(content)).toBe('Inspect the renderer');
    expect(thinkingPreview(content, { streaming: true })).toBe('Verify the group');

    const markup = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="merged">
        <ActivityGroup
          steps={[{ kind: 'thinking', message: thinking('thinking-only', content) }]}
          toolCalls={[]}
          mergeable
          resultMap={new Map()}
          childToolCallsByParent={new Map()}
        />
      </ToolDisplaySettingsProvider>,
    );
    expect(markup).toContain('aria-label="思考"');
    expect(markup).toContain('lucide-brain');
    expect(markup).toContain('h-7 w-7 shrink-0');
    expect(markup).toContain('items-center gap-3');
    expect(markup).not.toContain('lucide-wrench');
  });

  it('applies tool display modes to thinking expansion', () => {
    const message = thinking('thinking-mode', 'Inspect the renderer');
    const props = {
      steps: [{ kind: 'thinking' as const, message }],
      toolCalls: [],
      mergeable: true,
      resultMap: new Map(),
      childToolCallsByParent: new Map(),
    };

    const expanded = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="expanded">
        <ActivityGroup {...props} />
      </ToolDisplaySettingsProvider>,
    );
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('data-thinking-content="expanded"');

    const collapsed = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="collapsed">
        <ActivityGroup {...props} />
      </ToolDisplaySettingsProvider>,
    );
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).not.toContain('data-thinking-content="expanded"');

    const activeMessage = thinking('thinking-active', 'Inspecting', true);
    const active = renderToStaticMarkup(
      <ToolDisplaySettingsProvider toolDisplayMode="collapsed">
        <ActivityGroup {...props} steps={[{ kind: 'thinking', message: activeMessage }]} />
      </ToolDisplaySettingsProvider>,
    );
    expect(active).toContain('aria-expanded="true"');
    expect(active).toContain('data-thinking-content="expanded"');
  });
});
