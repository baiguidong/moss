import { describeAppPermission, formatAppPermission } from '../shared/app-capability-descriptions.mjs'

// Keep this formatter local to the disclosure module so the renderer does not
// pull the Node-only App Runtime bundle into the App settings UI.
function appToolName(appId, localId) {
  const normalize = value => String(value).replace(/[^a-zA-Z0-9_]/g, '_')
  return `app__${normalize(appId)}__${normalize(localId)}`.slice(0, 64)
}

export function describeAppTools(manifest) {
  return (manifest?.contributes?.tools || []).map(tool => ({
    id: tool.id,
    name: appToolName(manifest.id, tool.id),
    title: tool.title,
    description: tool.description,
    effect: tool.effect,
    ...(tool.serviceId ? { serviceId: tool.serviceId } : {}),
    ...(tool.permission ? { permission: tool.permission } : {}),
  }))
}

const effectLabels = { read: '只读', write: '可修改数据', destructive: '破坏性操作' }

function toolAvailability(manifest) {
  return manifest.toolSelection === 'services'
    ? (manifest.toolScope === 'global' ? '以下工具在所有会话按需提供，选择具体子服务后，其工具常驻。' : '以下工具仅在会话选择对应子服务后常驻提供。')
    : manifest.toolScope === 'global' ? '以下工具在所有会话按需提供，选择此 App 后常驻。' : '以下工具仅在会话选择此 App 后常驻提供（包括 App 接入的 MCP 工具）。'
}

export function describeAppInstallation(manifest, permissions = [], details = '') {
  const notices = details ? [details] : []
  if (manifest.nativeAdapter) notices.push('原生控制适配器将在 Moss 主进程运行，需要可信签名及宿主允许的发布者。系统权限归属于 Moss，目标应用和前台控制仍由 Moss 单独询问；更换已加载的驱动需重启 Moss。')
  return {
    type: 'app-installation', appId: manifest.id, name: manifest.displayName || manifest.id,
    version: manifest.version || '', publisher: manifest.publisher?.name || manifest.publisher?.id || '',
    permissions: permissions.map(describeAppPermission), tools: describeAppTools(manifest),
    skills: (manifest.contributes?.skills || []).map(({ id, title, description }) => ({ id, title, description })),
    capabilities: structuredClone(manifest.appCapabilities || {}),
    toolAvailability: toolAvailability(manifest), notices,
  }
}

function capabilitySections(capabilities) {
  const required = capabilities?.requires || []
  const provided = capabilities?.provides || []
  const usedTools = capabilities?.usesTools || []
  const sections = []
  if (required.length) sections.push(['调用其他 App 的能力',
    ...required.map(capability => `• ${capability.protocol}${capability.optional ? '（可选）' : ''}`),
  ].join('\n'))
  if (usedTools.length) sections.push(['调用其他 App 的现有工具',
    'Moss 将转发调用并把结果返回给当前 App。授权覆盖目标 App 当前及以后启用的实例和子服务。工具可能读取或修改目标 App 可访问的数据。',
    ...usedTools.map(target => `• ${target.appId}\n${target.tools.map(tool => `  · ${tool}`).join('\n')}`),
  ].join('\n'))
  if (provided.length) sections.push(['供其他 App 调用的能力',
    ...provided.map(capability => `• ${capability.protocol}\n${capability.methods.map(method =>
      `  ${method.name} → ${method.action}（${method.permission}${method.resourceReadMethod ? `，结果由 ${method.resourceReadMethod} 读取` : ''}）`).join('\n')}`),
  ].join('\n'))
  return sections
}

export function appCapabilityDeclarationChanged(previousManifest, nextManifest) {
  return JSON.stringify(previousManifest?.appCapabilities || null) !== JSON.stringify(nextManifest?.appCapabilities || null)
}

export function describePreviousAppCapabilities(previousManifest, nextManifest) {
  if (!previousManifest?.appCapabilities || !appCapabilityDeclarationChanged(previousManifest, nextManifest)) return ''
  return ['原版本的跨 App 能力声明', ...capabilitySections(previousManifest.appCapabilities)].join('\n')
}

export async function confirmAppInstallation(dialog, manifest, permissions = [], details = '') {
  const tools = describeAppTools(manifest)
  const skills = manifest.contributes?.skills || []
  const capabilityDetails = capabilitySections(manifest.appCapabilities)
  if (!permissions.length && !tools.length && !skills.length && !details && !manifest.nativeAdapter
    && !capabilityDetails.length) return true
  const sections = details ? [details] : []
  if (manifest.nativeAdapter) sections.push('原生控制适配器将在 Moss 主进程运行，需要可信签名及宿主允许的发布者。系统权限归属于 Moss，目标应用和前台控制仍由 Moss 单独询问；更换已加载的驱动需重启 Moss。')
  if (permissions.length) sections.push(['新增权限', ...permissions.map(permission => `• ${formatAppPermission(permission)}`)].join('\n'))
  sections.push(...capabilityDetails)
  if (tools.length) sections.push([
    `AI 工具（${tools.length} 个）`,
    toolAvailability(manifest),
    ...tools.map(tool => `• ${tool.title}（${tool.id}） · ${effectLabels[tool.effect]}\n  工具名称：${tool.name}\n  ${tool.description}`),
  ].join('\n'))
  if (skills.length) sections.push(['CLI skills', ...skills.map(skill => `• ${skill.title}: ${skill.description}`)].join('\n'))
  const result = await dialog.showMessageBox({
    type: 'question', title: '安装 Moss App',
    message: `确认“${manifest.displayName || manifest.id}”提供的能力`,
    detail: sections.join('\n\n'),
    disclosure: describeAppInstallation(manifest, permissions, details),
    buttons: ['取消', permissions.length ? '安装并授权' : '安装'],
    defaultId: 1, cancelId: 0, noLink: true,
  })
  return result.response === 1
}
