// User-facing explanations for Host grants and App backend actions. Keep the
// original identifiers visible as secondary detail for support and auditing.
const permissions = {
  'mcp:read': ['查看 MCP 服务', '读取已配置的 MCP 服务列表与状态。'],
  'mcp:manage': ['管理 MCP 服务', '新增、修改、启停或删除 MCP 服务配置。'],
  'mcp:connect': ['检查 MCP 连接', '连接并检查 MCP 服务，获取它提供的工具清单。'],
  'mcp:auth': ['管理 MCP 授权', '发起或清除 MCP 服务的登录授权。'],
  'local-files:pick': ['选择本机文件', '打开文件选择器，并将你选中的文件或文件夹路径交给 App。'],
  'local-files:open': ['打开本机文件', '通过 Moss 打开、预览或在文件夹中定位本机文件。'],
  'platform:files': ['使用文件与媒体', '选择、保存、下载文件或生成文件缩略图。'],
  'platform:screen-capture': ['截取屏幕', '请求 Moss 截取当前屏幕画面。'],
  'platform:external-links': ['打开外部链接', '请求 Moss 在系统浏览器中打开网页。'],
  'platform:media': ['访问媒体资源', '访问 App 经 Moss 提供的媒体资源。'],
  'connector:use': ['使用在线服务', '在会话中使用此 App 连接的外部服务及其工具。'],
  'agent:catalog:read': ['查看 Agent 能力目录', '读取可用的 Agent、工具、技能和连接器信息。'],
  'agent:bindings:read': ['查看 Agent 绑定', '读取 App 与 Agent 会话的绑定配置。'],
  'agent:bindings:write': ['修改 Agent 绑定', '创建、修改或重置 App 与 Agent 会话的绑定。'],
  'agent:sessions:read': ['查看 Agent 会话', '读取 Agent 会话列表、状态和上下文。'],
  'agent:sessions:write': ['管理 Agent 会话', '创建、选择或中止 Agent 会话。'],
  'agent:turns:read': ['查看 Agent 对话', '读取 Agent 对话轮次及结果。'],
  'agent:turns:write': ['发起 Agent 对话', '代表 App 向 Agent 发送任务或消息。'],
  'agent:permissions:bypass': ['跳过 Agent 权限确认', '允许 App 发起的 Agent 会话使用完全放行模式。'],
  'execution:read': ['查看执行记录', '读取后台执行任务的状态、事件和结果。'],
  'execution:run': ['启动后台执行', '提交任务并启动后台 Agent 执行。'],
  'execution:cancel': ['取消后台执行', '停止正在运行的后台 Agent 执行。'],
  'tasks:read': ['查看任务', '读取 App 任务及其进度。'],
  'tasks:write': ['管理任务', '创建、更新、完成或恢复 App 任务。'],
  'tasks:cancel': ['取消任务', '取消 App 任务。'],
  'cloud-storage:read': ['读取云盘', '查看云盘文件、容量和传输状态。'],
  'cloud-storage:write': ['写入云盘', '创建文件夹或向云盘上传文件。'],
  'cloud-storage:delete': ['删除云盘文件', '删除云盘中的文件。'],
  'cloud-storage:share': ['管理云盘分享', '创建、查看或撤销云盘分享链接。'],
  'apps:read': ['查看 Apps', '读取 App 项目、版本或构建结果。'],
  'apps:author': ['创作 App', '准备 App 项目并编辑应用源码。'],
  'apps:build': ['构建 App', '构建、验证或预览 App 安装包。'],
  'apps:install': ['发布与安装 App', '提交 App 版本并安装到 Moss。'],
  'settings:read': ['查看设置', '读取 Moss 设置目录及当前值。'],
  'settings:write': ['修改设置', '提交或撤销 Moss 设置变更，常规变更仍需确认。'],
  'settings:write:unrestricted': ['自动修改设置', '允许 App 无需逐次确认就修改 Moss 设置。'],
  'notifications:read': ['查看通知', '读取通知并将通知标为已读。'],
  'notifications:publish': ['发布通知', '通过 Moss 显示此 App 的提醒。'],
  'session-source:read': ['读取本地会话历史', '按会话读取脱敏后的本地会话记录。'],
  'session-source:open': ['打开本地会话', '定位到指定的本地会话或工具调用。'],
  'trace:capture': ['采集调用追踪', '记录 App 调用与运行诊断信息。'],
  'testing:control': ['控制测试环境', '创建、运行或管理 App 自测任务。'],
  'desktop:control': ['控制本机界面', '使用原生控制适配器操作本机界面；系统权限仍由 Moss 单独询问。'],
  'openim:client': ['使用即时消息', '通过 App 的即时消息客户端访问会话与消息。'],
};
const own = (record, key) => Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

