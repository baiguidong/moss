export const MOSS_TOOL_GROUPS = Object.freeze([
  {
    id: 'browser',
    label: '内置浏览器',
    tools: [
      { name: 'moss_browser_open', description: '在 Moss 内置浏览器中打开网址或搜索内容，供手动浏览', defaultMode: 'always' },
    ],
  },
  {
    id: 'computer',
    label: '电脑操控',
    feature: 'computerUse',
    tools: [
      { name: 'computer_use', description: '读取应用界面、截图并执行点击和输入', defaultMode: 'always' },
    ],
  },
  {
    id: 'app',
    label: 'App 管理',
    tools: [
      { name: 'app_build', description: '构建工作区中的 Moss App', defaultMode: 'deferred' },
      { name: 'app_preview', description: '预览已构建的 App', defaultMode: 'deferred' },
      { name: 'app_publish', description: '发布 App 新版本', defaultMode: 'deferred' },
      { name: 'app_launch', description: '打开已安装的 App', defaultMode: 'deferred' },
      { name: 'app_update', description: '更新已安装的 App', defaultMode: 'deferred' },
      { name: 'app_extract_to_workspace', description: '提取 App 到当前工作区', defaultMode: 'deferred' },
      { name: 'app_get_versions', description: '查看 App 版本历史', defaultMode: 'deferred' },
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
