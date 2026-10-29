import React from 'react';
import { createRoot } from 'react-dom/client';
import { ToolCallBlock } from '@/components/chat/tool-call-block';
import { TooltipProvider } from '@/components/ui/tooltip';
import { buildMainChatRenderMessagesFromHistory } from '@/lib/agent-transcript';
import '@/globals.css';

const examples = [
  ['visualize_create', { kind: 'app', appId: 'moss.visualize', appName: '可视化', contributionId: 'moss.visualize/visualize_create' }],
  ['browser_navigate', { kind: 'mcp', appId: 'moss.browser-use', appName: '浏览器', serverName: 'playwright-cdp' }],
  ['Read', { kind: 'builtin' }],
  ['old_tool', undefined],
] as const;
const history = examples.flatMap(([name, source], index) => [
  { type: 'assistant', tool_sources: source ? { [`call-${index}`]: source } : undefined,
    message: { content: [{ type: 'tool_use', id: `call-${index}`, name, input: {} }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `call-${index}`, content: '已完成' }] } },
]);
const messages = buildMainChatRenderMessagesFromHistory(JSON.parse(JSON.stringify(history)));
function Fixture() {
  const [chrome, setChrome] = React.useState<'card' | 'row'>('card');
  return <TooltipProvider><main className="mx-auto max-w-3xl space-y-4 p-5 text-foreground">
    <button onClick={() => setChrome(value => value === 'card' ? 'row' : 'card')}>切换展示</button>
    {messages.filter(item => item.type === 'tool_use').map(call => <ToolCallBlock key={call.id} toolCall={call} chrome={chrome} defaultCollapsed result={messages.find(item => item.type === 'tool_result' && item.toolUseId === call.toolUseId) as any} />)}
  </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
