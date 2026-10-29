import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageGenerationCard, imageGenerationResult } from '../src/renderer-react/components/chat/image-generation-card';
import { ToolCallBlock } from '../src/renderer-react/components/chat/tool-call-block';
import { ToolDisplaySettingsProvider } from '../src/renderer-react/components/chat/tool-display-settings';
import { isMergeableActivityTool } from '../src/renderer-react/components/chat/message-list';
import { buildMainChatRenderMessagesFromHistory } from '../src/renderer-react/lib/agent-transcript';

const data = { ok: true, status: 'completed', fileKind: 'image', filePath: '/workspace/generated_images/session/call.png', image: { base64: 'fixture-image', mediaType: 'image/png' } };
function messages(structured: boolean) {
  const content = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture-image' } }, { type: 'text', text: JSON.stringify({ ...data, image: undefined }) }];
  return buildMainChatRenderMessagesFromHistory(JSON.parse(JSON.stringify([
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'call', name: 'image_gen', input: { prompt: 'a blue circle' } }] } },
    { type: 'user', ...(structured ? { tool_use_result: data } : {}), message: { content: [{ type: 'tool_result', tool_use_id: 'call', content }] } },
  ])));
}

describe('image generation conversation artifacts', () => {
  test.each([true, false])('restores image/path from real transcript with structured=%s', structured => {
    const parsed = messages(structured);
    const result = parsed.find(item => item.type === 'tool_result');
    expect(imageGenerationResult(result as any)).toMatchObject({ src: 'data:image/png;base64,fixture-image', path: data.filePath, failed: false });
  });
  test.each(['expanded', 'collapsed', 'merged'] as const)('keeps the artifact visible in %s mode without a raw JSON receipt', mode => {
    const parsed = messages(true), tool = parsed.find(item => item.type === 'tool_use') as any, result = parsed.find(item => item.type === 'tool_result') as any;
    expect(isMergeableActivityTool(tool)).toBe(false);
    const html = renderToStaticMarkup(<ToolDisplaySettingsProvider toolDisplayMode={mode}><ToolCallBlock toolCall={tool} result={result} defaultCollapsed /></ToolDisplaySettingsProvider>);
    expect(html).toContain('data-image-generation="completed"');
    expect(html).toContain('图片已生成'); expect(html).toContain('在右侧查看图片');
    expect(html).not.toContain('&quot;fileKind&quot;'); expect(html).not.toContain('继续修改');
  });
  test('running and failed requests have distinct visible states', () => {
    const tool: any = { toolName: 'image_gen', input: {}, status: 'running' };
    expect(renderToStaticMarkup(<ImageGenerationCard toolCall={tool} />)).toContain('正在生成图片');
    const error: any = { isError: true, rawContent: { ok: false, error: '图片接口未授权' } };
    const html = renderToStaticMarkup(<ImageGenerationCard toolCall={tool} result={error} />);
    expect(html).toContain('role="alert"'); expect(html).toContain('图片接口未授权'); expect(html).not.toContain('正在绘制');
  });
});
