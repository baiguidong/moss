import * as React from 'react';
import { Search } from 'lucide-react';
import type { StoredApp } from '@/types';
import { AppDetailsSection, APP_DETAILS_LIST_CLASS, APP_DETAILS_ROW_CLASS } from './app-details-section';
import { ToolDescription } from './tool-description';
import { normalizeAppToolName } from '../../../../packages/app-sdk/src/tool-names.mjs';
import { toolCallPolicyKey } from '../../../../packages/app-runtime/src/tool-call-policy/identity.mjs';

export type AppDetailsMcpTool = { name: string; description?: string; disabled?: boolean; server: string; instanceId?: string; status?: string };

/** One tool list for native App contributions and MCP services. */
export function AppDetailsTools({ app, mcpTools = [] }: { app: StoredApp; mcpTools?: AppDetailsMcpTool[] }) {
  const [query, setQuery] = React.useState('');
  const appId = app.id || app.name;
  const [policies, setPolicies] = React.useState<Record<string, 'draft'>>({});
  const [ready, setReady] = React.useState(false);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let active = true; setReady(false); setError(''); setPolicies({});
    void window.agentDesktop.appToolCallPolicies({ appId }).then(value => { if (active) { setPolicies(value); setReady(true); } })
      .catch(cause => { if (active) setError(String(cause?.message || cause)); });
    return () => { active = false; };
  }, [appId]);
  const change = async (identity: NonNullable<Parameters<typeof window.agentDesktop.appToolCallPolicies>[0]['identity']>, mode: 'normal' | 'draft') => {
    setSaving(toolCallPolicyKey(identity)); setError('');
    try { setPolicies(await window.agentDesktop.appToolCallPolicies({ appId, identity, mode })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(null); }
  };
  const appTitle = app.displayName || app.title || app.name;
  const effects = { read: '只读', write: '写入', destructive: '破坏性操作' };
  const tools = [
    ...(app.agentTools || []).map(tool => ({
      key: `app/${tool.id}`, name: tool.name || tool.id, title: tool.title,
      identity: { kind: 'app' as const, contributionId: tool.id.startsWith(`${appId}/`) ? tool.id : `${appId}/${tool.id}` },
      description: tool.description, kind: 'App', effect: effects[tool.effect],
      source: appTitle, status: !app.enabled ? 'App 已停用' : tool.permission && !app.grants?.includes(tool.permission) ? '未授权' : '已注册',
    })),
    ...mcpTools.map(tool => ({
      key: `mcp/${tool.instanceId || ''}/${tool.server}/${tool.name}`, name: normalizeAppToolName(tool.name, app.id || app.name), title: tool.name,
      identity: { kind: 'mcp' as const, instanceId: tool.instanceId || '', server: tool.server, toolName: tool.name },
      description: tool.description, kind: 'MCP', effect: '', source: `${appTitle} · ${tool.server}`,
      status: !app.enabled ? 'App 已停用' : tool.disabled ? '已排除' : tool.status || '可用',
    })),
  ];
  if (!tools.length) return null;
  const matches = tools.filter(tool => `${tool.name} ${tool.title} ${tool.description} ${tool.source}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <AppDetailsSection title="工具" count={tools.length}>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">设为草稿确认后，会话中的调用会先等待你核对参数，再执行。正常调用沿用现有权限设置。</p>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    <label className="my-4 flex items-center gap-2 rounded-md border bg-background px-3 py-2">
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input aria-label="搜索工具" placeholder="查找工具" className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    <div className={APP_DETAILS_LIST_CLASS}>
      {matches.map(tool => <article key={tool.key} data-app-tool={tool.name} data-mcp-tool={tool.kind === 'MCP' ? '' : undefined} className={APP_DETAILS_ROW_CLASS}>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium leading-6" title={tool.title && tool.title !== tool.name ? `${tool.name} ｜ ${tool.title}` : tool.name}>
            <code className="text-[13px]">{tool.name}</code>
            {tool.title && tool.title !== tool.name && <><span aria-hidden="true" className="mx-2 font-normal text-muted-foreground/60">｜</span><span className="font-normal text-muted-foreground">{tool.title}</span></>}
          </h3>
          <div className="mt-1 break-words text-xs leading-6 text-muted-foreground"><ToolDescription description={tool.description || '此工具未提供描述。'} toolName={tool.name} /></div>
          <p className="mt-1 break-words text-xs text-muted-foreground">来源：{tool.source} · {tool.kind}{tool.effect && ` · ${tool.effect}`}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="text-xs leading-6 text-muted-foreground">{tool.status}</span>
          <select aria-label={`${tool.name} 调用方式`} className="h-8 max-w-32 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
            disabled={!ready || saving !== null || (tool.identity.kind === 'mcp' && !tool.identity.instanceId)}
            value={tool.identity.kind === 'mcp' && !tool.identity.instanceId ? 'normal' : policies[toolCallPolicyKey(tool.identity)] || 'normal'}
            onChange={event => void change(tool.identity, event.target.value as 'normal' | 'draft')}>
            <option value="normal">正常调用</option><option value="draft">草稿确认</option>
          </select>
        </div>
      </article>)}
    </div>
    {!matches.length && <p className="py-4 text-sm text-muted-foreground">没有匹配的工具。</p>}
  </AppDetailsSection>;
}
