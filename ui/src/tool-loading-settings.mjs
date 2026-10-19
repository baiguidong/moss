export const MOSS_TOOL_GROUPS = Object.freeze([
  {
    id: 'presentation',
    label: '成果展示',
    tools: [
      { name: 'moss_present', description: '展示文件和其他可预览成果', defaultMode: 'always' },
    ],
  },
  {
    id: 'browser',
    label: '内置浏览器',
    tools: [
      { name: 'moss_browser_open', description: '在 Moss 内置浏览器中打开网址或搜索内容，供手动浏览', defaultMode: 'always' },
    ],
  },

  {
    id: 'connector',
    label: '连接器',
    tools: [
      { name: 'connector_cli_setup', description: '安装并认证连接器 CLI', defaultMode: 'deferred' },
      { name: 'connector_mcp_authenticate', description: '认证连接器 MCP 服务', defaultMode: 'deferred' },
    ],
  },
  {
    id: 'image',
    label: '图片',
    tools: [
      { name: 'image_generate', description: '根据提示词生成图片', defaultMode: 'deferred' },
      { name: 'image_edit', description: '编辑工作区中的图片', defaultMode: 'deferred' },
    ],
  },
]);

export const DEFAULT_MOSS_TOOL_LOADING = Object.freeze(Object.fromEntries(
  MOSS_TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => [tool.name, tool.defaultMode])),
));

export function normalizeMossToolLoading(value, existing = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const previous = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return Object.fromEntries(Object.entries(DEFAULT_MOSS_TOOL_LOADING).map(([name, fallback]) => {
    const candidate = source[name]
      ?? (name === 'moss_browser_open' ? source.browser_open : undefined)
      ?? previous[name]
      ?? (name === 'moss_browser_open' ? previous.browser_open : undefined);
    return [name, candidate === 'always' || candidate === 'deferred' ? candidate : fallback];
  }));
}
