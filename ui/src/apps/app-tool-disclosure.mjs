export function describeAppTools(manifest) {
  return (manifest?.contributes?.tools || []).map(tool => ({
    id: tool.id,
    title: tool.title,
    description: tool.description,
    effect: tool.effect,
    ...(tool.serviceId ? { serviceId: tool.serviceId } : {}),
    ...(tool.permission ? { permission: tool.permission } : {}),
  }))
}

const effectLabels = { read: '只读', write: '可修改数据', destructive: '破坏性操作' }

export async function confirmAppInstallation(dialog, manifest, permissions = [], details = '') {
  const tools = describeAppTools(manifest)
  if (!permissions.length && !tools.length && !details) return true
  const sections = details ? [details] : []
  if (manifest.nativeAdapter) sections.push('原生控制适配器将在 Moss 主进程运行，需要可信签名及宿主允许的发布者。系统权限归属于 Moss，目标应用和前台控制仍由 Moss 单独询问；更换已加载的驱动需重启 Moss。')
  if (permissions.length) sections.push(['新增权限', ...permissions.map(permission => `• ${permission}`)].join('\n'))
  if (tools.length) sections.push([
    `AI 工具（${tools.length} 个）`,
    manifest.toolSelection === 'services'
      ? (manifest.toolScope === 'global' ? '以下工具在所有会话按需提供，选择具体子服务后，其工具常驻。' : '以下工具仅在会话选择对应子服务后常驻提供。')
      : manifest.toolScope === 'global' ? '以下工具在所有会话按需提供，选择此 App 后常驻。' : '以下工具仅在会话选择此 App 后常驻提供（包括 App 接入的 MCP 工具）。',
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
