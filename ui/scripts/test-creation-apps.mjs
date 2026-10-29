import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'
const ui=fileURLToPath(new URL('..',import.meta.url)),apps=path.resolve(ui,'../../moss-apps'),output=path.resolve(ui,'../output/creation-apps')
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'moss-six-builtins-'))
process.env.MOSS_HOME=process.env.MOSS_CONFIG_DIR=path.join(temp,'host')
const {AppRuntimeHost}=await import('../../packages/app-runtime/src/host/index.mjs')
const {BuiltinApps}=await import('../src/apps/builtin-apps.mjs')
const {createAppArtifactUrls,createAppArtifactProtocolDefinition}=await import('../src/apps/app-artifacts.mjs')
const {createLocalFilesProtocolDefinition,createLocalAppHostHandlers}=await import('../src/apps/app-local-host.mjs')
const {resolveAppResourceFile}=await import('../src/apps/app-resources.mjs')
const {resolveAppSkills}=await import('../src/apps/app-skills.mjs')
const {createWorkspaceFileService}=await import('../src/workspace-files.mjs')
const {registerFileSystemIpcHandlers}=await import('../src/file-system-ipc.mjs')
const {registerAppRuntimeIpc}=await import('../src/apps/app-runtime-ipc.mjs')
const {createPresentationService}=await import('../src/presentation/presentation-service.mjs')
const {createPresentationResolver}=await import('../src/presentation/resource-resolver.mjs')
const {prepareVisualizationAnnotation}=await import('../src/apps/visualization-annotations.mjs')
const modulePath=process.env.PLAYWRIGHT_MODULE||path.join(apps,'node_modules/.bun',(await fs.readdir(path.join(apps,'node_modules/.bun'))).filter(n=>n.startsWith('playwright@')).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))[0],'node_modules/playwright/index.mjs')
const {chromium}=await import(pathToFileURL(modulePath))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),checks=[],errors=[],annotations=[]
const mark=text=>{checks.push(text);console.log('PASS',text)}
async function until(fn,label){const end=Date.now()+90000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150))}throw new Error('Timed out: '+label)}
let host,urls,browser,server,page,detailsPage,cdp
const cdpChecks=[]
async function protocolClick(locator){await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();assert.ok(box);const x=box.x+box.width/2,y=box.y+box.height/2;await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
try {
 await fs.mkdir(output,{recursive:true});await fs.rm(path.join(output,'exports'),{recursive:true,force:true});await fs.mkdir(path.join(output,'exports'),{recursive:true})
 urls=createAppArtifactUrls()
 host=new AppRuntimeHost({rootDir:process.env.MOSS_HOME,requireTrustedPublisher:false,nodeExecutable:process.execPath,hostCapabilityOptions:{protocols:[createLocalFilesProtocolDefinition(),createAppArtifactProtocolDefinition()]}})
 host.registerHostHandler('moss.artifacts/v1','url.get',(input,context)=>urls.url(input,context))
 const handlers=createLocalAppHostHandlers({dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[path.join(output,'exports')]})}})
 host.registerHostHandler('moss.local-files/v1','pick',handlers['moss.local-files/v1'].pick)
 await host.initialize()
 const installed=new Map(),revisions=new Map(),builtins=await new BuiltinApps({directory:path.join(ui,'dist/builtin-apps'),statePath:path.join(temp,'receipts.json'),runtime:host,getInstalled:id=>installed.get(id),getRevision:id=>revisions.get(id)||0,
 installPackage:async root=>{const state=await host.installFromDirectory(root);installed.set(state.manifest.id,state);revisions.set(state.manifest.id,1)}}).initialize()
 const sync=await builtins.sync();assert.equal(sync.length,7);assert.ok(sync.every(s=>s.installed&&!s.error),JSON.stringify(sync));await builtins.sync();assert.ok([...revisions.values()].every(n=>n===1))
 const allGlobals=await host.listContributions({kinds:['tools'],selectedAppIds:[],loadSchemas:true}),allSkills=await resolveAppSkills(host,[]);const globals={...allGlobals,tools:allGlobals.tools.filter(t=>t.appId!=='moss.app-builder')},skills={...allSkills,skills:allSkills.skills.filter(t=>t.appId!=='moss.app-builder')}
 assert.ok(skills.skills.length>=6);assert.ok(globals.tools.every(t=>t.toolLoading==='always'),JSON.stringify(globals.tools.map(t=>({name:t.name,appId:t.appId,loading:t.toolLoading}))));assert.equal(new Set(globals.tools.map(t=>t.name)).size,globals.tools.length);assert.ok(globals.tools.every(t=>!t.name.startsWith('app_')))
 for(const {id} of sync.filter(item=>item.id!=='moss.app-builder')){const state=await host.getApp(id);assert.equal(state.manifest.navigation.location,'none');assert.equal(state.manifest.ui,undefined)}
 mark(`seven real ZIPs auto-install once; six creation Apps expose ${globals.tools.length} unique global native tools and six skills available without selection`)
 const invoke=async(id,action,input={})=>host.invoke(id,(await host.ensureDefaultInstance(id)).id,action,input)
 const create=async(id,input)=>{const tool=globals.tools.find(t=>t.appId===id&&t.action==='tasks.start');assert.ok(tool,id+' start tool');const queued=await host.invokeContribution('tools',tool.id,input);const task=await until(async()=>{const t=await invoke(id,'tasks.get',{id:queued.id});return ['succeeded','failed','canceled'].includes(t.status)&&t},id);assert.equal(task.status,'succeeded',task.message);return task}
 const examples=[]
 const visual=await create('moss.visualize',{title:'任务进度',mode:'html',html:'<h1>项目进度</h1><p>已完成 80%</p>'});examples.push(['moss.visualize',visual,'h1'])
 const doc=await create('moss.document',{title:'项目周报',mode:'author',to:'docx',content:'# 本周成果\n\n完成创作能力改造。\n\n|项目|状态|\n|---|---|\n|主会话创作|完成|\n|结果预览|完成|'});examples.push(['moss.document',doc,'h1'])
 const docPath=doc.artifacts.find(a=>a.path.endsWith('.docx')).path
 const review=await create('moss.document',{title:'周报修订',mode:'review',sourcePath:docPath,parentId:doc.id,edits:[{find:'完成创作能力改造。',replace:'完成六个创作 App 的适配。'}],comments:[{find:'本周成果',text:'请补充验证结果'}]});assert.equal(review.result.version,2)
 const documentPdf=await create('moss.document',{title:'排版报告',mode:'author',to:'pdf',content:'# 排版报告\n\n中文字体和文档排版验证。'});const docPdfFile=documentPdf.artifacts.find(a=>a.path.endsWith('.pdf'));assert.ok(docPdfFile);assert.equal((await fs.readFile(docPdfFile.path)).subarray(0,5).toString(),'%PDF-');await invoke('moss.document','artifacts.export',{id:documentPdf.id,index:documentPdf.artifacts.indexOf(docPdfFile)})
 const pdf=await create('moss.pdf',{title:'项目报告',options:{mode:'create',content:'项目报告\n\n主会话创作已完成。\n本次共接入六个内置 App。'}})
 const pdfFile=await resolveAppResourceFile(host,pdf.result.resourceUri);assert.ok((await fs.readFile(pdfFile.path)).subarray(0,5).equals(Buffer.from('%PDF-')))
 const pdfPages=pdf.result.files.filter(f=>f.kind==='image');assert.equal(pdfPages.length,1)
 const form=await invoke('moss.pdf','resources.resolve',{intent:'edit',ref:{fileId:pdf.result.files.find(f=>f.kind==='pdf').id}});assert.ok(form.prompt.includes('PDF'))
 const sheets=await create('moss.spreadsheets',{title:'季度预算',sheets:[{name:'预算',rows:[['项目','金额'],['收入',120000],['支出',78000],['结余',{formula:'B2-B3',numFmt:'#,##0'}]],charts:[{type:'bar',title:'收入与支出',labels:'A2:A3',series:[{name:'金额',range:'B2:B3'}]}]},{name:'说明',rows:[['说明'],['结余由公式自动计算']]}]});examples.push(['moss.spreadsheets',sheets,'h1'])
 const sheetSource=sheets.artifacts[0].path,originalSheet=hash(await fs.readFile(sheetSource)),revised=await create('moss.spreadsheets',{title:'预算第二版',mode:'edit',parentId:sheets.id,sourcePath:sheetSource,edits:[{sheet:'预算',cell:'B3',value:70000}]});assert.equal(revised.result.version,2);assert.equal(hash(await fs.readFile(sheetSource)),originalSheet)
 const slides=await create('moss.presentations',{title:'季度汇报',slides:[{title:'本季度业务结果',elements:[{type:'chart',chartType:'bar',x:.6,y:1.6,w:7,h:4.7,series:[{name:'利润',labels:['一月','二月','三月'],values:[-10,20,35]}]},{type:'table',x:8,y:1.6,w:4.5,h:2.4,rows:[['项目','金额'],['收入','12 万'],['结余','4.2 万']]}],notes:'数据来自预算表'},{title:'下一步计划',body:'优化协作流程\n持续核对实际数据'}]});examples.push(['moss.presentations',slides,'#page'])
 const template=await create('moss.templates',{title:'项目周报模板',content:'# {{标题}}\n\n{{正文}}',instructions:'保留标题和简短进展段落'});examples.push(['moss.templates',template,'h1'])
 const applied=await create('moss.templates',{title:'本周周报',mode:'use',templateId:template.id,values:{标题:'本周工作',正文:'完成主会话创作适配。'}})
 const finalDoc=await create('moss.document',{title:'模板生成周报',mode:'author',to:'docx',content:await fs.readFile(applied.result.referencePath,'utf8')});assert.ok(finalDoc.artifacts.some(a=>a.path.endsWith('.docx')))
 const typedTemplate=await create('moss.templates',{title:'预算参考模板',sourcePath:sheetSource,instructions:'保留公式与图表，替换支出金额'})
 const handoff=await create('moss.templates',{title:'新预算',mode:'use',templateId:typedTemplate.id});assert.equal(handoff.result.nextApp,'moss.spreadsheets')
 await create('moss.spreadsheets',{title:'从模板生成预算',mode:'edit',sourcePath:handoff.result.referencePath,edits:[{sheet:'预算',cell:'B3',value:50000}]})
 for(const [id,task]of examples){const resource=await resolveAppResourceFile(host,task.result.resourceUri);assert.equal(resource.path,await fs.realpath(task.artifacts[task.result.previewIndex??0].path));const exported=await invoke(id,'artifacts.export',{id:task.id,index:0});assert.equal(hash(await fs.readFile(exported.path)),hash(await fs.readFile(task.artifacts[0].path)))}
 await invoke('moss.pdf','files.export',{ids:[pdf.result.files.find(f=>f.kind==='pdf').id]})
 mark('native tools create DOCX/revisions, Chinese PDF/pages, formula XLSX/charts, editable PPTX and templates; export and template handoff succeed')
 const resolveResourceFile=(uri,record)=>resolveAppResourceFile(host,uri,record),readWorkspaceFile=createWorkspaceFileService({allowMediaRoot:()=>{}}).readWorkspaceFile,session={id:'visualization-session',agentMode:'local',workspace:temp,appIds:[]},callbacks=new Map(),detailHandlers=new Map()
 registerFileSystemIpcHandlers({ipcMain:{handle:(n,fn)=>callbacks.set(n,fn)},uiRoot:ui,getSessionRecord:id=>id===session.id?session:null,readWorkspaceFile,resolveResourceFile})
 registerAppRuntimeIpc({ipcMain:{handle:(n,fn)=>detailHandlers.set(n,fn)},getRuntime:()=>host})
 const service=createPresentationService({storageRoot:path.join(temp,'presentations'),waitMs:0,getSessionRecord:id=>id===session.id?session:null,...createPresentationResolver({readWorkspaceFile,resolveResourceFile}),emit:(name,value)=>{if(page&&!page.isClosed())void page.evaluate(([n,v])=>window.visualizationEvent?.(n,v),[name,value]).catch(e=>errors.push(String(e)))}})
 server=await createServer({root:ui,configFile:path.join(ui,'vite.config.ts'),cacheDir:path.join(temp,'vite'),server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false},logLevel:'error'});await server.listen()
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));cdp=await page.context().newCDPSession(page);await cdp.send('Runtime.enable');await cdp.send('Page.enable');await cdp.send('Log.enable');cdp.on('Runtime.exceptionThrown',event=>errors.push(event.exceptionDetails.exception?.description||event.exceptionDetails.text))
 await page.exposeFunction('visualizationRpc',async(method,input)=>{switch(method){case 'snapshot':return service.snapshot(input.sessionId,{activate:input.activate});case 'load':return service.load(input.sessionId,input.artifactId);case 'open':return service.present(input.sessionId,input.input,{origin:'manual'});case 'action':return service.action(input.sessionId,input.action);case 'refresh':return service.refresh(input.sessionId);case 'acknowledge':return service.acknowledge(input.sessionId,input);case 'readFile':return callbacks.get('preview:read-file')({},input);case 'annotation':{const a=await prepareVisualizationAnnotation(input.annotation,{resolveResourceFile,session});annotations.push(a);return a}default:throw new Error(method)}})
 const base=`http://127.0.0.1:${server.httpServer.address().port}`
 await page.goto(base+'/tests/fixtures/creation-apps.html');await page.waitForFunction(()=>window.fixtureReady)
 const right=page.getByTestId('right-panel'),rightFrame=()=>right.frameLocator('iframe'),inlineFrame=()=>page.locator('[data-inline-visualization]').frameLocator('iframe')
 for(const [id,task,selector]of examples.filter(([,task])=>task.artifacts[task.result.previewIndex??0].kind==='html')){
  await service.beginTurn(session.id,id);await service.present(session.id,task.result.presentation,{turnId:id});await page.evaluate(md=>window.setVisualizationMarkdown(md),task.result.displayMarkdown)
  await rightFrame().locator(selector).first().waitFor();await inlineFrame().locator(selector).first().waitFor()
  assert.equal(await right.getByRole('button',{name:/重新载入|继续修改/}).count(),0)
  await page.screenshot({path:path.join(output,id+'-conversation.png'),fullPage:true})
  // Sandboxed srcdoc documents may be OOPIFs and absent from the parent's frame tree.
  // Inspect each real document through its own CDP target.
  const frameChecks=[]
  for(const [surface,iframe]of [['inline',page.locator('[data-inline-visualization] iframe')],['right',right.locator('iframe')]]){
   const frame=await(await iframe.elementHandle()).contentFrame();assert.ok(frame)
   const frameCdp=await page.context().newCDPSession(frame)
   try{const tree=await frameCdp.send('Page.getFrameTree');const {result}=await frameCdp.send('Runtime.evaluate',{expression:JSON.stringify(selector)+" && JSON.stringify({matches:document.querySelectorAll("+JSON.stringify(selector)+").length,text:document.body.innerText.slice(0,160),width:innerWidth,height:innerHeight,origin:globalThis.origin})",returnByValue:true});const document=JSON.parse(result.value);assert.ok(document.matches>0);assert.ok(document.width>0&&document.height>0);assert.equal(document.origin,'null');frameChecks.push({surface,frameId:tree.frameTree.frame.id,document})}finally{await frameCdp.detach()}
  }
  const metrics=await cdp.send('Page.getLayoutMetrics');assert.ok(metrics.cssContentSize.width<=1440)
  const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(output,id+'-cdp.png'),Buffer.from(shot.data,'base64'))
  cdpChecks.push({appId:id,frames:frameChecks,viewport:metrics.cssVisualViewport,method:'CDP sessions for both sandbox frames; Runtime.evaluate, Page.getFrameTree/getLayoutMetrics/captureScreenshot'})
  await page.evaluate(()=>{document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark'});await until(async()=>await rightFrame().locator('html').evaluate(e=>e.style.colorScheme)==='dark','dark theme');await page.screenshot({path:path.join(output,id+'-dark.png'),fullPage:true});await page.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light'})
  await page.setViewportSize({width:390,height:900});await right.scrollIntoViewIfNeeded();await rightFrame().locator(selector).first().waitFor();assert.ok(await rightFrame().locator('html').evaluate(e=>e.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,id+'-narrow.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000})
 }
 await protocolClick(right.getByRole('button',{name:'标注修改',exact:true}));await until(async()=>await rightFrame().locator('html').getAttribute('data-moss-annotating')==='element','annotation mode reached sandbox');await protocolClick(rightFrame().locator('h1'));await right.getByRole('textbox',{name:'标注内容'}).fill('把模板标题改得更简洁');await protocolClick(right.getByRole('button',{name:'发送标注'}));await until(()=>annotations.length===1,'template annotation');assert.ok(annotations[0].instruction.includes(template.result.resourceUri))
 await page.reload();await page.waitForFunction(()=>window.fixtureReady);await page.evaluate(md=>window.setVisualizationMarkdown(md),template.result.displayMarkdown);await page.locator('[data-inline-visualization]').getByRole('button',{name:'在右侧展开'}).click();await rightFrame().locator('h1').waitFor();assert.equal(await rightFrame().locator('h1').innerText(),'项目周报模板')
 await page.evaluate(()=>{document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark'});await page.screenshot({path:path.join(output,'template-dark.png'),fullPage:true})
 mark('Interactive HTML providers render in conversation/right-panel components, annotate and reopen; narrow layout verified. Native Office UI is covered by test:office-preview')
 const snapshot=await cdp.send('DOMSnapshot.captureSnapshot',{computedStyles:['display','visibility','overflow']});await fs.writeFile(path.join(output,'cdp-dom-snapshot.json'),JSON.stringify(snapshot));mark('raw CDP frame/layout/screenshot checks for interactive providers; native pointer events submit anchored annotations; dark themes verified without Runtime exceptions');
 const pdfResolved=await createPresentationResolver({readWorkspaceFile,resolveResourceFile}).resolveItem(session,pdf.result.presentation.items[0]);assert.equal(pdfResolved.owner.providerId,'moss.pdf')
 const pdfPage=await resolveResourceFile(pdfPages[0].resourceUri),imagePage=await browser.newPage();await imagePage.goto(pathToFileURL(pdfPage.path).href);await imagePage.screenshot({path:path.join(output,'pdf-rendered-page.png'),fullPage:true});await imagePage.close()
 let selected='moss.visualize';detailsPage=await browser.newPage({viewport:{width:1360,height:1000}});detailsPage.on('pageerror',e=>errors.push(e.message))
 await detailsPage.exposeFunction('detailsRpc',async(method,input)=>{if(method!=='catalog')return detailHandlers.get(method)?.({},input);const state=await host.getApp(selected),m=state.manifest;return {...m,name:m.id,title:m.displayName,currentVersion:m.version,hasUi:false,hasBackend:true,builtin:true,enabled:state.installation.enabled,grants:state.installation.grants,declaredSkills:m.contributes.skills,agentTools:m.contributes.tools,instances:state.instances,toolScope:state.toolScope,toolLoading:state.toolLoading}})
 for(const {id}of sync.filter(item=>item.id!=='moss.app-builder')){selected=id;await detailsPage.goto(base+'/tests/fixtures/app-details.html');const m=(await host.getApp(id)).manifest;await detailsPage.getByRole('button',{name:'打开 '+m.displayName,exact:true}).click();await detailsPage.locator(`[data-app-details="${id}"]`).waitFor();assert.equal(await detailsPage.getByRole('combobox',{name:'工具使用范围'}).inputValue(),'global-always');await detailsPage.getByRole('region',{name:'技能',exact:true}).getByRole('button').first().click();await detailsPage.locator('aside pre').waitFor();await detailsPage.screenshot({path:path.join(output,id+'-details.png'),fullPage:true})}
 mark('all six Apps open shared details from Common with global settings, native tools, resources and packaged skill preview')
 assert.deepEqual(errors,[])
 const staged=JSON.parse(await fs.readFile(path.join(ui,'dist/builtin-apps/manifest.json'),'utf8'))
 await fs.writeFile(path.join(output,'validation.json'),JSON.stringify({ok:true,checks,cdpChecks,apps:staged.apps,tools:globals.tools.map(t=>({appId:t.appId,name:t.name})),scope:'Real packaged backends and native tools; real React components and presentation services in a browser. Transport/session shell are fixtures; PDF page inspected from actual renderer, not a full desktop or live-model session.'},null,2))
 await fs.rm(path.join(output,'failure.json'),{force:true});await fs.rm(path.join(output,'failure.png'),{force:true});console.log('Verified:',output)
}catch(error){await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),checks,errors},null,2));throw error}
finally{await browser?.close();await server?.close();await host?.shutdown();await urls?.close();await fs.rm(temp,{recursive:true,force:true})}
