// Real PDF.js + React viewer regression: web URLs, links, fitting, and annotations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const ui=fileURLToPath(new URL('..',import.meta.url)),core=path.dirname(ui),apps=path.resolve(core,'../moss-apps');
const output=path.join(core,'output/office-preview-fixes'),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'moss-pdf-regression-'));
const modules=path.join(apps,'node_modules/.bun'),pv=(await fs.readdir(modules)).filter(n=>n.startsWith('playwright@')).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))[0];
const {chromium}=await import(pathToFileURL(path.join(modules,pv,'node_modules/playwright/index.mjs')));
const {PDFDocument,PDFName,PDFString,degrees,rgb}=await import(pathToFileURL(path.join(apps,'apps/pdf-tools/node_modules/pdf-lib/cjs/index.js')));
const checks=[],requests=[],errors=[];let browser,server,page;
const mark=value=>{checks.push(value);console.log('PASS',value)};
try {
 await fs.mkdir(output,{recursive:true});
 const doc=await PDFDocument.create(),first=doc.addPage([600,800]),second=doc.addPage([600,800]);
 const addLink=(page,rect,properties)=>{
  const annotation=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:rect,Border:[0,0,0],...properties}));
  const key=PDFName.of('Annots');if(!page.node.has(key))page.node.set(key,doc.context.obj([]));page.node.lookup(key).push(annotation);
 };
 first.drawText('External link',{x:60,y:700,size:18});addLink(first,[60,697,260,723],{A:{S:'URI',URI:PDFString.of('https://example.org/pdf-review')}});
 first.drawText('Named destination: page 2',{x:60,y:640,size:18});addLink(first,[60,637,360,663],{Dest:PDFString.of('chapter-two')});
 first.drawText('Direct destination: page 2',{x:60,y:580,size:18});addLink(first,[60,577,360,603],{Dest:[second.ref,'Fit']});
 first.drawText('Unsafe link must not execute',{x:60,y:520,size:18});addLink(first,[60,517,360,543],{A:{S:'URI',URI:PDFString.of('javascript:window.pdfUnsafeExecuted=true')}});
 first.drawText('Missing destination',{x:60,y:460,size:18});addLink(first,[60,457,360,483],{Dest:PDFString.of('missing-chapter')});
 doc.catalog.set(PDFName.of('Names'),doc.context.obj({Dests:{Names:[PDFString.of('chapter-two'),[second.ref,'Fit']]}}));
 second.setCropBox(30,40,540,720);second.setRotation(degrees(90));
 second.drawText('Rotated/cropped external link',{x:60,y:100,size:18});addLink(second,[60,97,360,123],{A:{S:'URI',URI:PDFString.of('https://example.org/rotated')}});
 second.drawText('Return to first page',{x:60,y:200,size:18});addLink(second,[60,197,360,223],{A:{S:'Named',N:'FirstPage'}});
 const file=path.join(temporary,'中文 #100% & ?.pdf');await fs.writeFile(file,await doc.save());
 const large=await PDFDocument.create(),largePage=large.addPage([12000,9000]);
 largePage.drawRectangle({x:300,y:300,width:11400,height:8400,color:rgb(1,1,1),borderColor:rgb(.15,.3,.55),borderWidth:30});
 largePage.drawText('Huge page: all four edges must fit',{x:500,y:7600,size:300});
 largePage.drawText('12000 x 9000 pt',{x:500,y:6500,size:300});
 largePage.drawText('Bottom right',{x:8800,y:500,size:300});
 const largeFile=path.join(temporary,'large.pdf');await fs.writeFile(largeFile,await large.save());
 await fs.copyFile(file,path.join(output,'links-rotated-cropped.pdf'));await fs.copyFile(largeFile,path.join(output,'large.pdf'));
 const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {PDFViewer} from '/src/renderer-react/components/preview/viewers/PDFViewer.tsx';import {AppComposerContext} from '/src/renderer-react/lib/app-composer.tsx';import '/src/renderer-react/globals.css';
  const q=new URLSearchParams(location.search);window.openedUrls=[];window.annotations=[];window.mossWeb={fileUrl:path=>'/api/files?path='+encodeURIComponent(path)};
  window.agentDesktop={shell:{openExternal:async url=>{window.openedUrls.push(url);return {ok:true}}}};
  const context={selection:null,select:()=>{},submitVisualizationAnnotation:async(sessionId,annotation)=>window.annotations.push(annotation)};
  createRoot(document.getElementById('root')).render(React.createElement(AppComposerContext.Provider,{value:context},React.createElement('main',{style:{width:'100%',maxWidth:800,height:'100vh',margin:'0 auto'}},React.createElement(PDFViewer,{filePath:q.get('file'),fileVersion:123456789,title:'PDF 回归测试',resourceUri:'moss-pdf://works/fixture',sessionId:'pdf-regression'}))));`;
 server=await createServer({root:ui,configFile:path.join(ui,'vite.config.ts'),cacheDir:path.join(temporary,'vite'),logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
  name:'pdf-regression-fixture',resolveId(id){if(id==='/pdf-regression.jsx')return '\0pdf-regression.jsx'},load(id){if(id==='\0pdf-regression.jsx')return source},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
   const url=new URL(req.url,'http://local');
   if(url.pathname==='/api/files'){
    const requested=url.searchParams.get('path');requests.push({path:requested,version:url.searchParams.get('v')});
    if(![file,largeFile].includes(requested)){res.statusCode=404;return res.end('Not found')}
    res.setHeader('Content-Type','application/pdf');return res.end(await fs.readFile(requested));
   }
   if(url.pathname!=='/pdf-regression')return next();res.setHeader('Content-Type','text/html');
   res.end(await server.transformIndexHtml('/pdf-regression','<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/pdf-regression.jsx"></script></body></html>'));
  });}
 }]});await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 const open=async file=>{await page.goto(base+'/pdf-regression?file='+encodeURIComponent(file));await page.locator('[data-pdf-page="1"] canvas[data-painted="true"]').waitFor();};
 const current=()=>page.getByRole('textbox',{name:'页码'});
 const waitPage=async number=>{await page.waitForFunction(n=>document.querySelector('[aria-label="页码"]')?.value===String(n),number);await page.locator(`[data-pdf-page="${number}"] canvas[data-painted="true"]`).waitFor()};
 const snap=async name=>page.screenshot({path:path.join(output,name+'.png')});
 await open(file);assert.deepEqual(requests[0],{path:file,version:'123456789'});mark('Web version parameter preserves a Chinese filename containing spaces, #, %, &, and ?');
 await page.getByRole('link',{name:'https://example.org/pdf-review',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.openedUrls),['https://example.org/pdf-review']);
 assert.equal(await page.locator('a[href^="javascript:"]').count(),0);assert.equal(await page.evaluate(()=>!!window.pdfUnsafeExecuted),false);mark('External PDF link reaches the Moss shell and unsafe schemes have no active link');
 await page.locator('.annotationLayer a[href="#chapter-two"]').click();await waitPage(2);await page.getByRole('link',{name:'https://example.org/rotated',exact:true}).waitFor();
 const rotated=page.getByRole('link',{name:'https://example.org/rotated',exact:true});
 async function verifyRotated(){const p=await page.locator('[data-pdf-page="2"]').boundingBox(),a=await rotated.boundingBox();assert.ok(p&&a);assert.ok(Math.abs((a.x-p.x)/p.width-57/720)<.005);assert.ok(Math.abs((a.y-p.y)/p.height-30/540)<.005);assert.ok(Math.abs(a.width/p.width-26/720)<.005);assert.ok(Math.abs(a.height/p.height-300/540)<.005)}
 await verifyRotated();await rotated.click();assert.equal(await page.evaluate(()=>window.openedUrls.at(-1)),'https://example.org/rotated');await snap('rotated-links');
 await page.getByRole('combobox',{name:'页面缩放'}).selectOption('1.25');await rotated.waitFor();await verifyRotated();await rotated.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.openedUrls.length),3);mark('Named destination navigates; rotated/cropped link geometry survives zoom and keyboard activation');
 await page.getByRole('combobox',{name:'页面缩放'}).selectOption('page');await page.locator('[data-pdf-page="2"] .annotationLayer a[href=""]').click();await waitPage(1);
 await page.locator('[data-pdf-page="1"] .annotationLayer a[href^="#%5B"]').click();await waitPage(2);mark('Direct page reference and FirstPage named action navigate within the existing viewer');
 await page.getByRole('button',{name:'上一页',exact:true}).click();await waitPage(1);
 await page.getByRole('button',{name:'标注修改',exact:true}).click();const link=await page.getByRole('link',{name:'https://example.org/pdf-review',exact:true}).boundingBox();assert.ok(link);
 await page.mouse.move(link.x+2,link.y+2);await page.mouse.down();await page.mouse.move(link.x+link.width-2,link.y+link.height-2,{steps:8});await page.mouse.up();
 await page.getByRole('textbox',{name:'标注内容'}).fill('调整这段链接文字');await snap('annotation-over-link');await page.getByRole('button',{name:'发送标注',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.annotations.length),1);assert.equal(await page.evaluate(()=>window.openedUrls.length),3);mark('Region annotation over a link sends a page annotation without opening that link');
 await page.locator('.annotationLayer a[href="#missing-chapter"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-pdf-preview] [role="alert"]')?.textContent.includes('无法跳转'));
 const previousHeight=await page.locator('[data-pdf-scroll]').evaluate(node=>node.clientHeight);
 await page.setViewportSize({width:1280,height:960});await page.waitForFunction(height=>document.querySelector('[data-pdf-scroll]').clientHeight<height,previousHeight);
 await page.getByRole('alert').filter({hasText:'无法跳转'}).waitFor();assert.equal(await current().inputValue(),'1');
 await page.locator('[data-pdf-page="1"] canvas[data-painted="true"]').waitFor();await snap('missing-destination');mark('Missing internal destination shows a nonfatal notice while keeping the document readable');
 await open(largeFile);
 for(const mode of ['width','page']){
  await page.getByRole('combobox',{name:'页面缩放'}).selectOption(mode);
  await page.waitForFunction(mode=>{const s=document.querySelector('[data-pdf-scroll]'),p=document.querySelector('[data-pdf-page="1"]');return p&&s&&p.clientWidth<=s.clientWidth-39&&(mode!=='page'||p.clientHeight<=s.clientHeight-39)},mode);
  await page.locator('[data-pdf-page="1"] canvas[data-painted="true"]').waitFor();await snap('large-'+mode);
 }
 await page.setViewportSize({width:420,height:720});await page.getByRole('combobox',{name:'页面缩放'}).selectOption('width');await page.waitForFunction(()=>{const s=document.querySelector('[data-pdf-scroll]');return s.scrollWidth<=s.clientWidth+1});await page.locator('[data-pdf-page="1"] canvas[data-painted="true"]').waitFor();await snap('large-narrow');mark('12000 × 9000 pt PDF fits width and whole page, including a 420 px window');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'pdf-validation.json'),JSON.stringify({ok:true,checks,requests,errors},null,2));await fs.rm(path.join(output,'failure.png'),{force:true});
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(output,'pdf-validation.json'),JSON.stringify({ok:false,error:String(error),checks,requests,errors},null,2));throw error}
finally{await browser?.close();await server?.close();await fs.rm(temporary,{recursive:true,force:true});}
