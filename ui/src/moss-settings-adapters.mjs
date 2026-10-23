import Ajv from 'ajv'
import { DEFAULT_DESKTOP_SETTINGS, normalizeDesktopSettings } from './desktop-settings.mjs'
import { validateMcpServerConfig } from './desktop-mcp-settings.mjs'
import { PERMISSION_MODES } from './permission-modes.mjs'
import { inferConfigurationSchema, configurationValue, configurationPath, configurationRevision, configurationEqual } from './moss-settings-service.mjs'

const ajv = new Ajv({strict:false,allErrors:true})
const clone = value => structuredClone(value)
const desktopSchema = inferConfigurationSchema(DEFAULT_DESKTOP_SETTINGS)
const object = {type:'object',additionalProperties:true}
const enums = {
  'appearance.themeMode':['light','dark','system'], 'appearance.cssThemeId':['default','grid-theme','dot-theme','gradient-theme','takt-theme'],
  'appearance.toolDisplayMode':['expanded','collapsed','merged'], 'permissionMode':PERMISSION_MODES,
  'thinkingMode':['adaptive','enabled','disabled'],
}
for (const [key, values] of Object.entries(enums)) { const field = configurationValue(desktopSchema.properties,key.split('.').join('.properties.')); if (field) field.enum = values }
for (const [key,min,max] of [['chatFontSize',12,18],['chatLineHeight',1.3,2],['chatMessageSpacing',4,24]]) Object.assign(desktopSchema.properties.appearance.properties[key],{minimum:min,maximum:max})
function validateField(schema, key, value) {
  let field = schema
  for (const part of configurationPath(key)) {
    field = field.properties?.[part] || (typeof field.additionalProperties === 'object' ? field.additionalProperties : null)
    if (!field) throw new Error(`未知配置项：${key}`)
  }
  const valid = ajv.compile(field)
  if (!valid(value)) throw new Error(`${key}: ${ajv.errorsText(valid.errors)}`)
}

