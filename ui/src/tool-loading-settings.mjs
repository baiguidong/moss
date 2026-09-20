export const MOSS_TOOL_GROUPS = Object.freeze([
  {
    id: 'browser',
    label: '浏览器',
    tools: [
      { name: 'browser_open', description: '打开网址或搜索内容', defaultMode: 'always' },
      { name: 'browser_snapshot', description: '读取页面并保存真实截图', defaultMode: 'always' },
      { name: 'browser_click', description: '点击页面元素', defaultMode: 'always' },
      { name: 'browser_type', description: '向页面输入文字', defaultMode: 'always' },
      { name: 'browser_press', description: '发送键盘按键', defaultMode: 'deferred' },
      { name: 'browser_scroll', description: '滚动当前页面', defaultMode: 'deferred' },
      { name: 'browser_wait', description: '等待页面内容或地址变化', defaultMode: 'deferred' },
      { name: 'browser_reload', description: '重新加载当前页面', defaultMode: 'deferred' },
    ],
  },
  {
    id: 'app',
    label: 'App',
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
  {
    id: 'library',
    label: '资料库',
    feature: 'library',
    tools: [
      { name: 'library_list', description: '列出资料库集合、来源和资源', defaultMode: 'deferred' },
      { name: 'library_search', description: '检索资料库中的已索引内容', defaultMode: 'deferred' },
      { name: 'library_read', description: '读取资料库资源的索引内容', defaultMode: 'deferred' },
      { name: 'library_write', description: '将工作区文件写入资料库', defaultMode: 'deferred' },
    ],
  },
  {
    id: 'workflows',
    label: '工作流',
    feature: 'workflows',
    tools: [
      { name: 'WorkflowRun', description: '运行已保存的结构化工作流', defaultMode: 'deferred' },
      { name: 'WorkflowCreate', description: '创建结构化工作流草稿', defaultMode: 'deferred' },
      { name: 'WorkflowEdit', description: '编辑工作流草稿并生成新版本', defaultMode: 'deferred' },
      { name: 'WorkflowManage', description: '查询、发布和管理工作流', defaultMode: 'deferred' },
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
    const candidate = source[name] ?? previous[name];
    return [name, candidate === 'always' || candidate === 'deferred' ? candidate : fallback];
  }));
}
