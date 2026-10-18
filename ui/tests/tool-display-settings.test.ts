import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolCallBlock } from '../src/renderer-react/components/chat/tool-call-block';
import { isMergeableActivityTool } from '../src/renderer-react/components/chat/message-list';
import { ToolDisplaySettingsProvider } from '../src/renderer-react/components/chat/tool-display-settings';
import {
  getToolExecutionState,
  resolveToolDisplayMode,
  shouldAutoCollapseToolCall,
  shouldExpandThinking,
} from '../src/renderer-react/components/chat/tool-display-settings';

describe('tool display settings', () => {
  it('uses the session setting before the global default', () => {
    expect(resolveToolDisplayMode('merged', 'expanded')).toBe('merged');
    expect(resolveToolDisplayMode('collapsed', 'merged')).toBe('collapsed');
    expect(resolveToolDisplayMode(null, 'merged')).toBe('merged');
    expect(resolveToolDisplayMode(undefined, 'expanded')).toBe('expanded');
  });

  it('keeps the current expanded behavior when automatic collapse is disabled', () => {
    expect(shouldAutoCollapseToolCall({
      mode: 'expanded',
      status: 'success',
      failed: false,
      hasResult: true,
    })).toBe(false);
  });

  it('keeps running and failed tools visible', () => {
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
      status: 'running',
      failed: false,
      hasResult: false,
    })).toBe(false);
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
      status: 'pending',
      failed: false,
      hasResult: false,
    })).toBe(false);
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
      status: 'success',
      failed: false,
      hasResult: true,
    })).toBe(true);
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
      status: 'error',
      failed: true,
      hasResult: true,
    })).toBe(false);
  });

  it('collapses as soon as a pending tool receives a terminal result', () => {
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
      status: 'pending',
      failed: false,
      hasResult: true,
    })).toBe(true);
  });

  it('derives a single visual and folding state from status and result data', () => {
    expect(getToolExecutionState({
      status: 'pending',
      failed: false,
      hasResult: true,
    })).toBe('completed');
    expect(getToolExecutionState({
      status: 'pending',
      failed: true,
      hasResult: false,
    })).toBe('failed');
    expect(getToolExecutionState({
      status: 'success',
      failed: false,
      hasResult: false,
    })).toBe('completed');
    expect(getToolExecutionState({
      status: 'running',
      failed: false,
      hasResult: false,
    })).toBe('running');
  });

  it('applies tool display modes to thinking content', () => {
    expect(shouldExpandThinking('expanded', false)).toBe(true);
    expect(shouldExpandThinking('collapsed', true)).toBe(true);
    expect(shouldExpandThinking('collapsed', false)).toBe(false);
    expect(shouldExpandThinking('merged', true)).toBe(false);
    expect(shouldExpandThinking('merged', false)).toBe(false);
  });
});

it('moss_present follows collapsed/expanded/merged preferences including its status card', () => {
  const tool: any = { id: 'present', toolUseId: 'present', type: 'tool_use', role: 'assistant', timestamp: new Date(0), toolName: 'moss_present', displayName: '展示成果', status: 'success', input: { title: '笑话文件' } };
  const result: any = { id: 'result', toolUseId: 'present', content: JSON.stringify({ ok: true, schema: 'moss.presentation-result/v1', request_id: 'present', items: [], presentation: { state: 'deferred' } }) };
  const render = (mode: 'expanded' | 'collapsed') => renderToStaticMarkup(React.createElement(ToolDisplaySettingsProvider, { toolDisplayMode: mode, children: React.createElement(ToolCallBlock, { toolCall: tool, result }) }));
  expect(render('collapsed')).not.toContain('已收录到结果');
  expect(render('expanded')).toContain('已收录到结果');
  expect(isMergeableActivityTool(tool)).toBe(true);
  result.content = JSON.stringify({ ok: false, schema: 'moss.presentation-result/v1', request_id: 'present', presentation: { state: 'unavailable' } });
  expect(render('collapsed')).toContain('内容不可用');
});