export function createMossSettingsAdapters(options) {
  const {getDesktop,applyDesktop,getDesktopRevision,getRuntime,getTargets,defaultWorkspace,onAgentChanged,getApps,readApp,writeApp,getSession,writeSession,getAssistants,readAssistant,writeAssistant,writeMcp} = options
  const userTarget = {id:'user',scope:'user',label:'本机用户设置'}
  async function resolveWorkspace(input) {
    const scope = input.scope || 'user'
    if (!['user','project','local'].includes(scope)) throw new Error('无效的 Agent 配置范围')
    if (scope === 'user' && (!input.target || input.target === 'user')) return {...userTarget,workspace:defaultWorkspace}
    const target = (await getTargets()).find(t => t.id === input.target)
    if (!target?.workspace || target.remote) throw new Error('请选择一个可用的本地项目或会话；远端配置请在远端会话管理')
    return {...target,scope}
  }
  const adapters = {
    preferences: {
      title:'Moss 通用与终端偏好',scopes:['user'],schema:async()=>(await getRuntime()).getMossPreferencesSchema(),
      resolve:input=>{if(input.scope&&input.scope!=='user')throw new Error('通用偏好仅支持用户范围');return userTarget},
      read:async()=>(await getRuntime()).inspectMossPreferences(),
      validate:async(_next,changes)=>{const schema=(await getRuntime()).getMossPreferencesSchema();for(const c of changes){if(c.remove)throw new Error('请设置具体的偏好值');validateField(schema,c.path,c.value)}},
      apply:async(_next,changes,_target,revision)=>{await (await getRuntime()).applyMossPreferences({revision,changes});return {status:'saved',message:'Moss 通用偏好已保存；终端界面设置在下次启动时生效。'}},
    },
    desktop: {
      title:'桌面与运行默认值',scopes:['user'],schema:() => desktopSchema,
      resolve:input => {if (input.scope && input.scope !== 'user') throw new Error('桌面配置只支持本机用户范围'); return userTarget},
      read:() => ({values:clone(getDesktop()),effective:clone(getDesktop()),revision:getDesktopRevision?.(),sources:[{source:'desktop',settings:clone(getDesktop())}]}),
      validate(next,changes) {
        const normalized = normalizeDesktopSettings(next,getDesktop())
        for (const change of changes) {
          if (change.remove) throw new Error('桌面配置请设置目录中声明的默认值')
          validateField(desktopSchema,change.path,change.value)
          if (!configurationEqual(configurationValue(normalized,change.path),change.value)) throw new Error(`不支持的配置值：${change.path}`)
        }
      },
      apply(next,changes) {
        const keys = [...new Set(changes.map(c => c.path.split('.')[0]))]
        const payload = Object.fromEntries(keys.map(k => [k,next[k]]))
        const result = applyDesktop(payload)
        const appearanceOnly = keys.every(k => ['appearance','userAvatar'].includes(k))
        return {status:appearanceOnly ? 'applied' : 'saved',message:appearanceOnly ? '桌面设置已立即生效。' : result?.skippedSessionCount ? `已保存；${result.skippedSessionCount} 个运行中的会话将在任务结束后刷新。` : '默认配置已保存；新建或重新加载的会话会使用新配置。'}
      },
    },
    agent: {
      title:'Agent、项目与 hooks',scopes:['user','project','local'],schema:async () => (await getRuntime()).getMossAgentConfigurationSchema(),
      targets:async()=>(await getTargets()).filter(target=>!target.remote),resolve:resolveWorkspace,
      async read(target) {
        const result = await (await getRuntime()).inspectMossAgentConfiguration(target.workspace,target.scope)
        const schema = (await getRuntime()).getMossAgentConfigurationSchema()
        const values = Object.fromEntries(Object.entries(result.stored).filter(([key])=>Object.hasOwn(schema.properties,key)))
        if (target.scope === 'user') for (const key of Object.keys(DEFAULT_DESKTOP_SETTINGS)) {
          if (Object.hasOwn(schema.properties || {},key)) values[key] = clone(getDesktop()[key])
        }
        const defaults=Object.fromEntries(Object.keys(DEFAULT_DESKTOP_SETTINGS).filter(key=>Object.hasOwn(schema.properties,key)).map(key=>[key,clone(getDesktop()[key])]))
        return {effective:{...defaults,...result.effective},sources:[{source:'desktop-defaults',settings:defaults},...result.sources],path:result.path,values,revision:configurationRevision({runtime:result.revision,values})}
      },
      async validate(next,changes,target) {
        const runtime = await getRuntime()
        const schema = runtime.getMossAgentConfigurationSchema()
        for (const c of changes) {
          if (!schema.properties?.[c.path.split('.')[0]]) throw new Error(`未知 Agent 配置项：${c.path}`)
          if (!c.remove) validateField(schema,c.path,c.value)
        }
        const desktopChanges = target.scope === 'user' ? changes.filter(c=>Object.hasOwn(DEFAULT_DESKTOP_SETTINGS,c.path.split('.')[0])) : []
        const fileChanges = changes.filter(c=>!desktopChanges.includes(c))
        if (desktopChanges.length && fileChanges.length) throw new Error('共享的桌面默认值和 Agent 专属配置请分成两次修改，以分别保存回执和撤销')
        if (desktopChanges.length) adapters.desktop.validate({...getDesktop(),...next},desktopChanges)
        const snapshot = runtime.inspectMossAgentConfiguration(target.workspace,target.scope)
        // Also check policy for values routed through the shared Desktop store.
        runtime.validateMossAgentConfiguration({workspace:target.workspace,scope:target.scope,revision:snapshot.revision,operations:changes})
      },
      async apply(next,changes,target,revision) {
        const runtime = await getRuntime()
        const desktopChanges = target.scope === 'user' ? changes.filter(c=>Object.hasOwn(DEFAULT_DESKTOP_SETTINGS,c.path.split('.')[0])) : []
        const fileChanges = changes.filter(c=>!desktopChanges.includes(c))
        if (desktopChanges.some(c=>c.remove)) throw new Error('用户级桌面共享配置请设置默认值；项目覆盖可用 remove 移除')
        if (fileChanges.length) {
          const current = await runtime.inspectMossAgentConfiguration(target.workspace,target.scope)
          await runtime.applyMossAgentConfiguration({workspace:target.workspace,scope:target.scope,revision:current.revision,operations:fileChanges})
        }
        if (desktopChanges.length) {
          const roots=[...new Set(desktopChanges.map(c=>c.path.split('.')[0]))]
          applyDesktop(Object.fromEntries(roots.map(key=>[key,next[key]])))
        }
        if (fileChanges.length) await onAgentChanged?.(target,changes)
        return {status:'saved',message:'Agent 配置已保存并重新读取；有效值与覆盖来源见配置详情。运行中会话可能需要下一轮或重新加载。'}
      },
    },
  }
  if (writeMcp) adapters.mcp = {
    title:'MCP 连接与工具配置',scopes:['server'],confirm:true,
    targets:()=>Object.keys(getDesktop().mcp?.servers||{}).map(id=>({id,label:id})),
    schema:()=>({type:'object',properties:{enabled:{type:'boolean'},config:{type:'object',description:'使用 read 返回的服务类型与现有字段。凭据请在连接设置中修改。'}}}),
    resolve:input=>{if(!Object.hasOwn(getDesktop().mcp?.servers||{},input.target))throw new Error('MCP 服务不存在，请先在连接设置中添加');return {id:input.target,scope:'server'}},
    read:target=>{const entry=getDesktop().mcp.servers[target.id];return {values:{enabled:entry.enabled,config:clone(entry.config)}}},
    validate:(next,changes)=>{
      if(changes.some(c=>!['enabled','config'].includes(c.path.split('.')[0])))throw new Error('不支持的 MCP 配置项')
      if(typeof next.enabled!=='boolean'||!configurationEqual(validateMcpServerConfig(next.config),next.config))throw new Error('MCP 配置无效或包含未支持的字段')
    },
    apply:async(next,_changes,target)=>{await writeMcp(target.id,next);return {status:'saved',message:'MCP 配置已保存；空闲会话已刷新，运行中会话将在任务结束后刷新。'}},
  }
  if (getApps) adapters.apps = {
    title:'App 开关与业务配置',scopes:['app'],targets:async () => (await getApps()).map(a => ({id:a.id,label:a.displayName || a.id})),
    schema:async input => input.target ? (await readApp(input.target)).schema : {type:'object',properties:{enabled:{type:'boolean'},config:object}},
    async resolve(input) { if (!(await getApps()).some(a => a.id === input.target)) throw new Error('App 不存在'); return {id:input.target,scope:'app'} },
    read:async target => { const app = await readApp(target.id); return {values:app.values,schema:app.schema} },
    validate:async (next,changes,target) => {if(changes.some(c=>c.path==='enabled')&&changes.length>1)throw new Error('App 开关和业务参数请分开修改');const schema=(await readApp(target.id)).schema; const valid=ajv.compile(schema); if(!valid(next)) throw new Error(ajv.errorsText(valid.errors))},
    apply:async (next,changes,target,_revision,context) => { await writeApp(target.id,next,context); return {status:'applied',message:'App 配置已应用，相关后台服务按 App 生命周期刷新。'} },confirm:true,
  }
  if (getSession) adapters.session = {
    title:'当前会话',scopes:['session'],targets:async () => (await getTargets()).filter(t => t.kind === 'session'),
    schema:() => ({type:'object',properties:{effort:{anyOf:[{type:'null'},{enum:['low','medium','high','max']}]},permissionMode:{enum:PERMISSION_MODES}}}),
    async resolve(input) {const target=(await getTargets()).find(t=>t.id===input.target&&t.kind==='session');if(!target)throw new Error('会话不存在');return {...target,scope:'session'}},
    read:async target => ({values:await getSession(target)}),
    validate:async (next,changes) => { if(changes.length!==1) throw new Error('会话参数请一次修改一项'); for (const c of changes) {if(!['effort','permissionMode'].includes(c.path)||c.remove)throw new Error('不支持的会话设置');validateField(await adapters.session.schema(),c.path,c.value)} },
    apply:async (next,changes,target,_revision,context) => {await writeSession(target,next,changes,context);return {status:'applied',message:'会话设置已应用。'}},
  }
  if (getAssistants) adapters.assistants = {
    title:'助手规则',scopes:['assistant'],targets:async () => (await getAssistants()).map(a=>({id:a.name,label:a.displayName||a.display_name||a.name})),
    schema:() => ({type:'object',properties:{instructions:{type:'string',maxLength:65536}}}),
    async resolve(input) {if(!(await getAssistants()).some(a=>a.name===input.target))throw new Error('助手不存在');return {id:input.target,scope:'assistant'}},
    read:async target => ({values:await readAssistant(target.id)}),
    validate:async (next,changes) => {if(changes.some(c=>c.path!=='instructions'||c.remove)||typeof next.instructions!=='string'||next.instructions.length>65536)throw new Error('无效的助手规则')},
    apply:async(next,_changes,target,_revision,context)=>{await writeAssistant(target.id,next,context);return {status:'saved',message:'助手规则已保存，将在该助手下次加载时生效。'}},confirm:true,
  }
  return adapters
}
