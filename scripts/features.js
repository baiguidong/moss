/**
 * Moss Feature Flags
 *
 * 用法：将开关设为 true，scripts/build.js 会为 Bun 添加对应的 --feature 参数：
 *   --feature FEATURE_NAME
 *
 * 注意：这些 flag 是编译期宏（DCE），修改后需要重新执行 bun run build。
 * Bun 和 Node.js 目标都会在构建时内联 feature() 的结果。
 */

// =============================================================================
// ✅ 推荐开启 —— 纯客户端功能，无外部依赖，安全稳定
// =============================================================================

export const RECOMMENDED = {

  // 终端自动主题（缺少 OSC 11 systemThemeWatcher；桌面系统主题为独立实现）
  AUTO_THEME: false,

  // Token 用量实时追踪，在输入框底部显示剩余 token 预算
  TOKEN_BUDGET: true,

  // 响应式压缩策略（缺少 reactiveCompact 核心实现）
  REACTIVE_COMPACT: false,

  // 缓存微压缩（cachedMicrocompact 仍为 stub，且缺少 cachedMCConfig）
  CACHED_MICROCOMPACT: false,

  // 压缩前的提醒提示：在 compact 前给 Claude 附加提示，提升压缩质量
  COMPACTION_REMINDERS: true,

  // 历史会话选择器：/resume 时用交互式 UI 选择历史会话，替代纯文本列表
  HISTORY_PICKER: true,

  // 消息操作按钮：消息旁显示复制、重试等快捷操作
  MESSAGE_ACTIONS: true,

  // 新版初始化流程：更友好的首次启动引导
  NEW_INIT: true,

  // 慢操作日志：记录耗时超过阈值的操作，便于性能分析
  SLOW_OPERATION_LOGGING: true,

  // 无人值守自动重试：非交互模式（-p）下遇到可恢复错误时自动重试
  UNATTENDED_RETRY: true,

  // 流线型输出：-p 模式下更简洁的输出格式
  STREAMLINED_OUTPUT: true,
};

// =============================================================================
// 🧪 可选开启 —— 实验性或有少量依赖，功能可用但可能不完整
// =============================================================================

export const EXPERIMENTAL = {

  // CLI 进程级后台 Session（缺少 cli/bg 与 taskSummary；后台 Task 不受此开关控制）
  BG_SESSIONS: false,

  // 主动建议（当前缺少 proactive 与 SleepTool 实现）
  PROACTIVE: false,

  // Skill 快速搜索：输入 / 时模糊搜索可用 skill
  QUICK_SEARCH: true,

  // 实验性 Skill 搜索算法：更智能但尚未稳定
  EXPERIMENTAL_SKILL_SEARCH: false,

  // 内置 Explore/Plan 子 Agent：把探索和规划拆给专用子 agent 处理
  BUILTIN_EXPLORE_PLAN_AGENTS: true,

  // 独立验证 Agent：编入产物，由 moss_hive_evidence 高级设置按会话启用
  VERIFICATION_AGENT: true,

  // MCP 富文本输出：MCP 工具结果支持格式化展示（表格、代码块等）
  MCP_RICH_OUTPUT: true,

  // 从 skill:// MCP resource 发现 Skill（当前缺少 mcpSkills 实现）
  MCP_SKILLS: false,

  // Workflow 脚本（WorkflowTool、LocalWorkflowTask 与相关 UI 均缺失）
  WORKFLOW_SCRIPTS: false,

  // 定时任务（Cron）工具：让 Claude 创建和管理 cron 触发的 agent 任务
  AGENT_TRIGGERS: true,

  // 模板支持：AGENTS.md 中使用模板变量
  TEMPLATES: false,

  // 离开摘要：长时间无操作后，回来时显示 session 摘要
  AWAY_SUMMARY: true,

  // Prompt 缓存中断检测：检测并提示 prompt cache 失效，帮助优化 token 成本
  PROMPT_CACHE_BREAK_DETECTION: false,

  // Git 提交归因：记录文件与提示词归因，并将归因信息写入提交/PR 元数据
  COMMIT_ATTRIBUTION: false,

  // Hook 交互提示：允许 Hook 通过标准输入输出向用户发起补充提问
  HOOK_PROMPTS: false,

  // Ultrathink 快捷模式：识别 ultrathink 关键词并临时提高推理强度
  ULTRATHINK: false,

  // Coordinator 模式：启用 coordinator swarm 多 worker 编排模式
  COORDINATOR_MODE: true,

  // Fork 子 agent：普通交互会话可将完整上下文分叉到后台 worker
  FORK_SUBAGENT: true,

};

// =============================================================================
// ⚠️  需要原生依赖 —— 开启前需确认对应的 vendor 二进制或系统能力存在
// =============================================================================

export const NATIVE_REQUIRED = {

  // macOS 原生剪贴板图片快速路径；失败时回退到现有 osascript 实现
  // 可选依赖：image-processor-napi（当前未安装，开启开关不会获得原生加速）
  NATIVE_CLIPBOARD_IMAGE: false,

  // 语音模式：通过麦克风语音输入（仅 macOS）
  // 依赖：audio-capture-napi 原生模块（当前未包含）
  VOICE_MODE: false,

  // Web 浏览器工具：让 Claude 控制浏览器访问网页（类似 Playwright）
  // 依赖：需要 Chromium / Chrome 浏览器已安装
  WEB_BROWSER_TOOL: false,
};

// =============================================================================
// 🚫 不要开启 —— 依赖 Anthropic 内部服务，开了会报错或无效
// =============================================================================

export const INTERNAL_ONLY = {
  // --- 其他内部功能 ---
  IS_LIBC_GLIBC: false,           // 构建环境标记
  IS_LIBC_MUSL: false,            // 构建环境标记
};
