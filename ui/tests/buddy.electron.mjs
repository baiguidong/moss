// Real App package, isolated persistent Backend, Agent Channel, settings service,
// Chromium and preload. Only the model response is supplied by this fixture.
import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

async function run(){
const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-buddy-electron-'))
process.env.MOSS_HOME=root;process.env.MOSS_CONFIG_DIR=root
app.setPath('userData',path.join(root,'electron'))
app.on('window-all-closed',()=>{})
const output=fileURLToPath(new URL('../../output/buddy-tests/',import.meta.url))
const packageRoot=process.env.MOSS_BUDDY_PACKAGE||fileURLToPath(new URL('../../../moss-apps/artifacts/moss.buddy/0.1.2/package/',import.meta.url))
let runtime,window,db
const timeout=setTimeout(()=>{console.error('Buddy integration timed out');app.exit(1)},55000)
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(read,predicate){for(let i=0;i<150;i++){const value=await read();if(predicate(value))return value;await wait(100)}throw new Error(`Timed out: ${JSON.stringify(await read())}`)}
try{
 const {createAppRuntime}=await import('../src/apps/app-runtime.mjs')
 const {registerAppUiRequests}=await import('../src/apps/app-ui-requests.mjs')
 const {createAgentChannelStore}=await import('../../packages/app-runtime/src/agent-channel/store.mjs')
 const {createAgentChannelController}=await import('../../packages/app-runtime/src/agent-channel/controller.mjs')
 const {AGENT_HOST_METHODS}=await import('../../packages/app-sdk/src/agent/index.mjs')
 const {createAgentProtocolDefinition}=await import('../../packages/app-runtime/src/agent/index.mjs')
 const {contractDefinition}=await import('../../packages/app-sdk/src/host/contracts.mjs')
 const {createMossSettingsService}=await import('../src/moss-settings-service.mjs')
 const {createMossSettingsAdapters}=await import('../src/moss-settings-adapters.mjs')
 const {createDesktopSettingsStore}=await import('../src/desktop-settings.mjs')
 const {defaultInstanceId}=await import('../../packages/app-runtime/src/state/index.mjs')
 const {createDesktopStateStore}=await import('../src/desktop-state-store.mjs')
 const {createAppNotificationBroker}=await import('../src/app-notification-broker.mjs')
 db=new DatabaseSync(':memory:');createDesktopStateStore(db)
 const notifications=createAppNotificationBroker(db);notifications.create({source:'test',title:'任务已完成',message:'可以查看处理结果',severity:'info'},{id:'notice'})
 const settingsPath=path.join(root,'settings.json'),desktop=createDesktopSettingsStore({settingsPath})
 const adapters=createMossSettingsAdapters({getDesktop:()=>desktop.value,applyDesktop:next=>desktop.save({...desktop.value,...next}),defaultWorkspace:root,getTargets:async()=>[],getAssistants:async()=>[]})
 delete adapters.agent;delete adapters.preferences
 const configuration=createMossSettingsService({adapters,receiptsPath:path.join(root,'receipts.json'),confirm:async()=>true})
 const sessions=new Map(),prompts=[]
 const controller=createAgentChannelController({store:createAgentChannelStore(db),
  catalog:async()=>({agents:[],tools:[],skills:[],connectors:[]}),
  listWritableSessions:()=>[...sessions.values()],getWritableSession:id=>sessions.get(id),
  createSession:async()=>{const session={id:`session-${sessions.size}`,title:'Buddy',updatedAt:Date.now(),busy:false,messageCount:0};sessions.set(session.id,session);return session},
  sendPrompt:async(id,prompt)=>{
   prompts.push({id,prompt})
   if(prompt.includes('切换深色')){
    const before=await runtime.invokeToolContribution('moss.buddy/settings_read',{domain:'desktop',operation:'read'})
    await runtime.invokeToolContribution('moss.buddy/settings_apply',{domain:'desktop',revision:before.revision,requestId:'from-chat',changes:[{path:'appearance.themeMode',value:'dark'}]})
    return {assistantText:'已切换深色，桌面设置已保存。'}
   }
   return {assistantText:'我在这里，愿意听你聊聊今天。'}
  },abortSession:async()=>{},publishEvent:event=>runtime.publishHostEvent(event.appId,event.instanceId,event.protocol,event.name,event.data,{eventId:event.eventId}),
 })
 const node=process.env.MOSS_TEST_NODE||(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,'node')).find(existsSync)
 runtime=await createAppRuntime({mossHome:root,appsDir:path.join(root,'apps'),nodeExecutable:node,
  hostProtocols:[createAgentProtocolDefinition(),contractDefinition('moss.settings/v1'),contractDefinition('moss.notifications/v1')],
  hostHandlers:{'moss.agent/v1':Object.fromEntries(AGENT_HOST_METHODS.map(method=>[method,(input,context)=>controller.handleAgentRequest(method,input,context)])),
   'moss.settings/v1':Object.fromEntries(['read','catalog','apply','undo'].map(method=>[method,(input,context)=>configuration.handle(method,input,context)])),
   'moss.notifications/v1':{list:()=>({notifications:notifications.list()}),'mark-read':input=>({notifications:notifications.markRead(input.id)})}},
  onEvent:event=>{if(event.type==='backend-event'&&window&&!window.isDestroyed())window.webContents.send(`app-ui:event:${event.name}`,event.data)},
 })
 await runtime.installFromDirectory(packageRoot)
 const manifest=JSON.parse(await fs.readFile(path.join(packageRoot,'app.moss.json'),'utf8'))
 await runtime.setAppGrants('moss.buddy',manifest.permissions)
 await app.whenReady()
 let themeMode='light'
 ipcMain.handle('app-ui:get-info',()=>({id:'moss.buddy',appearance:{themeMode}}))
 registerAppUiRequests({ipc:ipcMain,getState:()=>({id:'moss.buddy',runtime})})
 window=new BrowserWindow({show:false,width:620,height:850,webPreferences:{preload:fileURLToPath(new URL('../src/apps/app-preload.mjs',import.meta.url)),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
 const errors=[];window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
 const evaluate=script=>window.webContents.executeJavaScript(script)
 await window.loadFile(path.join(packageRoot,'dist/ui/index.html'))
 await until(()=>evaluate('document.querySelector("#notice").hidden'),v=>v===true)
 await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'egg.png'),(await window.webContents.capturePage()).toPNG())
 await evaluate('document.querySelector("#hatch-form").requestSubmit(document.querySelector(".b-hatch"))')
 await until(()=>evaluate('document.querySelector(".buddy-product").classList.contains("hatched")'),Boolean)
 await evaluate('document.querySelector("#chat-input").value="你好";document.querySelector("#chat-form").requestSubmit()')
 await until(()=>evaluate('document.querySelector("#messages").textContent'),s=>s.includes('愿意听你'))
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".buddy-product")).borderTopWidth'),'0px')
 assert.ok(await evaluate('document.querySelector(".b-pet-header").getBoundingClientRect().height <= 48'))
 assert.equal(await evaluate('document.querySelector("#birthday").getBoundingClientRect().height'),0)
 assert.equal(prompts.length,1);assert.ok(prompts[0].prompt.includes('小苔'))
 await wait(100)
 await fs.writeFile(path.join(output,'chat-light.png'),(await window.webContents.capturePage()).toPNG())
 await evaluate('document.querySelector("#chat-input").value="切换深色";document.querySelector("#chat-form").requestSubmit()')
 await until(()=>evaluate('document.querySelector("#messages").textContent'),s=>s.includes('已切换深色'))
 assert.equal(JSON.parse(await fs.readFile(settingsPath,'utf8')).appearance.themeMode,'dark')
 assert.equal(prompts[0].id,prompts[1].id);assert.equal(prompts[1].prompt,'切换深色')
 themeMode='dark';window.webContents.send('app-ui:event:appearance',{themeMode});await wait(100)
 await fs.writeFile(path.join(output,'chat-dark.png'),(await window.webContents.capturePage()).toPNG())
 await evaluate('document.querySelector("#pet-settings").open=true')
 await until(()=>evaluate('document.querySelector("#responder").options.length'),n=>n>=1)
 await evaluate('document.querySelector("#edit-skin").value="robot";document.querySelector("#edit-skin").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#preferences-form").requestSubmit()')
 await until(()=>evaluate('document.querySelector(".buddy-product").dataset.skin'),v=>v==='robot')
 await evaluate('document.querySelector("#pet-settings").open=false');await wait(50)
 window.setSize(360,760);await wait(100)
 assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true)
 await fs.writeFile(path.join(output,'chat-narrow.png'),(await window.webContents.capturePage()).toPNG())
 await evaluate('document.querySelector("[data-page=notifications]").click()')
 await until(()=>evaluate('document.querySelector("#notifications").textContent'),s=>s.includes('任务已完成'))
 await evaluate('document.querySelector("#notifications button").click()');await until(()=>notifications.list()[0].read,Boolean)
 await evaluate('document.querySelector("[data-page=help]").click()');await until(()=>evaluate('document.querySelectorAll("#articles article").length'),n=>n>0)
 await evaluate('document.querySelector("[data-page=configuration]").click()');await until(()=>evaluate('document.querySelectorAll("#settings-list .b-config-section").length'),n=>n===2)
 await until(()=>evaluate(`Boolean(document.querySelector('#settings-list select[aria-label="桌面主题"]'))`),Boolean)
 assert.equal(await evaluate('document.querySelector("#page-configuration").textContent.includes("配置领域")'),false)
 await evaluate(`const picker=document.querySelector('#settings-list select[aria-label="桌面主题"]');picker.value="light";picker.dispatchEvent(new Event("change"))`)
 await until(()=>desktop.value.appearance.themeMode,v=>v==='light')
 await until(()=>evaluate('document.querySelector("#undo-config").hidden'),v=>v===false)
 await evaluate('document.querySelector("#undo-config").click()');await until(()=>desktop.value.appearance.themeMode,v=>v==='dark')
 window.setSize(700,850);await wait(150)
 await fs.writeFile(path.join(output,'settings-readable.png'),(await window.webContents.capturePage()).toPNG())
 await evaluate('document.querySelector("[data-page=pet]").click();location.hash="/companion?expanded=0"')
 window.setContentSize(56,56);await wait(150)
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#chat-form")).display'),'none')
 assert.equal(await evaluate('document.documentElement.scrollWidth <= 56 && document.documentElement.scrollHeight <= 56'),true)
 await fs.writeFile(path.join(output,'widget.png'),(await window.webContents.capturePage()).toPNG())
 assert.deepEqual(errors,[])
 const state=await runtime.invoke('moss.buddy',defaultInstanceId('moss.buddy'),'pet.get',{})
 assert.equal(state.pet.skin,'robot');assert.equal(state.messages.filter(m=>m.role==='assistant').length,2)
 await runtime.setAppGrants('moss.buddy',manifest.permissions.filter(p=>p!=='settings:read'))
 await assert.rejects(()=>runtime.invoke('moss.buddy',defaultInstanceId('moss.buddy'),'settings_read',{operation:'read',domain:'desktop'}))
 console.log(JSON.stringify({ok:true,checks:['hatch','real backend/channel transport','conversation continuity','configuration tool apply','skin persistence','notifications','handbook','light/dark/narrow/widget','grant enforcement'],output}))
}catch(error){console.error(error);if(window&&!window.isDestroyed()){console.error(await window.webContents.executeJavaScript('document.querySelector("#notice")?.textContent').catch(()=>''));await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'failure.png'),(await window.webContents.capturePage()).toPNG())}process.exitCode=1}
finally{clearTimeout(timeout);window?.destroy();await runtime?.shutdown();db?.close();await fs.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100}).catch(()=>{});app.exit(process.exitCode||0)}

}
void run().catch(error=>{console.error(error);app.exit(1)})