export function describeAppPermission(id) {
  const [label, description] = own(permissions, id) || ['自定义权限', '此权限由 App 声明，安装包没有提供通用说明；请查看该 App 的文档或联系发布者。'];
  return { id, label, description };
}

export function formatAppPermission(id) {
  const { label, description } = describeAppPermission(id);
  return `${label}（${id}）\n  ${description}`;
}

const backendActions = {
  status: ['查看应用状态', '查看此 App 当前的运行状态。'],
  catalog: ['查看能力目录', '查看此 App 提供的能力与资源目录。'],
  'self-test': ['运行应用自检', '执行此 App 提供的自检流程。'],
  'local-files.pick': ['选择本机文件', '打开文件选择器，获取你选中的本机文件。'],
  'pet.import-legacy': ['导入旧版伴侣数据', '把旧版伴侣数据导入当前 App。'],
  'pet.hatch': ['孵化伴侣精灵', '创建并启用此 App 的伴侣精灵。'],
  'engine.status': ['查看引擎状态', '查看此 App 的后台引擎是否已准备好、正在运行或出现错误。'],
  'engine.prepare': ['准备运行环境', '安装或准备此 App 的后台引擎及所需组件。'],
  'engine.start': ['启动引擎', '启动此 App 的后台服务。'],
  'engine.cancel': ['取消引擎准备', '取消正在进行的后台引擎准备过程。'],
  'files.pick': ['选择文件', '打开系统文件选择器，获取你选中的文件。'],
  'files.import': ['导入文件', '把选中的文件导入此 App，供后续处理。'],
  'index.rebuild': ['重建检索索引', '重新建立文档检索索引，使内容可被搜索。'],
  'documents.list': ['列出文档', '查看此 App 已收录的文档。'],
  'documents.search': ['搜索文档', '在此 App 收录的文档中搜索内容。'],
  'documents.read': ['读取文档', '读取指定文档的内容。'],
};

