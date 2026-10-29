// Real isolated desktop, packaged App tools, native Office rendering and main-chat annotations.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { launchTestInstance } from '../src/app-testing/instance.mjs'
import { resizeDesktopWindow, assertComposerVisible } from './helpers/desktop-viewport.mjs'

const ui=fileURLToPath(new URL('..',import.meta.url)),core=path.dirname(ui),output=path.join(core,process.argv.includes('--workflow')?'output/office-workflow-cdp':'output/office-preview-cdp')
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'moss-office-cdp-')),home=path.join(directory,'profile'),id=randomUUID()
const modules=path.resolve(core,'../moss-apps/node_modules/.bun'),version=(await fs.readdir(modules)).filter(n=>n.startsWith('playwright@')).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))[0]
const {chromium}=await import(pathToFileURL(path.join(modules,version,'node_modules/playwright/index.mjs')))
const run=promisify(execFile),checks=[],errors=[],requests=[]
const mark=text=>{checks.push(text);console.log('PASS',text)}
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex')
let fixtureReply='已收到标注，将按指定页面调整。',fixtureToolCalls=[],releaseFixture
const server=createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  if (!chunks.length) { res.statusCode=204; res.end(); return }
  const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body)
  if (releaseFixture) await releaseFixture.promise
  const content=fixtureReply
  if(!body.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'aux',type:'message',role:'assistant',model:body.model,content:[{type:'text',text:content}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}));return}
  const call=body.tools?.some(tool=>tool.name===fixtureToolCalls[0]?.name)?fixtureToolCalls.shift():null
  const events=[{type:'message_start',message:{id:randomUUID(),type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}},
  {type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:content}},
  {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:20}},{type:'message_stop'}]
  if(call){events.splice(1,3,{type:'content_block_start',index:0,content_block:{type:'tool_use',id:randomUUID(),name:call.name,input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(call.input)}},{type:'content_block_stop',index:0});events[4].delta.stop_reason='tool_use'}
  res.setHeader('Content-Type','text/event-stream');res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''))
 }catch(error){errors.push(String(error));res.statusCode=500;res.end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let target,browser,page,cdp,sessionId,host,artifactUrls,geometry
const composerChecks=[]
async function until(fn,label,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150))}throw new Error('Timed out: '+label)}
const capture=async name=>{const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(output,name+'.png'),Buffer.from(shot.data,'base64'))}
try{
 await fs.mkdir(output,{recursive:true})
 process.env.MOSS_HOME=process.env.MOSS_CONFIG_DIR=home
 const {AppRuntimeHost}=await import('../../packages/app-runtime/src/host/index.mjs')
 const {BuiltinApps}=await import('../src/apps/builtin-apps.mjs')
 const {createAppArtifactUrls,createAppArtifactProtocolDefinition}=await import('../src/apps/app-artifacts.mjs')
 artifactUrls=createAppArtifactUrls()
 host=new AppRuntimeHost({rootDir:home,requireTrustedPublisher:false,nodeExecutable:process.execPath,hostCapabilityOptions:{protocols:[createAppArtifactProtocolDefinition()]}})
 host.registerHostHandler('moss.artifacts/v1','url.get',(input,context)=>artifactUrls.url(input,context))
 await host.initialize()
 const installedPackages=new Map(),revisions=new Map()
 const builtin=await new BuiltinApps({directory:path.join(ui,'dist/builtin-apps'),statePath:path.join(home,'builtin-test-receipts.json'),runtime:host,getInstalled:id=>installedPackages.get(id),getRevision:id=>revisions.get(id)||0,
 installPackage:async root=>{const state=await host.installFromDirectory(root);installedPackages.set(state.manifest.id,state);revisions.set(state.manifest.id,1)}}).initialize()
 // Limit this isolated profile to creation Apps; large browser/desktop runtimes
 // are unrelated to Office acceptance and need not be unpacked here.
 const bundledEntries=builtin.manifest.apps;
 builtin.manifest.apps=bundledEntries.filter(app=>['moss.document','moss.pdf','moss.spreadsheets','moss.presentations','moss.templates','moss.visualize'].includes(app.id));
 const sync=await builtin.sync();assert.ok(sync.every(s=>!s.error),JSON.stringify(sync));
 await fs.writeFile(path.join(home,'builtin-apps.json'),JSON.stringify({version:1,seen:Object.fromEntries(bundledEntries.map(app=>[app.id,app.version]))}));
 const contributions=await host.listContributions({kinds:['tools'],selectedAppIds:[]})
 const invoke=async(name,input)=>{const tool=contributions.tools.find(t=>t.name===name||t.id.endsWith(':'+name));assert.ok(tool,'missing '+name);return host.invokeContribution('tools',tool.id,input)}
 const create=async(prefix,input)=>{const queued=await invoke(prefix+'_create',input);const task=await until(async()=>{const task=await invoke(prefix+'_status',{id:queued.id});return ['succeeded','failed','canceled'].includes(task.status)&&task},prefix+' generation',150000);assert.equal(task.status,'succeeded',task.message);return task}
 const docs=await create('document',{title:'项目周报',mode:'author',to:'docx',content:'# 项目周报\n\n## 本周成果\n\n完成 Office 页面预览改造，核对真实文件中的文字、表格和分页。\n\n|项目|状态|\n|---|---|\n|文档与幻灯片|完成|\n|页面标注|待验收|\n\n## 下一步\n\n逐页检查导出结果。'})
 const sheets=await create('spreadsheet',{title:'季度预算',sheets:[{name:'预算',rows:[['项目','金额'],['收入',120000],['支出',78000],['结余',{formula:'B2-B3',numFmt:'#,##0'}]],charts:[{type:'bar',title:'收入与支出',labels:'A2:A3',series:[{name:'金额',range:'B2:B3'}]}]},{name:'说明',rows:[['核验说明'],['公式结果应为 42,000']]}]})
 const slides=await create('presentation',{title:'季度业务复盘',slides:[{title:'本季度业务结果',body:'收入 120,000 元\n结余 42,000 元',notes:'核对预算表'},{title:'增长趋势',elements:[{type:'chart',chartType:'bar',x:.7,y:1.5,w:7,h:4.5,series:[{name:'利润',labels:['一月','二月','三月'],values:[10,20,35]}]},{type:'table',x:8,y:1.6,w:4.4,h:2.4,rows:[['指标','结果'],['增长率','25%'],['完成度','90%']]}]},{title:'下一步计划',body:'提升交付质量\n持续核验真实结果'}]})
 let workflow
 if(process.argv.includes('--workflow')){
  const pptUnits=(await invoke('presentation_inspect',{id:slides.id,page:2})).units
  const chart=pptUnits.find(u=>u.detail.type==='chart'),table=pptUnits.find(u=>u.detail.type==='table'),title=pptUnits.find(u=>u.detail.type==='text')
  const changedSlides=await create('presentation',{title:'季度业务复盘 · 修订版',mode:'edit',sourcePath:slides.artifacts[0].path,parentId:slides.id,objectEdits:[{slide:2,objectId:chart.objectId,chartType:'line'},{slide:2,objectId:table.objectId,tableEdits:[{row:2,column:2,text:'28%'}]},{slide:2,objectId:title.objectId,fontSize:36}]})
  assert.equal(changedSlides.result.comparison.count,3)
  const sheetUnits=(await invoke('spreadsheet_inspect',{id:sheets.id,sheet:'预算',range:'B3'})).units
  const docUnits=(await invoke('document_inspect',{id:docs.id})).units
  const docRef=docUnits.find(u=>u.text.includes('完成 Office 页面预览改造'))
  const changedSheet=await create('spreadsheet',{title:'季度预算 · 修订版',mode:'edit',sourcePath:sheets.artifacts[0].path,parentId:sheets.id,edits:[{sheet:'预算',cell:'B3',value:80000}]})
  assert.equal(changedSheet.result.comparison.count,2)
  const review=await invoke('presentation_verify',{id:changedSlides.id});assert.equal(review.pages.length,3)
  const partial=await invoke('presentation_verify',{id:changedSlides.id,sourceSha256:review.sourceSha256,pages:[{page:1,observations:'CDP 测试夹具：检查核验状态持久化，非真实模型视觉结论',issues:[]}]})
  assert.equal(partial.quality.state,'pending');assert.equal(partial.quality.reviewedPages,1)
  const pdfTask=await create('pdf',{title:'付款约定',options:{mode:'create',content:'验收后三十日内付款。'}})
  const pdfRef=(await invoke('pdf_inspect',{id:pdfTask.id,page:1})).units[0]
  assert.match(pdfRef.text,/三十日/);assert.equal((await invoke('pdf_verify',{id:pdfTask.id})).pages.length,1)
  const issueSlides=await create('presentation',{title:'可定位的检查问题',slides:[{title:'检查样例',elements:[{type:'text',text:'这一段文字字号过小',x:1,y:2,w:8,h:1,fontSize:10}]}]})
  assert.equal(issueSlides.result.quality.checks[0].location.text,'这一段文字字号过小')
  const longDeck=await create('presentation',{title:'分批页面检查',slides:Array.from({length:12},(_,i)=>({title:`第 ${i+1} 页`,body:'大文件应先展示成果，再继续检查余下页面。'}))})
  assert.equal(longDeck.result.visualReview.pages.length,8);assert.equal(longDeck.result.rendering.nextPage,9)
  const batch=await invoke('presentation_verify',{id:longDeck.id}),continued=await invoke('presentation_verify',batch.nextRender)
  assert.equal(continued.pages.length,12);assert.equal(continued.renderStatus,'rendered');assert.equal(continued.quality.state,'pending')
  const pendingDeck=await create('presentation',{title:'首批页图已就绪',slides:Array.from({length:9},(_,i)=>({title:`第 ${i+1} 页`,body:'首批页面已经可以阅读，剩余页图按需继续生成。'}))})
  const {default:sharp}=await import('sharp'),green=path.join(directory,'green.png'),blue=path.join(directory,'blue.png')
  await sharp({create:{width:320,height:180,channels:3,background:'#228855'}}).png().toFile(green)
  await sharp({create:{width:320,height:180,channels:3,background:'#3355bb'}}).png().toFile(blue)
  const imageDeck=await create('presentation',{title:'图片修改前',slides:[{title:'品牌图片',elements:[{type:'image',path:green,x:1,y:2,w:6,h:3}]}]})
  const picture=(await invoke('presentation_inspect',{id:imageDeck.id})).units.find(u=>u.detail.type==='image')
  const changedImage=await create('presentation',{title:'图片修改后',mode:'edit',sourcePath:imageDeck.artifacts[0].path,parentId:imageDeck.id,objectEdits:[{slide:1,objectId:picture.objectId,imagePath:blue}]})
  assert.equal(changedImage.result.comparison.count,1)
  const originalWords=await create('document',{title:'对齐段落',mode:'author',to:'docx',content:'# 项目进度\n\n首段保留。\n\n交付日期为十月。\n\n末段保留。'})
  const changedWords=await create('document',{title:'对齐段落',mode:'author',to:'docx',parentId:originalWords.id,content:'# 项目进度\n\n首段保留。\n\n这里插入一段说明。\n\n交付日期为十一月。\n\n末段保留。'})
  assert.equal(changedWords.result.comparison.count,2)
  workflow={changedSlides,changedSheet,title,chart,table,sheetRef:sheetUnits[0],docRef,pdfRef,pdfTask,issueSlides,longDeck,pendingDeck,changedImage,changedWords}
  mark('Packaged tools align inserted Word paragraphs, extract distinct image revisions, locate check issues and resume page batches without marking them reviewed')
  for(const task of [changedSlides,changedSheet]){await fs.copyFile(task.artifacts[0].path,path.join(output,path.basename(task.artifacts[0].path)));for(const image of task.result.visualReview.pages)await fs.copyFile(image.path,path.join(output,task.result.title+'-'+image.page+'.png'))}
  mark('Packaged inspect/edit/verify tools produce precise references, editable native revisions and 3 object / 2 cell comparisons; partial review stays pending')
 }
 const templateDescription='仅在用户明确要求季度业务复盘模板时使用，保留三页结构和蓝色主题。'
 const templates=await create('template',{title:'季度业务复盘模板',skillName:'quarterly-review-template',skillDescription:templateDescription,sourcePath:slides.artifacts[0].path,instructions:'保留三页结构、原生图表和蓝色主题，用新季度数据替换。'})
 const changed=await create('template',{title:'季度模板第二版',mode:'update',templateId:templates.id,parentId:templates.id,instructions:'保留原结构，新增来源说明'})
 assert.equal(changed.result.template.skillDescription,templateDescription)
 assert.equal(changed.result.skillBundle.description,templateDescription)
 assert.ok((await fs.readFile(path.join(changed.result.skillBundle.path,'SKILL.md'),'utf8')).includes('description: '+JSON.stringify(templateDescription)))
 mark('Packaged template update preserves the custom skill trigger description in metadata and SKILL.md')
 for(const task of [docs,sheets,slides,templates]){
  assert.equal(task.result.previewIndex,0);assert.equal(task.result.visualReview.status,'rendered',task.result.visualReview.reason);assert.equal(task.result.visualReview.visuallyVerified,false)
  assert.equal(task.result.visualReview.pages.length,task.result.visualReview.pageCount)
  assert.equal(await hash(task.artifacts[0].path),task.result.visualReview.sourceSha256)
  for(const image of task.result.visualReview.pages){assert.ok((await fs.stat(image.path)).size>1000);await fs.copyFile(image.path,path.join(output,`${task.result.title}-page-${image.page}.png`))}
  await fs.copyFile(task.artifacts[0].path,path.join(output,path.basename(task.artifacts[0].path)))
 }
 mark('Packaged tools create editable Office originals, real PDFs and every page PNG; original hashes preserved and visual review not falsely claimed')
 await host.shutdown();host=null
 target=await launchTestInstance({run:{id,directory,home},executable:path.join(ui,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:[ui],cwd:ui,
 settings:{language:'chinese',agentMode:'local',model:'office-fixture',url:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'test-key',permissionMode:'bypassPermissions',appearance:{themeMode:'light'},autoMemory:{enabled:false,extractionEnabled:false},sessionMemory:{enabled:false}},prepareEnvironment:false,runtimeHome:path.join(core,'output/builtin-skills-cdp/runtime-cache'),signal:new AbortController().signal,timeoutMs:90000})
 browser=await chromium.connectOverCDP(target.endpoint);page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes(id));assert.ok(page);page.setDefaultTimeout(45000)
 cdp=await page.context().newCDPSession(page);await cdp.send('Runtime.enable');await cdp.send('Page.enable');cdp.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text))
 await page.getByRole('button',{name:'插件',exact:true}).first().waitFor()
 geometry=await resizeDesktopWindow(target,page,{width:1440,height:900})
 const resize=async size=>{geometry=await resizeDesktopWindow(target,page,size);composerChecks.push(await assertComposerVisible(page,geometry))}
 const workspace=path.join(home,'self-test-workspace')
 const created=await page.evaluate(workspace=>window.agentDesktop.createSession({title:'Office 页面预览验证',workspace,permissionMode:'bypassPermissions'}),workspace);sessionId=created.summary.id
 await page.reload();await page.getByText('Office 页面预览验证',{exact:true}).first().click()
 composerChecks.push(await assertComposerVisible(page,geometry))
 const pdf=()=>page.locator('[data-pdf-preview]').filter({visible:true})
 const open=async task=>{await page.evaluate(({sessionId,input})=>window.agentDesktop.presentation.open({sessionId,input}),{sessionId,input:task.result.presentation});await pdf().waitFor();await pdf().locator('canvas[data-painted="true"]').first().waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('[data-pdf-preview] canvas')].some(c=>c.dataset.painted==='true'&&c.width>0))}
 for(const task of [docs,sheets,slides]){await open(task);assert.equal(await pdf().locator('[data-pdf-page]').count(),task.result.visualReview.pageCount);await capture(task.result.title+'-preview');assert.equal(await page.getByText('继续修改',{exact:true}).count(),0)}
 mark('Main-session right pane immediately renders Word, Excel and PPT pages with no separate App UI')
 await open(docs)
 const textSpan=pdf().locator('[data-pdf-page="1"] .textLayer span').filter({hasText:'项目周报'}).first();await textSpan.waitFor();const textBox=await textSpan.boundingBox();assert.ok(textBox)
 await page.mouse.move(textBox.x+1,textBox.y+textBox.height/2);await page.mouse.down();await page.mouse.move(textBox.x+textBox.width-1,textBox.y+textBox.height/2,{steps:10});await page.mouse.up()
 await pdf().locator('[data-annotation-editor]').waitFor();await capture('text-selection-editor');await pdf().locator('[data-annotation-editor]').getByRole('button',{name:'取消',exact:true}).click()
 mark('Native PDF text layer supports actual pointer text selection and opens a contextual editor')
 await open(slides)

 await pdf().getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await pdf().getByRole('textbox',{name:'页码'}).inputValue(),'2')
 await pdf().getByRole('combobox',{name:'页面缩放'}).selectOption('1.25');await until(async()=>await pdf().locator('[data-pdf-page="2"] canvas[data-painted="true"]').count(),'zoom repaints')
 assert.ok(await pdf().locator('[data-pdf-page="2"]').evaluate(n=>n.getBoundingClientRect().width)>1000)
 await pdf().getByRole('combobox',{name:'页面缩放'}).selectOption('page');await pdf().getByRole('button',{name:'转到第 3 页'}).click();assert.equal(await pdf().getByRole('textbox',{name:'页码'}).inputValue(),'3')
 await capture('ppt-navigation');await page.reload();await page.getByText('Office 页面预览验证',{exact:true}).first().click();await pdf().locator('canvas[data-painted="true"]').first().waitFor();assert.equal(await pdf().getByRole('textbox',{name:'页码'}).inputValue(),'3')
 mark('Thumbnails, page navigation, zoom and reopening survive a real renderer reload')
 await pdf().getByRole('button',{name:'转到第 2 页'}).click();await pdf().getByRole('button',{name:'标注修改',exact:true}).click()
 const box=await pdf().locator('[data-pdf-page="2"]').boundingBox();assert.ok(box)
 await page.mouse.move(box.x+box.width*.12,box.y+box.height*.14);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.42,{steps:8});await page.mouse.up()
 const editor=pdf().locator('[data-annotation-editor]');await editor.waitFor();await editor.getByRole('textbox',{name:'标注内容'}).fill('把第二页图表标题字号调大');await editor.getByRole('button',{name:'发送标注'}).click()
 await page.locator('[data-visualization-annotation]').waitFor();await until(()=>requests.some(body=>JSON.stringify(body.messages).includes('把第二页图表标题字号调大')),'annotation arrives at model')
 const request=requests.find(body=>JSON.stringify(body.messages).includes('把第二页图表标题字号调大')),serialized=JSON.stringify(request.messages)
 assert.ok(serialized.includes('pageNumber'));assert.ok(serialized.includes(slides.artifacts[0].path));await until(async()=>await page.locator('[data-visualization-annotation]').count()===1,'annotation queue settled');await page.locator('[data-visualization-annotation] summary').click();await page.locator('[data-visualization-annotation]').getByText('第 2 页',{exact:true}).waitFor();await capture('page-annotation-in-main-chat')
 mark('Region annotation opens its local editor and sends original App resource + page/coordinates to the main model; conversation displays one annotation')
 await open(sheets);await page.getByRole('button',{name:'工作表',exact:true}).click();await page.getByRole('button',{name:'说明',exact:true}).click();await page.getByText('公式结果应为 42,000',{exact:true}).waitFor();await capture('excel-sheets');await page.getByRole('button',{name:'页面版式',exact:true}).click();await pdf().locator('canvas[data-painted="true"]').first().waitFor()
 await page.getByRole('button',{name:'工作表',exact:true}).click();await page.getByRole('button',{name:'预算',exact:true}).click();
 await page.locator('[data-cell="B4"]').getByRole('button').click();assert.equal((await page.locator('[data-cell="B4"]').innerText()).trim(),'42,000');assert.ok((await page.locator('[data-cell-details]').innerText()).includes('=B2-B3'));await capture('excel-formatted-formula');
 await page.getByRole('button',{name:'页面版式',exact:true}).click();await pdf().locator('canvas[data-painted="true"]').first().waitFor();
 mark('Excel switches between page layout and sheets with formatted values and clickable formulas')
 await resize({width:1000,height:800});await pdf().getByRole('combobox',{name:'页面缩放'}).selectOption('width');await capture('narrow-preview')
 assert.ok(await pdf().evaluate(node=>node.scrollWidth<=node.clientWidth+1))
 await page.evaluate(()=>{document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark'});await capture('dark-preview')
 await resize({width:1440,height:900});await page.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light'})
 const broken=path.join(workspace,'broken.pdf');await fs.writeFile(broken,'not a PDF')
 await page.evaluate(({sessionId,path})=>window.agentDesktop.presentation.open({sessionId,input:{items:[{path}],mode:'auto'}}),{sessionId,path:broken})
 await pdf().getByRole('button',{name:'重试预览'}).waitFor();assert.ok((await pdf().innerText()).includes('文件不是有效 PDF'))
 await fs.copyFile(docs.result.visualReview.pdfPath,broken)
 await page.evaluate(({sessionId,path})=>window.agentDesktop.presentation.open({sessionId,input:{items:[{path}],mode:'auto'}}),{sessionId,path:broken})
 await pdf().locator('canvas[data-painted="true"]').first().waitFor()
 mark('Narrow/dark previews remain usable; a damaged PDF fails visibly and a corrected file reopens without a stuck loader')

 if(workflow){
  fixtureReply='引用原文：\n\n[文档原文]('+workflow.docRef.citation.uri+')\n\n[预算支出]('+workflow.sheetRef.citation.uri+')\n\n[第二页增长趋势]('+workflow.title.citation.uri+')\n\n[PDF 付款约定]('+workflow.pdfRef.citation.uri+')'
  await page.evaluate(({sessionId})=>window.agentDesktop.send({sessionId,prompt:'请展示这四份文件的原文引用。'}),{sessionId})
  await page.getByRole('link',{name:'第二页增长趋势',exact:true}).waitFor()
  await page.getByRole('link',{name:'第二页增长趋势',exact:true}).click();await pdf().locator('[data-citation-highlight="true"]').first().waitFor();assert.equal(await pdf().getByRole('textbox',{name:'页码'}).inputValue(),'2');await capture('citation-ppt')
  await pdf().getByRole('button',{name:'下一页',exact:true}).click();await page.getByRole('link',{name:'第二页增长趋势',exact:true}).click();await until(async()=>await pdf().getByRole('textbox',{name:'页码'}).inputValue()==='2','same citation reopens location')
  await pdf().getByRole('button',{name:'下一页',exact:true}).click();await page.reload();await page.getByText('Office 页面预览验证',{exact:true}).first().click();await pdf().locator('canvas[data-painted="true"]').first().waitFor();assert.equal(await pdf().getByRole('textbox',{name:'页码'}).inputValue(),'3')
  await page.getByRole('link',{name:'文档原文',exact:true}).click();await pdf().locator('[data-citation-highlight="true"]').first().waitFor();await capture('citation-word')
  const originalDoc=await fs.readFile(docs.artifacts[0].path);await fs.appendFile(docs.artifacts[0].path,'\nexternal edit');await page.evaluate(({sessionId})=>window.agentDesktop.presentation.refresh({sessionId}),{sessionId});await page.locator('[data-creation-status]').getByText(/核验已失效/).waitFor();await pdf().locator('canvas[data-painted="true"]').first().waitFor();await capture('external-edit-review-invalidated');await fs.writeFile(docs.artifacts[0].path,originalDoc)
  await page.getByRole('link',{name:'PDF 付款约定',exact:true}).click();await pdf().locator('[data-citation-page="true"]').waitFor();await pdf().locator('canvas[data-painted="true"]').first().waitFor();await capture('citation-pdf')
  await page.getByRole('link',{name:'预算支出',exact:true}).click();await page.locator('[data-cell="B3"][data-citation-cell="true"]').waitFor();assert.equal((await page.locator('[data-cell="B3"]').innerText()).trim(),'78000');await capture('citation-excel')
  mark('Actual assistant Markdown links locate Word text, PPT/PDF pages and Excel cells; repeated clicks return to the citation, reload restores reading position, external changes invalidate review while keeping the preview readable')
  await page.evaluate(({sessionId,uri})=>window.agentDesktop.presentation.open({sessionId,input:{items:[{resource_uri:uri+'#page=999'}]}}),{sessionId,uri:slides.result.resourceUri});await pdf().getByRole('alert').filter({hasText:'不存在'}).waitFor();await capture('citation-invalid-page')
  await page.getByRole('link',{name:'第二页增长趋势',exact:true}).click();await pdf().locator('[data-citation-highlight="true"]').first().waitFor();assert.equal(await pdf().getByRole('alert').count(),0)
  await open(workflow.changedSlides);await page.locator('[data-creation-status]').getByText('待逐页核验 · 1/3 页',{exact:true}).waitFor()
  await page.getByRole('button',{name:'查看 3 处修改',exact:true}).click();const comparison=page.locator('[data-document-comparison]');await comparison.waitFor();assert.equal(await comparison.locator('section').count(),3);assert.ok((await comparison.innerText()).includes('折线图'));assert.ok((await comparison.innerText()).includes('28%'));assert.equal(await comparison.locator('[data-table-diff] tbody tr').count(),1);await capture('ppt-object-comparison')
  await resize({width:1000,height:800});await page.evaluate(()=>{document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark'});await capture('comparison-narrow-dark');assert.ok(await comparison.evaluate(node=>node.scrollWidth<=node.clientWidth+1))
  await resize({width:1440,height:900});await page.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light'})
  await comparison.getByRole('button',{name:'修改后 · 定位原文',exact:true}).first().click();await pdf().locator('[data-citation-highlight="true"]').first().waitFor();assert.equal(await pdf().getByRole('textbox',{name:'页码'}).inputValue(),'2')
  await open(workflow.changedSheet);await page.getByRole('button',{name:'查看 2 处修改',exact:true}).click();await comparison.waitFor();assert.ok((await comparison.innerText()).includes('40000'));assert.ok((await comparison.innerText()).includes('42000'));await capture('excel-formula-comparison')
  mark('Invalid citations fail visibly and recover; the right-pane version toolbar opens native object/cell comparisons, links back to sources, and works in narrow/dark layouts')
  assert.ok(await comparison.locator('[data-diff-highlight]').count()>0)
  await open(workflow.changedWords);await page.getByRole('button',{name:'查看 2 处修改',exact:true}).click();await comparison.waitFor();assert.equal(await comparison.locator('section').count(),2);assert.ok(await comparison.locator('[data-diff-highlight]').count()>0);await capture('word-aligned-comparison')
  await open(workflow.changedImage);await page.getByRole('button',{name:'查看 1 处修改',exact:true}).click();await comparison.locator('[data-comparison-image]').first().waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('[data-comparison-image]')].length===2&&[...document.querySelectorAll('[data-comparison-image]')].every(i=>i.complete&&i.naturalWidth>0));await capture('image-comparison')
  await open(workflow.issueSlides);await page.locator('[data-creation-status]').getByRole('button',{name:/待逐页核验/}).click();await page.locator('[data-quality-issue]').waitFor();await capture('quality-issues');await page.locator('[data-quality-issue] button').first().click();await pdf().locator('[data-citation-highlight="true"]').first().waitFor();await page.locator('[data-quality-details]').waitFor({state:'detached'});await capture('quality-issue-location')
  await pdf().getByRole('button',{name:'标注修改',exact:true}).click();const issueBox=await pdf().locator('[data-pdf-page="1"]').boundingBox();await page.mouse.move(issueBox.x+issueBox.width*.1,issueBox.y+issueBox.height*.2);await page.mouse.down();await page.mouse.move(issueBox.x+issueBox.width*.5,issueBox.y+issueBox.height*.45,{steps:6});await page.mouse.up();await pdf().locator('[data-annotation-editor]').waitFor();await capture('quality-issue-annotation');await pdf().locator('[data-annotation-editor]').getByRole('button',{name:'取消',exact:true}).click()
  await open(workflow.pendingDeck);await page.locator('[data-render-progress]').getByText('页图 8/9',{exact:true}).waitFor();await page.locator('[data-creation-status]').getByRole('button',{name:'待逐页核验 · 0/9 页',exact:true}).click();await capture('partial-pages-progress')
  await pdf().getByRole('button',{name:'转到第 3 页'}).click();await pdf().locator('[data-pdf-page="3"] canvas[data-painted="true"]').waitFor();
  await page.evaluate(()=>{window.officeRetainedCanvas=document.querySelector('[data-pdf-page="3"] canvas')});
  fixtureToolCalls=[{name:'presentation_verify',input:{id:workflow.pendingDeck.id,sourceSha256:workflow.pendingDeck.result.inspection.sourceSha256,render:{startPage:9,count:8}}},{name:'presentation_verify',input:{id:workflow.pendingDeck.id,sourceSha256:workflow.pendingDeck.result.inspection.sourceSha256,pages:[{page:1,observations:'CDP 自动同步测试记录，非真实模型视觉判断',issues:[]}]}}];
  await page.evaluate(({sessionId})=>window.agentDesktop.send({sessionId,prompt:'执行页图续跑和核验状态同步测试。'}),{sessionId});
  await page.locator('[data-creation-status]').getByRole('button',{name:'待逐页核验 · 1/9 页',exact:true}).waitFor();
  assert.equal(await page.locator('[data-render-progress]').count(),0);assert.equal(await pdf().getByRole('textbox',{name:'页码'}).inputValue(),'3');
  assert.equal(await page.evaluate(()=>window.officeRetainedCanvas===document.querySelector('[data-pdf-page="3"] canvas')),true);
  await capture('live-review-status');mark('Real verify tools update page-generation and review progress automatically without moss_present, retaining the page and canvas');
  await open(workflow.longDeck);assert.equal(await pdf().locator('[data-pdf-page]').count(),12);await page.locator('[data-creation-status]').getByRole('button',{name:'待逐页核验 · 0/12 页',exact:true}).waitFor();await capture('large-document-preview')
  mark('Word changes highlight inserted/replaced text, native pictures show before/after thumbnails, quality issues locate original text and support local annotations; resumed deck remains unreviewed')
 }
 const installer=path.join(core,'skills/skill-installer/scripts/install.py'),bundle=templates.result.skillBundle
 assert.equal(bundle.installed,false)
 const inspect=JSON.parse((await run('python3',['-B',installer,'inspect','--source',bundle.path])).stdout)
 const installed=JSON.parse((await run('python3',['-B',installer,'install','--source',bundle.path,'--expected-digest',inspect.digest,'--dest',path.join(home,'skills')])).stdout)
 assert.equal(await hash(path.join(installed.path,'assets/reference.pptx')),await hash(slides.artifacts[0].path))
 await fs.appendFile(path.join(installed.path,'SKILL.md'),'\n用户本地备注\n');await assert.rejects(run('python3',['-B',installer,'install','--source',bundle.path,'--expected-digest',inspect.digest,'--dest',path.join(home,'skills')]))
 assert.ok((await fs.readFile(path.join(installed.path,'SKILL.md'),'utf8')).includes('用户本地备注'))
 assert.equal(changed.result.skillBundle.name,bundle.name);assert.equal(changed.result.version,2);assert.ok((await fs.readFile(path.join(installed.path,'SKILL.md'),'utf8')).includes('用户本地备注'))
 await page.reload();await page.getByRole('button',{name:'插件',exact:true}).first().click();await page.getByRole('tab',{name:'常用',exact:true}).click()
 const catalog=await page.evaluate(()=>window.agentDesktop.skillHub.getInstalled());assert.ok(catalog.data.some(skill=>skill.name===bundle.name&&!skill.isBuiltin))
 await page.getByRole('button',{name:'打开 '+bundle.name,exact:true}).click();await page.locator('[data-installed-resource-details="skill"]').getByRole('button',{name:/SKILL.md/}).click();await page.locator('aside pre').waitFor();assert.ok((await page.locator('aside pre').innerText()).includes('assets/reference.pptx'));await capture('personal-template-skill')
 mark('Template bundle installs through the existing inspected installer, keeps portable resources, appears in real skill details; conflicts and updates preserve local edits')
 await page.getByText('Office 页面预览验证',{exact:true}).first().click()
 composerChecks.push(await assertComposerVisible(page,geometry))
 await resize({width:1000,height:800})
 releaseFixture={};releaseFixture.promise=new Promise(resolve=>{releaseFixture.resolve=resolve})
 await page.evaluate(sessionId=>{window.officeViewportDone=false;void window.agentDesktop.send({sessionId,prompt:'检查处理中输入区仍完整显示。'}).finally(()=>{window.officeViewportDone=true})},sessionId)
 try {
  await page.getByRole('button',{name:'停止',exact:true}).waitFor()
  composerChecks.push(await assertComposerVisible(page,geometry));await capture('composer-busy-native')
  const stopped=await page.getByRole('button',{name:'停止',exact:true}).boundingBox();assert.ok(stopped.y+stopped.height<=geometry.contentBounds.height)
 } finally {releaseFixture.resolve();releaseFixture=null}
 await until(()=>page.evaluate(()=>window.officeViewportDone),'viewport check reply')
 await resize({width:1440,height:900});await page.reload();await page.getByText('Office 页面预览验证',{exact:true}).first().click()
 await page.getByText('检查处理中输入区仍完整显示。',{exact:true}).waitFor()
 composerChecks.push(await assertComposerVisible(page,geometry));await capture('composer-restored-native')
 await fs.writeFile(path.join(output,'composer-geometry.json'),JSON.stringify(composerChecks,null,2))
 mark('Native window fits display work area; composer and action controls stay visible in normal/narrow/busy states, after session switch and reload')
 if(process.argv.includes('--live-model')){
  const actualSettings=JSON.parse(await fs.readFile(path.join(os.homedir(),'.moss/settings.json'),'utf8')),model=actualSettings.models?.text;
  assert.ok(model?.baseUrl&&model?.apiKey&&model?.model,'A configured text model is required for live acceptance');
  const liveOutput=path.join(core,'output/office-delivery');await fs.mkdir(liveOutput,{recursive:true});
  await page.evaluate(async settings=>{await window.agentDesktop.updateSettings(settings)},{model:model.model,url:model.baseUrl,apiKey:model.apiKey,maxTurns:20});
  const source=path.join(workspace,'验收预算.xlsx');await fs.copyFile(sheets.artifacts[0].path,source);const before=await hash(source);
  const live=await page.evaluate(workspace=>window.agentDesktop.createSession({title:'真实模型 Office 验收',workspace,permissionMode:'bypassPermissions'}),workspace),liveId=live.summary.id;
  await page.reload();await page.getByText('真实模型 Office 验收',{exact:true}).first().click();
  const redact=text=>String(text).replaceAll(model.apiKey,'[redacted]').replaceAll(model.baseUrl,'[configured endpoint]');
  const started=Date.now();let liveResult,diagnostics={};
  try{
   await page.evaluate(({sessionId})=>{window.officeLiveDone=false;window.officeLiveResult=null;void window.agentDesktop.send({sessionId,prompt:'把工作区里的验收预算.xlsx中预算表的 B3 支出改为 80000，保留其他内容与公式，原件保留。查看实际页面检查排版后，在右侧展示结果，给我修改对比和原文定位引用。只处理这个测试文件。'}).then(result=>{window.officeLiveResult=result;window.officeLiveDone=true},error=>{window.officeLiveResult={ok:false,error:String(error)};window.officeLiveDone=true})},{sessionId:liveId});
   await until(()=>page.evaluate(()=>window.officeLiveDone),'real-model Office turn',360000);
   const result=await page.evaluate(()=>window.officeLiveResult);
   diagnostics={answer:redact(result.assistantText||''),sendError:result.error?redact(result.error):null};
   const detail=await page.evaluate(sessionId=>window.agentDesktop.getSession({sessionId}),liveId),toolNames=[];
   const apiErrors=[],seenTools=new Set(),presentations=[];
   const visit=value=>{if(!value||typeof value!=='object')return;if(value.type==='tool_use'&&value.name&&!seenTools.has(value.id)){seenTools.add(value.id);toolNames.push(value.name);if(value.name==='moss_present')presentations.push(value.input)}if(typeof value.text==='string'&&/API Error|模型请求重试|Connection error/.test(value.text))apiErrors.push(redact(value.text));for(const child of Object.values(value))if(typeof child==='object')Array.isArray(child)?child.forEach(visit):visit(child)};visit(detail.history);
   diagnostics={...diagnostics,toolNames,presentations,apiErrors:[...new Set(apiErrors)]};
   assert.equal(result.ok,true,result.error);
   assert.equal(apiErrors.length,0,apiErrors.join('\n'));
   const snapshot=await page.evaluate(sessionId=>window.agentDesktop.presentation.snapshot({sessionId}),liveId),resources=[];
   for(const item of snapshot.resources||[]){if(item.source.type==='provider'||item.source.type==='file'){try{resources.push(await page.evaluate(({sessionId,artifactId})=>window.agentDesktop.presentation.load({sessionId,artifactId}),{sessionId:liveId,artifactId:item.id}))}catch{}}}
   const XLSX=await import('xlsx-republish'),candidates=[];
   for(const file of resources.map(r=>r.file).filter(f=>f?.path?.endsWith('.xlsx'))){
    const book=XLSX.read(await fs.readFile(file.path),{type:'buffer'}),budget=book.Sheets['预算'];
    candidates.push({file,expense:budget?.B3?.v,formula:budget?.B4?.f,balance:budget?.B4?.v});
   }
   diagnostics.candidates=candidates.map(({file,...cells})=>({name:path.basename(file.path),...cells,quality:file.metadata?.creation?.quality}));
   // The model may present the preserved original before the new revision.
   // Verify every workbook and select by the expected edit, not resource order.
   const edited=candidates.find(item=>item.file.path!==source&&item.expense===80000);
   assert.ok(edited,'Model did not present a workbook with the requested B3 edit');
   const resultFile=edited.file;
   assert.equal(edited.formula,'B2-B3');assert.equal(edited.balance,40000);assert.equal(await hash(source),before);
   await fs.copyFile(resultFile.path,path.join(liveOutput,'真实模型预算修订.xlsx'));await capture('live-model-result');
   const quality=resultFile.metadata?.creation?.quality;
   liveResult={...diagnostics,ok:quality?.state==='reviewed'||quality?.state==='reviewed-with-warnings',fileCorrect:true,sourcePreserved:true,quality,model:model.model,elapsedMs:Date.now()-started};
  }catch(error){await page.evaluate(sessionId=>window.agentDesktop.abort({sessionId}),liveId).catch(()=>{});liveResult={ok:false,model:model.model,elapsedMs:Date.now()-started,...diagnostics,error:redact(error)};await capture('live-model-incomplete')}
  await fs.writeFile(path.join(liveOutput,'live-model.json'),JSON.stringify(liveResult,null,2));console.log('LIVE_ACCEPTANCE',liveResult.ok?'passed':'incomplete',liveResult.elapsedMs+'ms');
 }
 assert.deepEqual(errors,[])
 await fs.writeFile(path.join(output,'validation.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),checks,errors,packages:JSON.parse(await fs.readFile(path.join(ui,'dist/builtin-apps/manifest.json'),'utf8')).apps,scope:'These checks use actual packaged App tools + local LibreOffice/Poppler + isolated Electron CDP with native window sizes. A local HTTP fixture supplies assistant citations and receives annotations. Optional live-model acceptance is recorded separately in output/office-delivery/live-model.json.'},null,2))
 await fs.rm(path.join(output,'failure.json'),{force:true});await fs.rm(path.join(output,'failure.png'),{force:true});console.log('Verified',output)
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),checks,errors},null,2));throw error}
finally{releaseFixture?.resolve();await host?.shutdown();await artifactUrls?.close();await target?.close();await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.copyFile(path.join(directory,'instance.log'),path.join(output,'instance.log')).catch(()=>{});await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:250})}
