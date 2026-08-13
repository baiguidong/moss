export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion';
export const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode';

const MAX_PERMISSION_DETAIL_LENGTH = 1600;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getInputString(input, keys) {
  if (!isRecord(input)) return '';
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function truncateDetail(detail) {
  if (detail.length <= MAX_PERMISSION_DETAIL_LENGTH) return detail;
  return `${detail.slice(0, MAX_PERMISSION_DETAIL_LENGTH)}\n...（内容已截断）`;
}

function formatInputValue(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    const values = value.map(formatInputValue).filter(Boolean);
    return values.length > 0 ? values.join('、') : '';
  }
  if (isRecord(value)) {
    return Object.values(value).map(formatInputValue).filter(Boolean).join('；');
  }
  return '';
}

function formatGenericInput(input) {
  if (!isRecord(input)) return '';

  const labels = {
    command: '命令',
    cmd: '命令',
    description: '用途',
    file_path: '文件',
    filePath: '文件',
    path: '位置',
    url: '网址',
    query: '搜索内容',
    pattern: '匹配内容',
    prompt: '操作说明',
    content: '内容',
  };
  const lines = [];
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('_')) continue;
    const formattedValue = formatInputValue(value);
    if (!formattedValue) continue;
    lines.push(`${labels[key] || '操作参数'}：${formattedValue}`);
    if (lines.length >= 6) break;
  }
  return truncateDetail(lines.join('\n'));
}

function buildCommandDialog(input) {
  const command = getInputString(input, ['command', 'cmd']);
  const description = getInputString(input, ['description']);
  const details = [];
  if (description) details.push(`用途：${description}`);
  if (command) details.push(`命令：\n${command}`);
  if (isRecord(input) && input.run_in_background === true) {
    details.push('运行方式：后台运行');
  }
  if (isRecord(input) && input.dangerouslyDisableSandbox === true) {
    details.unshift('安全提醒：此命令将绕过安全沙箱。');
  }

  return {
    title: '运行命令',
    message: '允许 Agent 在这台电脑上运行下面的命令吗？',
    detail: truncateDetail(details.join('\n\n') || 'Agent 请求运行一个本地命令。'),
    buttons: ['允许运行', '取消'],
  };
}

function buildFileDialog(toolName, input) {
  const normalizedName = String(toolName || '').toLowerCase();
  const filePath = getInputString(input, ['file_path', 'filePath', 'notebook_path', 'path']);
  const isWrite = normalizedName.includes('write')
    || normalizedName.includes('edit')
    || normalizedName.includes('patch');
  const action = isWrite ? '修改' : '读取';

  return {
    title: `${action}文件`,
    message: `允许 Agent ${action}下面的文件吗？`,
    detail: filePath ? `文件：\n${filePath}` : `Agent 请求${action}一个文件。`,
    buttons: [`允许${action}`, '取消'],
  };
}

function buildWebDialog(toolName, input) {
  const normalizedName = String(toolName || '').toLowerCase();
  const isSearch = normalizedName.includes('search');
  const target = isSearch
    ? getInputString(input, ['query', 'pattern', 'prompt'])
    : getInputString(input, ['url']);
  const action = isSearch ? '搜索网页' : '访问网页';

  return {
    title: action,
    message: `允许 Agent ${action}吗？`,
    detail: target
      ? `${isSearch ? '搜索内容' : '网址'}：\n${target}`
      : `Agent 请求${action}。`,
    buttons: ['允许', '取消'],
  };
}

export function shouldAutoApproveToolPermission({ bypassPermissions, toolName }) {
  return Boolean(bypassPermissions) && toolName === EXIT_PLAN_MODE_TOOL_NAME;
}

function getRememberPermissionLabel(suggestions) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return '';
  const hasPersistentUpdate = suggestions.some((suggestion) =>
    isRecord(suggestion)
    && ['localSettings', 'projectSettings', 'userSettings'].includes(suggestion.destination));
  return hasPersistentUpdate ? '以后允许' : '本次会话允许';
}

function describePermissionRule(rule) {
  if (!isRecord(rule)) return '';
  const toolName = String(rule.toolName || '').toLowerCase();
  const ruleContent = typeof rule.ruleContent === 'string'
    ? rule.ruleContent.trim()
    : '';

  if (toolName === 'bash' || toolName.includes('shell') || toolName.includes('powershell')) {
    if (!ruleContent) return '运行此类命令';
    if (ruleContent.endsWith(':*')) {
      return `运行以“${ruleContent.slice(0, -2)}”开头的命令`;
    }
    return `运行命令“${ruleContent}”`;
  }
  if (toolName.includes('websearch') || toolName === 'web_search') return '进行网页搜索';
  if (toolName.includes('webfetch') || toolName.includes('browser')) return '访问对应网页';
  if (toolName.includes('read')) {
    return ruleContent ? `读取“${ruleContent}”范围内的文件` : '读取文件';
  }
  if (toolName.includes('write') || toolName.includes('edit')) {
    return ruleContent ? `修改“${ruleContent}”范围内的文件` : '修改文件';
  }
  return '执行同类操作';
}

