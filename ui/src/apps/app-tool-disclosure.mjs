export function describeAppTools(manifest) {
  return (manifest?.contributes?.tools || []).map(tool => ({
    id: tool.id,
    title: tool.title,
    description: tool.description,
    effect: tool.effect,
    ...(tool.permission ? { permission: tool.permission } : {}),
  }))
}

const effectLabels = { read: '只读', write: '可修改数据', destructive: '破坏性操作' }

export async function confirmAppInstallation(dialog, manifest, permissions = []) {
  const tools = describeAppTools(manifest)
  if (!permissions.length && !tools.length) return true
  const sections = []
  if (permissions.length) sections.push(['新增权限', ...permissions.map(permission => `• ${permission}`)].join('\n'))
  if (tools.length) sections.push([
    `AI 工具（${tools.length} 个）`,
    '启用 App 后，以下工具会加入 Moss AI 助手的工具列表，可在对话中调用。',
    ...tools.map(tool => `• ${tool.title}（${tool.id}） · ${effectLabels[tool.effect]}\n  ${tool.description}`),
  ].join('\n'))
  const result = await dialog.showMessageBox({
    type: 'question', title: '安装 Moss App',
    message: `确认“${manifest.displayName || manifest.id}”提供的能力`,
    detail: sections.join('\n\n'),
    buttons: ['取消', permissions.length ? '安装并授权' : '安装'],
    defaultId: 1, cancelId: 0, noLink: true,
  })
  return result.response === 1
}
