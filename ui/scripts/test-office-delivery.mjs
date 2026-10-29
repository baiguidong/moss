// Actual XLSX parsing and React/PDF.js views; only conversion timing is controlled.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import * as XLSX from 'xlsx-republish';
import { conversionService } from '../src/process/services/conversion-service.mjs';
const ui=fileURLToPath(new URL('..',import.meta.url)),core=path.dirname(ui),apps=path.resolve(core,'../moss-apps');
const output=path.join(core,'output/office-delivery'),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'moss-office-delivery-'));
const modules=path.join(apps,'node_modules/.bun'),pv=(await fs.readdir(modules)).filter(n=>n.startsWith('playwright@')).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))[0];
const {chromium}=await import(pathToFileURL(path.join(modules,pv,'node_modules/playwright/index.mjs')));
const {PDFDocument}=await import(pathToFileURL(path.join(apps,'apps/pdf-tools/node_modules/pdf-lib/cjs/index.js')));
const checks=[],errors=[];let browser,server,page;
const mark=text=>{checks.push(text);console.log('PASS',text)};
try {
 await fs.mkdir(output,{recursive:true});
 const file=path.join(output,'格式与公式.xlsx');
 const cells={A1:{t:'s',v:'完成率'},B1:{t:'s',v:'日期'},C1:{t:'s',v:'金额'},D1:{t:'s',v:'结余'},A2:{t:'n',v:.28,z:'0%'},B2:{t:'n',v:46324,z:'yyyy-mm-dd'},C2:{t:'n',v:12345.5,z:'#,##0.00'},D2:{t:'n',v:0,f:'1-1',z:'0.00'},A3:{t:'s',v:'无缓存公式'},B3:{t:'n',f:'SUM(C2:D2)'},'!ref':'A1:D3'};
 await fs.writeFile(file,XLSX.write({SheetNames:['预算'],Sheets:{'预算':cells}},{type:'buffer',bookType:'xlsx'}));
 const workbook=(await conversionService.excelToJson(file)).data;
 const doc=await PDFDocument.create();doc.addPage([600,800]).drawText('Office preview ready',{x:50,y:700,size:22});const pdfBytes=await doc.save();
 const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {ExcelViewer} from '/src/renderer-react/components/preview/viewers/ExcelViewer.tsx';import '/src/renderer-react/globals.css';
 const workbook=${JSON.stringify(workbook)};const pending={};window.requests=[];window.ready=0;
 window.mossWeb={fileUrl:()=>'/delivery.pdf'};
 window.agentDesktop={shell:{openFile:async()=>({ok:true})},document:{convert:({filePath,to})=>{window.requests.push({filePath,to});if(to==='excel-json'&&!filePath.includes('hold'))return Promise.resolve({result:{success:true,data:filePath==='new.xlsx'?{sheets:[{name:'新文件',data:[['新版内容']],displayData:[['新版内容']]}]}:workbook}});return new Promise(resolve=>pending[filePath+':'+to]=resolve)}}};
 window.finish=(file,to,fail=false)=>pending[file+':'+to]?.({result:fail?{success:false,error:'测试转换失败'}:{success:true,data:to==='excel-json'?workbook:'/delivery.pdf'}});
 function Demo(){const [file,setFile]=React.useState('budget.xlsx');window.setFile=setFile;return React.createElement('main',{style:{height:'100vh',maxWidth:900,margin:'0 auto'}},React.createElement(ExcelViewer,{filePath:file,previewPdfPath:file.includes('cached')?'/delivery.pdf':undefined,onReady:()=>window.ready++}))};createRoot(document.getElementById('root')).render(React.createElement(Demo));`;
 server=await createServer({root:ui,configFile:path.join(ui,'vite.config.ts'),cacheDir:path.join(temporary,'vite'),logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
  name:'office-delivery-test',resolveId:id=>id==='/delivery.jsx'?'\0delivery.jsx':undefined,load:id=>id==='\0delivery.jsx'?source:undefined,
  configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.startsWith('/delivery.pdf')){res.setHeader('Content-Type','application/pdf');return res.end(pdfBytes)}if(req.url!=='/delivery')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/delivery','<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/delivery.jsx"></script></body></html>'));});}
 }]});await server.listen();browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1200,height:800}});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>console.log('REQUEST_FAILED',r.url(),r.failure()?.errorText));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/delivery`);
 await page.getByText('页面版式正在后台生成，可先阅读工作表。',{exact:true}).waitFor();
 for(const [cell,text] of Object.entries({A2:'28%',B2:'2026-10-29',C2:'12,345.50',D2:'0.00',B3:'=SUM(C2:D2)'}))assert.equal((await page.locator(`[data-cell="${cell}"]`).innerText()).trim(),text);
 assert.ok(await page.evaluate(()=>window.ready)>0);await page.locator('[data-cell="D2"] button').click();await page.locator('[data-cell-details]').getByText('=1-1',{exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'excel-data-before-pdf.png')});mark('Formatted XLSX and formula details are readable while PDF conversion is still pending');
 await page.evaluate(()=>{window.retainedCell=document.querySelector('[data-cell="D2"]');window.finish('budget.xlsx','libreoffice-pdf')});
 await page.getByText('页面版式已就绪，可随时切换。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.retainedCell===document.querySelector('[data-cell="D2"]')),true);assert.equal(await page.locator('[data-cell-details]').count(),1);mark('Background PDF completion preserves worksheet selection and DOM');
 await page.getByRole('button',{name:'页面版式',exact:true}).click();await page.locator('canvas[data-painted="true"]').first().waitFor();
 await page.evaluate(()=>window.setFile('hold-cached.xlsx'));await page.waitForFunction(()=>window.requests.some(r=>r.filePath==='hold-cached.xlsx'));await page.locator('canvas[data-painted="true"]').first().waitFor();assert.equal(await page.evaluate(()=>window.requests.some(r=>r.filePath==='hold-cached.xlsx'&&r.to==='libreoffice-pdf')),false);mark('A cached PDF opens without waiting for workbook parsing or reconverting');
 await page.evaluate(()=>window.setFile('new.xlsx'));await page.getByText('新版内容',{exact:true}).waitFor();await page.evaluate(()=>window.finish('hold-cached.xlsx','excel-json'));assert.equal(await page.getByText('新版内容',{exact:true}).count(),1);mark('Late workbook responses cannot replace a newly opened file');
 await page.evaluate(()=>window.finish('new.xlsx','libreoffice-pdf',true));assert.equal(await page.getByText('新版内容',{exact:true}).count(),1);
 await page.getByRole('button',{name:'页面版式',exact:true}).click();await page.getByText(/测试转换失败/).waitFor();mark('Conversion failure preserves usable data and displays the cause');
 await page.evaluate(()=>window.setFile('budget.xlsx'));await page.getByText('28%',{exact:true}).waitFor();await page.setViewportSize({width:620,height:800});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.locator('[data-cell="D2"] button').click();await page.screenshot({path:path.join(output,'excel-narrow-dark.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));mark('Narrow dark layout keeps formats and formula details readable');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'validation.json'),JSON.stringify({ok:true,checks,errors,scope:'Actual XLSX parsing, React viewer and PDF.js; controlled async conversion timing, no model calls.'},null,2));
} catch(error){console.log('BROWSER_ERRORS',JSON.stringify(errors));console.log('BODY',await page?.locator('body').innerText());await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error}
finally {await browser?.close();await server?.close();await fs.rm(temporary,{recursive:true,force:true})}