const subjects = {
  engine: '运行引擎', files: '文件', documents: '文档', index: '检索索引',
  catalog: '目录', status: '状态', run: '运行任务', resource: '资源', collections: '知识集合',
  sources: '数据源', jobs: '后台任务', templates: '模板', history: '历史记录',
  library: '资料库', local: '本机内容', servers: 'MCP 服务', auth: '授权', uploads: '上传任务',
  downloads: '下载任务', transfers: '传输任务', folders: '文件夹', shares: '分享链接',
  tasks: '任务', workspace: '工作区', artifacts: '产物', session: '会话',
  dashboard: '概览', event: '事件', audit: '审计', rule: '规则',
  findings: '风险项', finding: '风险项', traces: '调用记录', connections: '连接', pairing: '配对',
  chat: '消息', assistants: '助手', notifications: '通知', settings: '设置',
  report: '报告', instance: '应用实例', commands: '命令', result: '结果',
  workflow: '工作流', takt: '工作流', builder: 'App 构建', pet: '伴侣',
  graph: '知识图谱', paths: '路径', quota: '用量', composer: '会话资源',
  transcript: '逐字稿', request: '请求', directory: '目录', conversation: '会话',
  sdk: '应用接口', rtc: '实时通话', timestamp: '时间戳', base64: 'Base64 数据',
  json: 'JSON 数据', aes: '加密数据', help: '帮助内容',
};
const operations = {
  status: ['查看', '查看状态与相关信息。'], get: ['查看', '读取相关信息。'],
  list: ['列出', '读取列表。'], search: ['搜索', '按条件查找内容。'],
  read: ['读取', '读取内容或详情。'], create: ['创建', '创建新内容。'],
  update: ['修改', '更改现有内容。'], edit: ['编辑', '更改现有内容。'],
  delete: ['删除', '删除现有内容。'], remove: ['移除', '移除现有内容。'],
  pick: ['选择', '让你选择所需内容。'], import: ['导入', '将外部内容加入 App。'],
  export: ['导出', '将内容导出到文件。'], prepare: ['准备', '准备执行所需的环境或数据。'],
  start: ['启动', '启动处理或运行。'], stop: ['停止', '停止正在运行的处理。'],
  cancel: ['取消', '取消尚未完成的处理。'], rebuild: ['重建', '重新建立数据或索引。'],
  refresh: ['刷新', '重新获取最新内容。'], open: ['打开', '打开相应内容。'],
  close: ['关闭', '关闭相应内容。'], sync: ['同步', '同步相关数据。'],
  reset: ['重置', '重置相关状态。'], inspect: ['检查', '检查当前状态与配置。'],
  save: ['保存', '保存相关配置或内容。'], run: ['运行', '执行相应任务。'],
  validate: ['校验', '检查内容是否符合要求。'], duplicate: ['复制', '创建一份副本。'],
  archive: ['归档', '将内容归档。'], restore: ['恢复', '恢复已归档或删除的内容。'],
  publish: ['发布', '将内容发布供使用。'], unpublish: ['取消发布', '使已发布内容下线。'],
  resume: ['继续', '继续暂停的处理。'], pause: ['暂停', '暂停正在进行的处理。'],
  revoke: ['撤销', '撤销已发出的授权或分享。'], send: ['发送', '发送内容或请求。'],
  call: ['调用', '向服务发起调用。'], apply: ['应用', '应用相应变更。'],
  undo: ['撤销', '撤销先前的变更。'], capture: ['采集', '采集相关信息。'],
  reveal: ['定位', '在文件夹中定位相应内容。'], resolve: ['解析', '解析资源并取得可用结果。'],
  build: ['构建', '生成可用的构建产物。'],
  write: ['写入', '写入或修改内容。'], 'set-enabled': ['启停', '启用或停用相应服务。'],
  issue: ['创建', '生成新的内容。'], control: ['控制', '控制运行状态。'],
  copy: ['复制', '创建一份副本。'], convert: ['转换', '转换内容格式。'],
  process: ['处理', '执行相应的数据处理。'], preview: ['预览', '显示处理结果供检查。'],
  release: ['发布', '发布相关结果。'], ensure: ['确认', '确认相关资源可用。'],
  token: ['获取', '获取用于连接的凭证。'], events: ['查看', '读取相关事件。'],
  revision: ['查看', '读取版本信息。'], clear: ['清除', '清除相应数据或授权。'],
  manage: ['管理', '查看或修改相关配置。'],
};

export function describeBackendAction(id) {
  const known = own(backendActions, id);
  if (known) return { id, label: known[0], description: known[1] };
  const parts = id.split(/[._:-]/).filter(Boolean);
  const operation = own(operations, parts.at(-1)) || own(operations, parts.slice(-2).join('-'));
  const subject = own(subjects, parts[0]);
  if (subject && operation) {
    return { id, label: `${operation[0]}${/^[A-Za-z]/.test(subject) ? ' ' : ''}${subject}`, description: `${operation[1]}具体处理范围由此 App 决定。` };
  }
  return { id, label: '应用后台操作', description: '安装包未提供此操作的用途说明；具体作用请查看该 App 的文档或联系发布者。' };
}
