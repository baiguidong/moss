import type { McpCatalog, McpConfig } from '../../../packages/app-sdk/src/mcp/index.mjs';
import { createMcpConnectionDrafts, parseMcpConnectionDrafts } from './mcp-connection-config';

export type McpKeyValue = { name: string; value: string };
const entries = (value?: Record<string, string>): McpKeyValue[] => Object.entries(value || {}).map(([name, value]) => ({ name, value }));
const basicFields = ['type', 'command', 'args', 'env', 'url', 'headers', 'disabledTools'];

export function createMcpConnectionForms(catalog: McpCatalog) {
  return createMcpConnectionDrafts(catalog).map((draft, index) => {
    const { type, command, args, env, url, headers, disabledTools: _disabledTools, ...advanced } = catalog.servers[index].config;
    return { ...draft, type, command: command || '', args: args || [], url: url || '',
      env: entries(env), headers: entries(headers), advanced: JSON.stringify(advanced, null, 2) };
  });
}
export type McpConnectionForm = ReturnType<typeof createMcpConnectionForms>[number];

function values(rows: McpKeyValue[], label: string) {
  const names = new Set<string>();
  return Object.fromEntries(rows.filter(row => row.name || row.value).map(row => {
    const name = row.name.trim();
    if (!name) throw new Error(`${label}名称不能为空。`);
    if (names.has(name)) throw new Error(`${label}名称不能重复：${name}`);
    names.add(name);
    return [name, row.value];
  }));
}

export function parseMcpConnectionForms(drafts: McpConnectionForm[], catalog: McpCatalog) {
  return parseMcpConnectionDrafts(drafts.map(draft => {
    const advanced = JSON.parse(draft.advanced);
    if (!advanced || typeof advanced !== 'object' || Array.isArray(advanced)) throw new Error('高级参数必须是 JSON 对象。');
    if (basicFields.some(name => Object.hasOwn(advanced, name))) throw new Error('连接方式、命令、参数和凭据请在上方表单中修改。');
    const previous = catalog.servers.find(server => server.name === draft.name)?.config;
    const config: McpConfig = { ...advanced, type: draft.type };
    if (draft.type === 'stdio') {
      delete config.oauth;
      if (!draft.command.trim()) throw new Error('请输入启动命令。');
      config.command = draft.command.trim();
      if (draft.args.length || previous?.args) config.args = draft.args;
      const env = values(draft.env, '环境变量');
      if (Object.keys(env).length || previous?.env) config.env = env;
    } else {
      delete config.roots; delete config.python; delete config.pathBindings;
      const url = draft.url.trim();
      try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
      catch { throw new Error('请输入有效的 HTTP 或 HTTPS 服务地址。'); }
      config.url = url;
      const headers = values(draft.headers, '请求头');
      if (Object.keys(headers).length || previous?.headers) config.headers = headers;
    }
    return { ...draft, config: JSON.stringify(config) };
  }), catalog);
}
