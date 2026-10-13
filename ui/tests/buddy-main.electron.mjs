// Full Desktop acceptance. Opt-in live-model mode copies only model credentials
// into a temporary profile; all settings, sessions and App data remain isolated.
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
let releaseBootstrap
const bootstrapped=new Promise(resolve=>{releaseBootstrap=resolve})

async function run(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-buddy-main-'))
 const output=fileURLToPath(new URL('../../output/buddy-tests/',import.meta.url))
 const live=process.env.MOSS_BUDDY_LIVE_MODEL==='1'
 const packageRoot=process.env.MOSS_BUDDY_PACKAGE||fileURLToPath(new URL('../../../moss-apps/artifacts/moss.buddy/0.1.2/package/',import.meta.url))
 process.env.MOSS_HOME=root;process.env.MOSS_CONFIG_DIR=root;process.env.MOSS_OPEN_DEVTOOLS='false'
 app.setAppPath(fileURLToPath(new URL('..',import.meta.url)));app.setPath('userData',path.join(root,'electron'))
 app.on('window-all-closed',()=>{})
 const timeout=setTimeout(()=>{console.error('Full Buddy acceptance timed out');app.exit(1)},live?240000:60000)
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
 async function until(read,predicate,attempts=300){for(let i=0;i<attempts;i++){const v=await read();if(predicate(v))return v;await delay(100)}throw new Error('Acceptance condition timed out: '+JSON.stringify(await read()).slice(0,2000))}
 try{
  if(live){
   const original=JSON.parse(await fs.readFile(process.env.MOSS_BUDDY_AGENT_SETTINGS||path.join(os.homedir(),'.moss/settings.json'),'utf8'))
   assert.ok(original.models?.text?.model&&original.models?.text?.baseUrl,'No configured text model')
   await fs.writeFile(path.join(root,'settings.json'),JSON.stringify({models:{text:{...original.models.text,maxTurns:12}},permissionMode:'default'}),{mode:0o600})
  }
  const handlers=new Map(),handle=ipcMain.handle.bind(ipcMain)
  ipcMain.handle=(name,fn)=>{handlers.set(name,fn);return handle(name,fn)}
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(path.dirname(packageRoot),'moss.buddy-0.1.2.zip')]})
  let configurationPrompts=0
  dialog.showMessageBox=async(...args)=>{if(args.at(-1)?.title==='修改 Moss 配置')configurationPrompts++;return {response:1}}
  let mainWindow
  const ready=new Promise(resolve=>app.on('browser-window-created',(_event,w)=>{
   w.show=()=>{};w.showInactive=()=>{}
   w.webContents.setBackgroundThrottling(false)
   w.webContents.on('did-attach-webview',(_event,guest)=>guest.setBackgroundThrottling(false))
   if(mainWindow)return;mainWindow=w
   const send=w.webContents.send.bind(w.webContents)
   w.webContents.send=(channel,...args)=>{
    if(channel==='agent:question-request'){
     const question=args[0],input=question.input||question,meta=input.metadata||question.metadata||{}
     const allow=/^app__moss_buddy__(settings_read|settings_apply|help_search)$/.test(meta.toolName||'')
     const payload=allow?{...question,answers:Object.fromEntries((input.questions||[]).map(q=>[q.question,q.options.find(o=>/允许一次/.test(o.label))?.label||q.options[0].label]))}:question
     setTimeout(()=>void handlers.get(allow?'agent:answer-question':'agent:reject-question')({sender:w.webContents},payload).catch(()=>{}),0)
    }
    return send(channel,...args)
   }
   w.webContents.once('did-finish-load',()=>resolve(w))
  }))
  await import('../src/main.mjs');releaseBootstrap();await ready
  const invoke=(name,input)=>{assert.ok(handlers.has(name),name);return handlers.get(name)({sender:mainWindow.webContents},input)}
  assert.equal((await invoke('app:install-archive')).ok,true)
  await until(()=>invoke('app:list'),apps=>apps.some(a=>a.id==='moss.buddy'))
  const widgets=await invoke('app:list-contributions',{kinds:['widgets']});assert.equal(widgets.widgets.filter(w=>w.appId==='moss.buddy').length,1)
  await until(()=>mainWindow.webContents.executeJavaScript('document.querySelectorAll("webview").length'),n=>n>0)
  const widgetSelector='aside[aria-label="Buddy 桌面挂件"]'
  const widgetBox=()=>mainWindow.webContents.executeJavaScript(`(()=>{const el=document.querySelector('${widgetSelector}');if(!el)return null;const box=el.getBoundingClientRect();return {width:box.width,height:box.height,expanded:el.dataset.expanded}})()`)
  const widgetContent=()=>mainWindow.webContents.executeJavaScript(`document.querySelector('${widgetSelector} webview').executeJavaScript('JSON.stringify({hash:location.hash,mini:document.documentElement.classList.contains("buddy-mini"),navigation:getComputedStyle(document.querySelector(".b-nav")).display,hatched:document.querySelector(".buddy-product").classList.contains("hatched")})')`).then(JSON.parse).catch(()=>null)
  await until(widgetBox,box=>box?.width===56&&box?.height===56)
  await mainWindow.webContents.executeJavaScript(`document.querySelector('${widgetSelector} button[aria-label="打开 Buddy"]').click()`)
  await until(widgetBox,box=>box?.expanded==='true'&&box.width>56)
  await mainWindow.webContents.executeJavaScript(`document.querySelector('${widgetSelector} button').click()`)
  await until(widgetBox,box=>box?.width===56&&box?.height===56)
  await until(widgetContent,content=>content?.mini&&content.navigation==='none')
  // Repeat after the guest is ready, also verifying the expanded guest content.
  await mainWindow.webContents.executeJavaScript(`document.querySelector('${widgetSelector} button[aria-label="打开 Buddy"]').click()`)
  await until(widgetContent,content=>content&&!content.mini&&content.navigation!=='none')
  await mainWindow.webContents.executeJavaScript(`document.querySelector('${widgetSelector} button').click()`)
  await until(widgetContent,content=>content?.mini&&content.navigation==='none')
  const current=new Set(BrowserWindow.getAllWindows().map(w=>w.id));assert.equal((await invoke('app:launch',{name:'moss.buddy'})).ok,true)
  const buddy=await until(()=>BrowserWindow.getAllWindows().find(w=>!current.has(w.id)),Boolean)
  await until(()=>buddy.webContents.executeJavaScript('Boolean(document.querySelector("#hatch-form"))').catch(()=>false),Boolean)
  const action=(name,input={})=>buddy.webContents.executeJavaScript(`window.mossApp.actions.invoke(${JSON.stringify(name)},${JSON.stringify(input)},{requestId:crypto.randomUUID()}).then(r=>{if(!r.ok)throw new Error(r.error.message);return r.result})`)
  const state=await action('pet.hatch',{name:'小苔',skin:'orb'})
  const assistantDir=path.join(root,'assistants','buddy-test')
  await fs.mkdir(assistantDir,{recursive:true})
  await fs.writeFile(path.join(assistantDir,'_moss_meta.json'),JSON.stringify({name:'buddy-test',enabled:true}))
  await fs.writeFile(path.join(assistantDir,'assistant.md'),'Original assistant rules')
  const catalog=await action('settings_read',{operation:'catalog'})
  assert.deepEqual(catalog.domains.map(d=>d.id).sort(),['agent','apps','assistants','desktop','mcp','preferences','session'].sort())
  const before=await action('settings_read',{operation:'read',domain:'desktop'})
  await action('settings_apply',{domain:'desktop',revision:before.revision,requestId:'test-theme',changes:[{path:'appearance.themeMode',value:'dark'}]})
  assert.equal((await invoke('agent:get-settings')).appearance.themeMode,'dark')
  const agentBefore=await action('settings_read',{operation:'read',domain:'agent',scope:'user'})
  const agentReceipt=await action('settings_apply',{domain:'agent',scope:'user',revision:agentBefore.revision,requestId:'agent-setting',changes:[{path:'cleanupPeriodDays',value:17}]})
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'settings.json'),'utf8')).cleanupPeriodDays,17)
  await action('settings_undo',{receiptId:agentReceipt.receiptId,requestId:'agent-undo'})
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'settings.json'),'utf8')).cleanupPeriodDays,undefined)
  await buddy.webContents.executeJavaScript('document.querySelector("[data-page=configuration]").click()')
  await until(()=>buddy.webContents.executeJavaScript('document.querySelector("#settings-list").textContent'),text=>text.includes('终端配色')&&text.includes('终端编辑快捷键')&&text.includes('详细输出'))
  await buddy.webContents.executeJavaScript('document.querySelector("[data-page=pet]").click()')
  const prefs=await action('settings_read',{operation:'read',domain:'preferences'})
  await action('settings_apply',{domain:'preferences',revision:prefs.revision,requestId:'global-pref',changes:[{path:'verbose',value:true}]})
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'moss.json'),'utf8')).verbose,true)
  const assistant=await action('settings_read',{operation:'read',domain:'assistants',target:'buddy-test'})
  await action('settings_apply',{domain:'assistants',target:'buddy-test',revision:assistant.revision,requestId:'assistant-rules',changes:[{path:'instructions',value:'Updated rules'}]})
  assert.equal(await fs.readFile(path.join(assistantDir,'assistant.md'),'utf8'),'Updated rules')
  await invoke('agent:update-settings',{mcp:{version:1,servers:{fixture:{enabled:false,config:{type:'stdio',command:'node',args:[]},updatedAt:1}}}})
  const mcp=await action('settings_read',{operation:'read',domain:'mcp',target:'fixture'})
  await action('settings_apply',{domain:'mcp',target:'fixture',revision:mcp.revision,requestId:'mcp-tools',changes:[{path:'config.disabledTools',value:['unused']}]})
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'settings.json'),'utf8')).mcp.servers.fixture.config.disabledTools,['unused'])
  const created=await invoke('agent:create-session',{title:'Configuration acceptance',agentMode:'local'})
  const sessionTarget=`session:${created.summary.id}`
  const session=await action('settings_read',{operation:'read',domain:'session',target:sessionTarget})
  await action('settings_apply',{domain:'session',target:sessionTarget,revision:session.revision,requestId:'session-mode',changes:[{path:'permissionMode',value:'dontAsk'}]})
  assert.equal((await invoke('agent:get-session',{sessionId:created.summary.id})).permissionMode,'dontAsk')
  if(live){
   await buddy.webContents.executeJavaScript('document.querySelector("#chat-input").value="你好，请用一句话介绍你自己，不用工具。";document.querySelector("#chat-form").requestSubmit()')
   const first=await until(()=>action('pet.get'),s=>s.messages.some(m=>m.role==='assistant')||s.errors.length,900)
   assert.equal(first.errors.length,0,first.errors[0]?.error)
   assert.ok(first.messages.some(m=>m.role==='assistant'&&m.text.length>0))
   await until(()=>buddy.webContents.executeJavaScript('document.querySelector("#send").disabled'),value=>value===false)
   await buddy.webContents.executeJavaScript('document.querySelector("#chat-input").value="把 Moss 桌面切换为浅色。直接查询配置目录和当前值，通过配置工具修改；只修改 appearance.themeMode，不要改其他参数，也不用提问。";document.querySelector("#chat-form").requestSubmit()')
   const second=await until(()=>action('pet.get'),s=>s.messages.filter(m=>m.role==='assistant').length>=2||s.errors.length,1200)
   assert.equal(second.errors.length,0,second.errors[0]?.error)
   assert.equal((await invoke('agent:get-settings')).appearance.themeMode,'light','Live Agent did not apply the requested setting')
  }
  assert.equal(configurationPrompts,0,'Buddy unrestricted mode unexpectedly asked for config approval')
  let modeState=await action('pet.get')
  await action('pet.update',{revision:modeState.revision,preferences:{permissionMode:'default'}})
  const restricted=await action('settings_read',{operation:'read',domain:'mcp',target:'fixture'})
  await action('settings_apply',{domain:'mcp',target:'fixture',revision:restricted.revision,requestId:'confirm-mode',changes:[{path:'config.disabledTools',remove:true}]})
  assert.equal(configurationPrompts,1,'Confirm mode did not request approval')
  modeState=await action('pet.get');await action('pet.update',{revision:modeState.revision,preferences:{permissionMode:'bypassPermissions'}})
  const after=await action('pet.get');assert.equal(after.pet.id,state.pet.id)
  await until(widgetContent,content=>content?.mini&&content.navigation==='none'&&content.hatched)
  await fs.mkdir(output,{recursive:true})
  await mainWindow.webContents.executeJavaScript(`document.querySelector('${widgetSelector} button[aria-label="打开 Buddy"]').click()`)
  await until(widgetBox,box=>box?.expanded==='true'&&box.width>56)
  await until(widgetContent,content=>content&&!content.mini&&content.navigation!=='none'&&content.hatched)
  await delay(250)
  await fs.writeFile(path.join(output,'desktop-expanded.png'),(await mainWindow.webContents.capturePage()).toPNG())
  await mainWindow.webContents.executeJavaScript(`document.querySelector('${widgetSelector} button').click()`)
  await until(widgetBox,box=>box?.expanded==='false'&&box.width===56&&box.height===56)
  await until(widgetContent,content=>content?.mini&&content.navigation==='none'&&content.hatched)
  await delay(250)
  await fs.writeFile(path.join(output,'desktop-widget.png'),(await mainWindow.webContents.capturePage()).toPNG())
  await fs.writeFile(path.join(output,live?'live-model.png':'full-host.png'),(await buddy.webContents.capturePage()).toPNG())
  await fs.writeFile(path.join(output,live?'live-model-evidence.json':'full-host-evidence.json'),JSON.stringify({passed:true,liveModel:live,domains:catalog.domains.map(d=>d.id),petIdentityStable:after.pet.id===state.pet.id,assistantMessages:after.messages.filter(m=>m.role==='assistant').length,widget:{...await widgetBox(),...await widgetContent()}},null,2))
  await invoke('app:set-enabled',{appId:'moss.buddy',enabled:false})
  assert.equal((await invoke('app:list-contributions',{kinds:['widgets']})).widgets.some(w=>w.appId==='moss.buddy'),false)
  console.log(JSON.stringify({ok:true,liveModel:live,checks:['full Desktop ZIP install','widget host','independent window','all configuration adapters','Agent apply/undo','global preferences','live chat and config tool','disable cleanup']}))
 }catch(error){releaseBootstrap();console.error(error);process.exitCode=1}
 finally{clearTimeout(timeout);for(const w of BrowserWindow.getAllWindows())w.destroy();await fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100}).catch(()=>{});app.exit(process.exitCode||0)}
}
void run().catch(error=>{releaseBootstrap();console.error(error);app.exit(1)})
await bootstrapped
