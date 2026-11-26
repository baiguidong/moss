// Actual XLSX parsing and React/PDF.js views; the fixture verifies that opening
// an ordinary workbook does not request LibreOffice conversion.
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
 const workbookBytes=XLSX.write({SheetNames:['月度统计','区域统计','销售明细'],Sheets:{'月度统计':cells,'区域统计':{A1:{t:'s',v:'区域名称'},'!ref':'A1'},'销售明细':{A1:{t:'s',v:'客户名称'},'!ref':'A1'}}},{type:'buffer',bookType:'xlsx'});
 await fs.writeFile(file,workbookBytes);
 const workbook=(await conversionService.excelToJson(file)).data;
 const doc=await PDFDocument.create();doc.addPage([600,800]).drawText('Office preview ready',{x:50,y:700,size:22});doc.addPage([600,800]);const pdfBytes=await doc.save();
 const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {ExcelViewer} from '/src/renderer-react/components/preview/viewers/ExcelViewer.tsx';import {WordViewer} from '/src/renderer-react/components/preview/viewers/WordViewer.tsx';import '/src/renderer-react/globals.css';
 const workbook=${JSON.stringify(workbook)};const pending={};window.requests=[];window.ready=0;
 window.mossWeb={fileUrl:(file)=>file.endsWith('.xlsx')?'/delivery.xlsx':'/delivery.pdf'};
 window.agentDesktop={shell:{openFile:async()=>({ok:true})},document:{convert:({filePath,to})=>{window.requests.push({filePath,to});if(to==='excel-json'&&!filePath.includes('hold'))return Promise.resolve({result:{success:true,data:filePath==='new.xlsx'?{sheets:[{name:'新文件',data:[['新版内容']],displayData:[['新版内容']]}]}:workbook}});return new Promise(resolve=>pending[filePath+':'+to]=resolve)}}};
 window.finish=(file,to,fail=false)=>pending[file+':'+to]?.({result:fail?{success:false,error:'测试转换失败'}:{success:true,data:to==='excel-json'?workbook:'/delivery.pdf'}});
 function Demo(){
  const [file,setFile]=React.useState('budget.xlsx');
  const [location,setLocation]=React.useState();
  window.setFile=setFile;
  window.setLocation=setLocation;
  const Viewer=file.endsWith('.docx')?WordViewer:ExcelViewer;
  return React.createElement('main',{style:{height:'100vh',maxWidth:900,margin:'0 auto'}},React.createElement(Viewer,{filePath:file,documentLocation:location,previewPdfPath:file.includes('cached')?'/delivery.pdf':undefined,onReady:()=>window.ready++}));
 }
 createRoot(document.getElementById('root')).render(React.createElement(Demo));`;
 server=await createServer({root:ui,configFile:path.join(ui,'vite.config.ts'),cacheDir:path.join(temporary,'vite'),logLevel:'error',server:{host:'127.0.0.1',strictPort:false,hmr:false},plugins:[{
  name:'office-delivery-test',resolveId:id=>id==='/delivery.jsx'?'\0delivery.jsx':undefined,load:id=>id==='\0delivery.jsx'?source:undefined,
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
    if(req.url?.startsWith('/delivery.pdf')){
      res.setHeader('Content-Type','application/pdf');
      return res.end(pdfBytes);
    }
    if(req.url?.startsWith('/delivery.xlsx')){
      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.end(workbookBytes);
    }
    if(req.url!=='/delivery')return next();
    res.setHeader('Content-Type','text/html');
    res.end(await server.transformIndexHtml('/delivery','<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/delivery.jsx"></script></body></html>'));
  });}
 }]});await server.listen();browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});page=await browser.newPage({viewport:{width:1200,height:800}});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>console.log('REQUEST_FAILED',r.url(),r.failure()?.errorText));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/delivery`);
 const modes=page.getByRole('combobox',{name:'工作簿模式'});
 const tabs=page.getByLabel('工作表列表');
 await tabs.getByRole('button',{name:'月度统计'}).waitFor();
 for (const name of ['月度统计','区域统计','销售明细']) {
   assert.equal(await page.getByText(name,{exact:true}).filter({visible:true}).count(),1,'A single visible sheet label for '+name);
 }
 await tabs.getByRole('button',{name:'区域统计'}).click();
 await page.locator('.ofv-workbook-table').getByText('区域名称',{exact:true}).waitFor();
 await tabs.getByRole('button',{name:'销售明细'}).click();
 assert.equal(await modes.inputValue(),'original');
 await page.locator('.ofv-workbook-table').getByText('客户名称',{exact:true}).waitFor();
 assert.ok(await tabs.evaluate(el=>el.getBoundingClientRect().height<=36 && el.getBoundingClientRect().bottom>=innerHeight-2));
 await modes.selectOption('sheets');
 await page.locator('[data-spreadsheet-grid]').getByText('客户名称',{exact:true}).waitFor();
 await tabs.getByRole('button',{name:'月度统计'}).click();
 await page.locator('[data-cell="A2"]').waitFor();
 assert.equal(await page.evaluate(()=>window.requests.some(r=>r.to==='libreoffice-pdf')),false);
 assert.equal(await page.locator('[data-cell-details]').count(),0);
 await page.getByRole('button',{name:'公式栏',exact:true}).click();
 for(const [cell,text] of Object.entries({A2:'28%',B2:'2026-10-29',C2:'12,345.50',D2:'0.00',B3:'=SUM(C2:D2)'}))assert.equal((await page.locator(`[data-cell="${cell}"]`).innerText()).trim(),text);
 assert.ok(await page.evaluate(()=>window.ready)>0);await page.locator('[data-cell="D2"] button').click();await page.locator('[data-cell-details]').getByText('=1-1',{exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'excel-data-browser.png')});mark('Formatted XLSX renders in the browser without a LibreOffice request');
 await page.evaluate(()=>{window.retainedCell=document.querySelector('[data-cell="D2"]')});
 assert.equal(await page.evaluate(()=>window.retainedCell===document.querySelector('[data-cell="D2"]')),true);assert.equal(await page.locator('[data-cell-details]').count(),1);
 const previousReady=await page.evaluate(()=>window.ready);
 await modes.selectOption('original');
 await page.waitForFunction(previous=>window.ready>previous,previousReady);
 assert.equal((await page.locator('.ofv-workbook-table [data-cell="B3"]').innerText()).trim(),'=SUM(C2:D2)');
 assert.equal(await page.locator('[data-spreadsheet-grid]').count(),0);
 assert.equal(await page.getByText(/当前格式为基础预览/).count(),0);
 await modes.selectOption('sheets');
 await page.locator('[data-cell-details]').getByText('=1-1',{exact:true}).waitFor();
 mark('The original preview displays the XLSX and returning restores the selected cell and formula');
 const more=page.getByRole('button',{name:'更多预览操作',exact:true});
 const print=page.getByRole('menuitem',{name:'打印预览',exact:true});
 assert.equal(await page.getByRole('button',{name:'预览模式',exact:true}).count(),0);
 await more.click();
 assert.equal(await print.count(),0);
 await page.keyboard.press('Escape');
 await page.evaluate(()=>window.setFile('cached.xlsx'));
 await page.evaluate(()=>window.setLocation({page:2}));
 await page.locator('.ofv-workbook-table').waitFor();
 assert.equal(await modes.inputValue(),'original');
 assert.equal(await page.locator('[data-pdf-preview]').count(),0);
 mark('Legacy print references open the original workbook');
 await page.evaluate(()=>window.setLocation({sheet:'月度统计',range:'A2'}));
 await page.locator('[data-cell="A2"][data-citation-cell="true"]').waitFor();
 mark('Cell citations select the worksheet view');
 await page.evaluate(()=>{window.setLocation(undefined);window.setFile('hold-cached.xlsx')});
 await page.waitForFunction(()=>window.requests.some(r=>r.filePath==='hold-cached.xlsx'));
 await page.evaluate(()=>window.setFile('new.xlsx'));
 await modes.selectOption('sheets');
 await page.locator('[data-spreadsheet-grid]').getByText('新版内容',{exact:true}).waitFor();
 await page.evaluate(()=>window.finish('hold-cached.xlsx','excel-json'));
 assert.equal(await page.locator('[data-spreadsheet-grid]').getByText('新版内容',{exact:true}).count(),1);
 mark('Late workbook responses cannot replace a newly opened file');
 assert.equal(await page.evaluate(()=>window.requests.some(r=>r.to==='libreoffice-pdf')),false);mark('Office preview delivery never asks the desktop for LibreOffice');
 await page.evaluate(()=>window.setFile('budget.xlsx'));await modes.selectOption('sheets');await page.getByText('28%',{exact:true}).waitFor();await page.setViewportSize({width:620,height:800});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.locator('[data-cell="D2"] button').click();await page.screenshot({path:path.join(output,'excel-narrow-dark.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));mark('Narrow dark layout keeps formats and formula details readable');
 await page.getByRole('button',{name:'公式栏',exact:true}).click();assert.equal(await page.locator('[data-cell-details]').count(),0);
 await page.reload();await modes.selectOption('sheets');await page.locator('[data-cell="A2"]').waitFor();assert.equal(await page.locator('[data-cell-details]').count(),0);
 await page.getByRole('button',{name:'更多预览操作',exact:true}).click();await page.getByRole('menuitem',{name:'刷新预览',exact:true}).click();await page.waitForFunction(()=>window.requests.filter(r=>r.to==='excel-json').length===2);
 mark('Formula bar preference survives reload and refresh is available from the compact menu');
 await page.evaluate(()=>window.setFile('cached.docx'));
 await page.locator('[data-pdf-preview] canvas[data-painted="true"]').first().waitFor();
 await page.getByRole('button',{name:'预览模式',exact:true}).click();
 await page.getByRole('menuitemradio',{name:'原始预览',exact:true}).waitFor();
 assert.equal(await page.getByRole('menuitemradio',{name:'页面版式',exact:true}).getAttribute('aria-checked'),'true');
 mark('Word with a cached PDF opens in page layout and retains the preview selector');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'validation.json'),JSON.stringify({ok:true,checks,errors,scope:'Actual XLSX parsing, React viewer and PDF.js; controlled async conversion timing, no model calls.'},null,2));
} catch(error){console.log('BROWSER_ERRORS',JSON.stringify(errors));console.log('BODY',await page?.locator('body').innerText());await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error}
finally {await browser?.close();await server?.close();await fs.rm(temporary,{recursive:true,force:true})}
