import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMossSettingsService, redactConfiguration } from '../src/moss-settings-service.mjs'
import { createMossSettingsAdapters } from '../src/moss-settings-adapters.mjs'
import { createDesktopSettingsStore } from '../src/desktop-settings.mjs'

function fixture(t, options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'moss-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  let values={enabled:true,level:1,nested:{keep:1},env:{TOKEN:'private'},apiKey:'private'}, writes=0, confirms=0
  const adapters={test:{title:'Test',scopes:['user'],resolve:i=>({id:i.target||'user',scope:'user'}),read:()=>({values:structuredClone(values)}),validate:next=>{if(next.level<0)throw new Error('invalid level')},apply:next=>{values=structuredClone(next);writes++}}}
  const make=()=>createMossSettingsService({adapters,receiptsPath:path.join(root,'receipts.json'),confirm:async change=>{confirms++;return options.confirm?.(change)??true}})
  let service=make()
  const context={appId:'app.one',owner:{key:'owner'}}
  const read=()=>service.handle('read',{domain:'test'},context)
  const apply=async(changes,extra={})=>service.handle('apply',{domain:'test',revision:(await read()).revision,requestId:`request-${writes}-${Math.random()}`,changes,...extra},context)
  return {read,apply,context,adapters,root,service,get values(){return values},get writes(){return writes},get confirms(){return confirms},restart(){service=make();this.service=service},setValues(next){values=next}}
}
test('revision protection, idempotence and undo survive restart',async t=>{
  const f=fixture(t), initial=await f.read()
  const input={domain:'test',revision:initial.revision,requestId:'one',changes:[{path:'level',value:2}]}
  const receipt=await f.service.handle('apply',input,f.context)
  f.restart();assert.deepEqual(await f.service.handle('apply',input,f.context),receipt);assert.equal(f.writes,1)
  await assert.rejects(()=>f.service.handle('apply',{...input,requestId:'stale',changes:[{path:'level',value:3}]},f.context),/配置已被修改/)
  const undo={receiptId:receipt.receiptId,requestId:'undo'}
  const reverted=await f.service.handle('undo',undo,f.context);assert.equal(f.values.level,1)
  assert.deepEqual(await f.service.handle('undo',undo,f.context),reverted)
  await assert.rejects(()=>f.service.handle('undo',undo,{appId:'another'}),/回执不存在/)
})
test('preview and rejected validation do not mutate; confirmation rechecks state',async t=>{
  const f=fixture(t)
  const preview=await f.apply([{path:'permissionMode',value:'default'}],{preview:true})
  assert.equal(preview.requiresConfirmation,true);assert.equal(f.writes,0);assert.equal(f.confirms,0)
  await assert.rejects(()=>f.apply([{path:'level',value:-1}]),/invalid level/)
  const g=fixture(t,{confirm:()=>{g.setValues({...g.values,level:99});return true}})
  await assert.rejects(()=>g.apply([{path:'permissionMode',value:'default'}]),/确认期间/);assert.equal(g.writes,0)
})
test('blocks credential exposure, prototype paths, overlapping writes and destructive container replacement',async t=>{
  const f=fixture(t), read=JSON.stringify(await f.read());assert.ok(!read.includes('private'))
  assert.equal(redactConfiguration({thinkingBudgetTokens:1000}).thinkingBudgetTokens,1000)
  for(const changes of [[{path:'__proto__.polluted',value:1}],[{path:'env.TOKEN',value:'x'}],[{path:'env',remove:true}],[{path:'nested',value:{token:'x'}}],[{path:'nested',value:{}},{path:'nested.keep',value:2}]]) await assert.rejects(()=>f.apply(changes))
  assert.equal(f.writes,0);assert.equal({}.polluted,undefined)
})
test('undo refuses to overwrite a later edit and supports deleted fields',async t=>{
  const f=fixture(t),receipt=await f.apply([{path:'nested.keep',remove:true}]);assert.deepEqual(f.values.nested,{})
  await f.service.handle('undo',{receiptId:receipt.receiptId,requestId:'undo'},f.context);assert.equal(f.values.nested.keep,1)
  const next=await f.apply([{path:'level',value:2}]);f.setValues({...f.values,level:3})
  await assert.rejects(()=>f.service.handle('undo',{receiptId:next.receiptId,requestId:'later'},f.context),/后来又被修改/)
})
test('a interrupted commit is reconciled from the durable receipt',async t=>{
  const f=fixture(t)
  const original=f.adapters.test.apply
  f.adapters.test.apply=next=>{original(next);throw new Error('crash after write')}
  const input={domain:'test',revision:(await f.read()).revision,requestId:'crash',changes:[{path:'level',value:4}]}
  await assert.rejects(()=>f.service.handle('apply',input,f.context),/crash/)
  f.restart();const recovered=await f.service.handle('apply',input,f.context);assert.equal(recovered.status,'saved');assert.equal(f.writes,1)
})
test('Desktop applies actual normalized values and preserves unrelated Agent and model fields',async t=>{
  const f=fixture(t),file=path.join(f.root,'settings.json')
  fs.writeFileSync(file,JSON.stringify({models:{text:{model:'existing-model',apiKey:'keep-secret'}},hooks:{Stop:[]},custom:{preserve:true}}))
  const store=createDesktopSettingsStore({settingsPath:file})
  const adapters=createMossSettingsAdapters({getDesktop:()=>store.reload().value,applyDesktop:p=>store.save({...store.value,...p}),defaultWorkspace:f.root,getTargets:async()=>[]})
  const service=createMossSettingsService({adapters,receiptsPath:path.join(f.root,'desktop-receipts.json')})
  const input={domain:'desktop'}, read=await service.handle('read',input)
  await service.handle('apply',{...input,revision:read.revision,requestId:'appearance',changes:[{path:'appearance.themeMode',value:'dark'}]})
  const disk=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(disk.appearance.themeMode,'dark');assert.equal(disk.models.text.model,'existing-model');assert.equal(disk.models.text.apiKey,'keep-secret');assert.deepEqual(disk.hooks,{Stop:[]});assert.deepEqual(disk.custom,{preserve:true})
  await assert.rejects(async()=>service.handle('apply',{...input,revision:(await service.handle('read',input)).revision,requestId:'bad',changes:[{path:'appearance.chatFontSize',value:200}]}),/<= 18/)
})
test('unrestricted writes and undo require a grant and skip only confirmation',async t=>{
  const f=fixture(t),input={approvalMode:'unrestricted'}
  await assert.rejects(()=>f.apply([{path:'permissionMode',value:'default'}],input),/未获授/)
  f.context.grants=['settings:write:unrestricted']
  const receipt=await f.apply([{path:'permissionMode',value:'default'}],input)
  assert.equal(f.confirms,0);assert.equal(f.values.permissionMode,'default')
  await f.service.handle('undo',{receiptId:receipt.receiptId,requestId:'full-undo',...input},f.context)
  assert.equal(f.confirms,0);assert.equal(f.values.permissionMode,undefined)
  await assert.rejects(()=>f.apply([{path:'env.TOKEN',value:'secret'}],input),/密钥/)
  await f.apply([{path:'permissionMode',value:'acceptEdits'}],{approvalMode:'confirm'})
  assert.equal(f.confirms,1)
})
test('catalog provides readable Chinese labels and searchable feature groups',async t=>{
  const f=fixture(t);f.adapters.preferences={title:'终端',scopes:['user'],schema:()=>({properties:{theme:{type:'string'},editorMode:{type:'string'},verbose:{type:'boolean'}}})}
  const {domains}=await f.service.handle('catalog',{domain:'preferences'},f.context)
  assert.deepEqual(domains[0].fields.map(f=>f.label),['终端配色','终端编辑快捷键','详细输出'])
  assert.equal((await f.service.handle('catalog',{domain:'preferences',query:'快捷键'},f.context)).domains[0].fields[0].key,'editorMode')
})
