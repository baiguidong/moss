// Presentation metadata is shared by the settings catalog and conversational tools.
// Storage paths remain stable; users see feature names rather than implementation keys.
const named = {
  'preferences.theme':['终端配色','仅影响命令行终端；桌面颜色请调整“桌面主题”。'],
  'preferences.editorMode':['终端编辑快捷键','选择普通输入或 Vim 快捷键。'],
  'preferences.verbose':['详细输出','显示更完整的执行与调试信息。'],
  'preferences.preferredNotifChannel':['终端通知方式','任务完成后通过哪种方式提醒你。'],
  'preferences.autoCompactEnabled':['自动压缩对话','上下文接近上限时整理已有对话，以便继续聊天。'],
  'preferences.fileCheckpointingEnabled':['文件修改回退','保留文件检查点，方便撤回代码修改。'],
  'preferences.showTurnDuration':['显示回复耗时','回复完成后显示本轮所用时间。'],
  'preferences.terminalProgressBarEnabled':['终端进度提示','在支持的终端显示任务进度。'],
  'preferences.teammateMode':['协作助手运行方式','选择在当前进程或独立终端运行协作助手。'],
  'appearance.themeMode':['桌面主题','选择浅色、深色或跟随系统。'],
  'appearance.cssThemeId':['桌面背景样式','设置桌面背景的视觉效果。'],
  'appearance.chatFontSize':['聊天字号','调整聊天文字大小。'],
  'appearance.chatLineHeight':['聊天行距','调整聊天文字的行间距。'],
  'appearance.chatMessageSpacing':['消息间距','调整不同消息之间的留白。'],
  'appearance.toolDisplayMode':['工具过程展示','选择展开、收起或合并工具执行过程。'],
  'appWidgets.enabled':['桌面宠物与挂件','显示或隐藏 Moss 窗口中的悬浮挂件。'],
  'sessionMemory.enabled':['会话摘要','允许模型按需保存会话摘要，方便查看和交接。'],
  'sessionMemory.compactEnabled':['摘要辅助压缩','使用会话摘要辅助整理上下文。'],
  'autoMemory.enabled':['自动记忆','记住长期有用的信息与偏好。'],
  'autoMemory.extractionEnabled':['自动提取记忆','从对话中整理可长期保存的信息。'],
  'autoMemory.pastContextSearchEnabled':['检索历史对话','需要时查找过去的对话内容。'],
  'autoMemory.dreamEnabled':['后台整理记忆','在后台归纳和整理记忆。'],
  'model':['默认模型','选择回复和执行任务使用的模型。'],
  'fastModel':['快速模型','选择处理轻量任务的模型。'],
  'maxTurns':['单次任务轮数上限','限制一次任务连续执行的轮数。'],
  'language':['回复语言','设置默认回复语言。'],
  'thinkingMode':['思考方式','选择模型默认、自适应思考、启用思考或关闭思考。'],
  'thinkingBudgetTokens':['思考预算','限制模型用于思考的内容长度。'],
  'effort':['思考强度','调整模型解决问题时投入的推理强度。'],
  'permissionMode':['执行权限','选择哪些操作可直接执行，哪些需要确认。'],
  'permissions.defaultMode':['默认执行权限','设置新会话的工具执行权限。'],
  'permissions.allow':['自动允许的工具','匹配这些规则的工具可以直接执行。'],
  'permissions.ask':['需要确认的工具','匹配这些规则的工具会先请求确认。'],
  'permissions.deny':['禁止的工具','阻止匹配这些规则的工具调用。'],
  'bypassPermissions':['全部执行权限','允许直接执行可用工具。'],
  'appendSystemPrompt':['附加助手规则','给助手补充共同遵循的工作要求。'],
  'instructions':['助手规则','设置这位助手的职责、口吻和工作方式。'],
  'agentSettings.disabled':['停用的 Agent','选择不参与工作的 Agent。'],
  'agentTeamsEnabled':['多助手协作','允许多个助手协同完成任务。'],
  'agentMode':['运行位置','选择使用本机或远端的 Agent。'],
  'localEnabled':['本机运行','启用本机 Agent。'],
  'remoteEnabled':['远端连接','启用远端 Agent 连接。'],
  'cleanupPeriodDays':['历史保留天数','设置会话历史的自动清理周期。'],
  'userAvatar':['个人头像','设置聊天中显示的头像。'],
  'hooks':['自动执行规则','在工具调用、会话等事件发生时执行指定动作。'],
  'enabled':['启用','开启或停用此功能。'],
  'config':['应用参数','调整此应用提供的业务设置。'],
  'mcp.servers':['工具服务','管理已连接的工具服务及其参数。'],
  'managedRuntimes.node':['内置 Node.js','允许 Moss 管理 JavaScript 运行环境。'],
  'managedRuntimes.python':['内置 Python','允许 Moss 管理 Python 运行环境。'],
  'managedRuntimes.git':['内置 Git','允许 Moss 管理 Git 运行环境。'],
  'remoteDirectServerUrl':['远端服务器地址','连接到远端 Moss 服务。'],
  'remoteDirectWorkspace':['远端工作目录','设置远端默认工作目录。'],
  'remoteDirectCredentialMode':['远端登录方式','选择远端连接的登录方式。'],
  'remoteDirectUserName':['远端用户名','设置连接远端服务的用户名。'],
  'remoteDirectUserEmail':['远端用户邮箱','设置远端账户邮箱。'],
  'url':['模型服务地址','设置模型 API 的服务地址。'],
  'webSearch.mode':['联网搜索方式','选择搜索服务的使用方式。'],
  'image.model':['图片模型',''],
  'agentMail.enabled':['Agent 消息接收','接收发给 Agent 的消息。'],
  'logRotationMaxSize':['单个日志文件大小','达到此大小后切换新的日志文件，单位为字节。'],
  'logRotationMaxFiles':['日志文件保留数','保留多少个轮换日志文件。'],
}
const roots={appearance:'桌面外观',sessionMemory:'会话摘要',autoMemory:'自动记忆',toolLoading:'工具加载',advanced:'高级运行设置',models:'模型',permissions:'权限规则',sandbox:'运行隔离',hooks:'自动执行规则',mcp:'工具服务',agentMail:'Agent 消息',skillHub:'技能目录',expertHub:'助手目录',env:'环境变量'}
export function settingPresentation(domain, field) {
  const key=field.key, definition=named[`${domain}.${key}`]||named[key]
  let group='其他设置'
  if(domain==='preferences')group='终端与通用偏好'
  else if(domain==='apps'||domain==='mcp'||/^(mcp|remote|localEnabled|agentMode|managedRuntimes)/.test(key))group='应用与连接'
  else if(domain==='assistants')group='助手'
  else if(/^appearance|^appWidgets|^userAvatar/.test(key))group='外观与桌面'
  else if(/memory|compact|cleanup/i.test(key))group='记忆与上下文'
  else if(/permission|tool|hooks|sandbox/i.test(key))group='权限与工具'
  else if(/model|thinking|effort|language|maxTurns|appendSystemPrompt/i.test(key))group='模型与回复'
  else if(/notif|mail/i.test(key))group='通知与消息'
  const title=field.schema?.title
  const label=definition?.[0]||(/[\u4e00-\u9fff]/.test(title||'')?title:null)
  const description = definition?.[1] ?? (/[\u4e00-\u9fff]/.test(field.description) ? field.description : '可向伙伴描述你的需求，由它查询并调整。')
  return {...field,label:label||roots[key.split('.')[0]]||'扩展设置',group,common:Boolean(label),description}
}

export const settingsAreaNames={desktop:'桌面设置',agent:'Agent 与项目设置',session:'会话设置',apps:'应用设置',mcp:'工具服务设置',assistants:'助手规则',preferences:'终端与通用偏好'}
export function describeSettingsChange(domain, change){
  const label=settingPresentation(domain,{key:change.path}).label
  const format=value=>value===undefined?'未设置':value===true?'开启':value===false?'关闭':typeof value==='string'?({light:'浅色',dark:'深色',system:'跟随系统',default:'需要时确认',bypassPermissions:'全部权限',acceptEdits:'自动批准文件编辑',dontAsk:'只执行已授权操作'}[value]||value):JSON.stringify(value,null,2)
  return `${label}：${format(change.before)} → ${change.remove?'恢复默认':format(change.after)}`
}