function describeRememberScope(suggestions, rememberLabel) {
  const descriptions = [];
  for (const suggestion of suggestions) {
    if (!isRecord(suggestion)) continue;
    if (suggestion.type === 'addRules' && Array.isArray(suggestion.rules)) {
      descriptions.push(...suggestion.rules.map(describePermissionRule).filter(Boolean));
    } else if (suggestion.type === 'addDirectories' && Array.isArray(suggestion.directories)) {
      descriptions.push(...suggestion.directories
        .filter((directory) => typeof directory === 'string' && directory.trim())
        .map((directory) => `访问目录“${directory.trim()}”`));
    } else if (suggestion.type === 'setMode' && suggestion.mode === 'acceptEdits') {
      descriptions.push('修改工作区内的文件');
    }
  }

  const uniqueDescriptions = [...new Set(descriptions)].slice(0, 3);
  if (uniqueDescriptions.length === 0) return '';
  const prefix = rememberLabel === '以后允许' ? '以后允许范围' : '本次会话允许范围';
  return `${prefix}：${uniqueDescriptions.join('；')}`;
}

function withRememberOption(dialog, suggestions) {
  const rememberLabel = getRememberPermissionLabel(suggestions);
  if (!rememberLabel) return dialog;
  const scopeDescription = describeRememberScope(suggestions, rememberLabel);
  return {
    ...dialog,
    detail: truncateDetail([
      dialog.detail,
      scopeDescription,
    ].filter(Boolean).join('\n\n')),
    buttons: [dialog.buttons[0], rememberLabel, dialog.buttons[1]],
    rememberOptionIndex: 1,
  };
}

export function buildToolPermissionDialog(toolName, input, suggestions) {
  if (toolName === EXIT_PLAN_MODE_TOOL_NAME) {
    return {
      title: '计划确认',
      message: '计划已准备好',
      detail: '确认后，Agent 将结束规划并进入执行阶段。',
      buttons: ['执行计划', '继续规划'],
    };
  }

  const normalizedName = String(toolName || '').toLowerCase();
  if (normalizedName === 'bash'
    || normalizedName.includes('shell')
    || normalizedName.includes('powershell')
    || normalizedName.includes('command')) {
    return withRememberOption(buildCommandDialog(input), suggestions);
  }
  if (normalizedName.includes('read')
    || normalizedName.includes('write')
    || normalizedName.includes('edit')
    || normalizedName.includes('patch')) {
    return withRememberOption(buildFileDialog(toolName, input), suggestions);
  }
  if (normalizedName.includes('web')
    || normalizedName.includes('fetch')
    || normalizedName.includes('browser')) {
    return withRememberOption(buildWebDialog(toolName, input), suggestions);
  }

  const inputSummary = formatGenericInput(input);
  return withRememberOption({
    title: '确认操作',
    message: '允许 Agent 执行这项操作吗？',
    detail: inputSummary || 'Agent 请求执行一项需要确认的操作。',
    buttons: ['允许', '取消'],
  }, suggestions);
}

export function getToolPermissionNotice(toolName) {
  const normalizedName = String(toolName || '').toLowerCase();
  if (toolName === ASK_USER_QUESTION_TOOL_NAME) return 'Agent 正在等待你回答问题';
  if (toolName === EXIT_PLAN_MODE_TOOL_NAME) return 'Agent 正在等待你确认计划';
  if (normalizedName === 'bash'
    || normalizedName.includes('shell')
    || normalizedName.includes('powershell')
    || normalizedName.includes('command')) {
    return 'Agent 正在等待运行命令的确认';
  }
  if (normalizedName.includes('write')
    || normalizedName.includes('edit')
    || normalizedName.includes('patch')) {
    return 'Agent 正在等待修改文件的确认';
  }
  if (normalizedName.includes('read')) return 'Agent 正在等待读取文件的确认';
  if (normalizedName.includes('web')
    || normalizedName.includes('fetch')
    || normalizedName.includes('browser')) {
    return 'Agent 正在等待网络访问的确认';
  }
  return 'Agent 正在等待你的操作确认';
}

export function resolveToolPermissionDialogResponse(responseIndex, dialog, suggestions) {
  if (responseIndex === 0) return { behavior: 'allow' };
  if (
    Number.isInteger(dialog?.rememberOptionIndex)
    && responseIndex === dialog.rememberOptionIndex
    && Array.isArray(suggestions)
    && suggestions.length > 0
  ) {
    return {
      behavior: 'allow',
      updatedPermissions: suggestions,
    };
  }
  return { behavior: 'deny', message: 'Denied by user' };
}
