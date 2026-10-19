import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = await fs.mkdtemp(path.join(root, 'tests', '.web-recovery-'));
let vite, browser;
try {
  await fs.writeFile(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="./main.tsx"></script>');
  await fs.writeFile(path.join(fixture, 'main.tsx'), `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { usePreviewDocument } from '@/lib/use-preview-document'; import { WebInteractions } from '@/components/web-interactions';
    const listeners = new Map(); window.items = []; window.responses = []; window.uploads = [];
    window.changed = () => { for(const fn of listeners.get('web:interactions-changed') || []) fn(); };
    window.mossWeb = { identity: {userId:'owner',hostId:'host'}, uploadFile: async file => { window.uploads.push({type:file.type,size:file.size}); return {path:'/uploaded/screenshot.png'}; } };
    window.hostContent = 'original'; window.generation = 1; window.acquireClients = [];
    window.agentDesktop = {
      ipcOn(name,fn) { if(!listeners.has(name))listeners.set(name,new Set()); listeners.get(name).add(fn); return fn; },
      ipcOff(name,fn) { listeners.get(name)?.delete(fn); },
      async ipcInvoke(name,input) { if(name==='web:interactions-list')return [...window.items]; if(name==='web:interactions-respond'){ window.responses.push(input); window.items=window.items.filter(item=>item.id!==input.id); window.changed(); return {ok:true}; } throw Error(name); },
      previewDocument: {
        on() { return ()=>{}; },
        async acquire(input) { window.acquireClients.push(input.clientId); const state={id:'doc',owner:input.clientId,client:input.clientId,generation:window.generation,sequence:window.generation,content:window.hostContent,originalContent:window.hostContent,dirty:false}; if(window.holdAcquire){window.holdAcquire=false; await new Promise(resolve=>window.finishAcquire=resolve);} return state; },
        async update(input) { if(window.holdUpdate){window.holdUpdate=false; await new Promise((_,reject)=>window.rejectUpdate=reject);} window.hostContent=input.content; return {}; },
        async save(input) { const result={state:{id:'doc',owner:input.clientId,client:input.clientId,generation:input.generation,sequence:99,content:window.hostContent,originalContent:window.hostContent,dirty:false}}; if(window.holdSave){window.holdSave=false; await new Promise(resolve=>window.finishSave=resolve);} return result; },
        async release() {}, async acknowledge() {},
      },
    };
    window.captureMode='grant'; window.streams=[];
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
      if(window.captureMode==='deny')throw new DOMException('Denied','NotAllowedError');
      if(window.captureMode==='pending')await new Promise(resolve=>window.finishCapture=resolve);
      const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;
      const stream=canvas.captureStream(10);window.streams.push(stream);
      setTimeout(()=>{canvas.getContext('2d').fillRect(0,0,80,60);stream.getVideoTracks()[0].requestFrame?.();},20);return stream;
    }});
    function Harness(){ const [file,setFile]=React.useState({path:'/cloud/note.md',content:'original',contentType:'markdown',metadata:{sessionId:'test'}});
      const doc=usePreviewDocument(file,(_,patch)=>setFile(value=>({...value,...patch})));
      return <><textarea aria-label="编辑内容" disabled={!doc.file.metadata.previewEditable} value={doc.file.content} onChange={e=>doc.update(file.path,{content:e.target.value})}/><button onClick={()=>void doc.save()}>保存</button><p data-notice>{doc.notice}</p>{doc.recovery&&<div data-recovery><p>{doc.recovery.local}</p><p>{doc.recovery.host}</p><button onClick={doc.restoreRecovery}>恢复草稿</button></div>}<WebInteractions/></>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `);
  vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { port: 0, hmr: false } }); await vite.listen();
  browser = await chromium.launch({ channel: process.env.MOSS_WEB_TEST_BROWSER || 'chrome', headless: true });
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://localhost:${vite.httpServer.address().port}/tests/${path.basename(fixture)}/index.html`);
  const editor = page.getByRole('textbox', { name: '编辑内容' }); await page.waitForFunction(() => document.querySelector('textarea')?.disabled === false);
  await page.evaluate(() => { window.holdUpdate = true; }); await editor.fill('未同步的本地修改'); await page.waitForFunction(() => !!window.rejectUpdate);
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('moss:connection', { detail: 'reconnecting' })); }); assert.equal(await editor.isDisabled(), true);
  await page.evaluate(() => { window.hostContent = '另一标签更新'; window.generation++; window.rejectUpdate(Error('Disconnected')); window.dispatchEvent(new Event('moss:reconnected')); });
  await page.locator('[data-recovery]').waitFor(); assert.equal(await editor.inputValue(), '另一标签更新'); assert.match(await page.locator('[data-recovery]').textContent(), /未同步的本地修改/);
  const clients = await page.evaluate(() => window.acquireClients); assert.notEqual(clients[0], clients.at(-1));
  await page.getByRole('button', { name: '恢复草稿' }).click(); await page.waitForFunction(() => window.hostContent === '未同步的本地修改');
  await page.evaluate(() => { window.holdSave = true; }); await page.getByRole('button', { name: '保存', exact: true }).click(); await page.waitForFunction(() => !!window.finishSave);
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('moss:connection', { detail: 'reconnecting' })); window.hostContent = '重连后的权威内容'; window.generation++; window.dispatchEvent(new Event('moss:reconnected')); window.finishSave(); });
  await page.waitForFunction(() => document.querySelector('textarea').value === '重连后的权威内容');
  await page.evaluate(() => { window.holdAcquire = true; window.dispatchEvent(new Event('moss:reconnected')); }); await page.waitForFunction(() => !!window.finishAcquire);
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('moss:connection', { detail: 'reconnecting' })); window.finishAcquire(); });
  await page.waitForFunction(() => document.querySelector('textarea').disabled); assert.equal(await editor.inputValue(), '重连后的权威内容');
  await page.evaluate(() => window.dispatchEvent(new Event('moss:reconnected'))); await page.waitForFunction(() => !document.querySelector('textarea').disabled);
  const screen = async (id, mode) => { await page.evaluate(({ id, mode }) => { window.captureMode = mode; window.items = [{ id, kind: 'screen', input: { title: 'App 请求截图' } }]; window.changed(); }, { id, mode }); await page.getByRole('button', { name: '继续', exact: true }).click(); };
  await screen('granted', 'grant'); await page.waitForFunction(() => window.responses.some(row => row.id === 'granted'));
  assert.deepEqual(await page.evaluate(() => window.responses[0].result), ['/uploaded/screenshot.png']);
  assert.equal(await page.evaluate(() => window.uploads[0].type), 'image/png'); assert.ok(await page.evaluate(() => window.uploads[0].size > 0));
  assert.equal(await page.evaluate(() => window.streams[0].getTracks().every(track => track.readyState === 'ended')), true);
  await screen('denied', 'deny'); await page.waitForFunction(() => window.responses.some(row => row.id === 'denied'));
  assert.equal(await page.evaluate(() => window.responses.find(row => row.id === 'denied').result), null);
  await screen('canceled', 'pending'); await page.waitForFunction(() => !!window.finishCapture);
  await page.evaluate(() => { window.items = []; window.changed(); }); await page.getByRole('button', { name: '继续', exact: true }).waitFor({ state: 'hidden' });
  await page.evaluate(() => window.finishCapture()); await page.waitForFunction(() => window.streams.length === 2 && window.streams[1].getTracks().every(track => track.readyState === 'ended'));
  assert.equal(await page.evaluate(() => window.uploads.length), 1); assert.deepEqual(errors, []);
  console.log('Chrome components: reconnect ownership, unsynced conflict recovery, stale save/acquire rejection, screenshot grant/deny/cancel and stream cleanup passed. Device streams and delayed Host replies were controlled fixtures.');
} finally { await browser?.close(); await vite?.close(); await fs.rm(fixture, { recursive: true, force: true }); }
