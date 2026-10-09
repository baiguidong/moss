import { expect, test } from 'bun:test'
import { createCloudStorageClient, validateCloudStorageHostInput, MOSS_CLOUD_STORAGE_PROTOCOL } from '../../packages/app-sdk/src/index.mjs'
import { AppHostCapabilityRegistry, createCloudStorageProtocolDefinition, validateAppManifest } from '../../packages/app-runtime/src/index.mjs'
import { readFile } from 'node:fs/promises'

test('cloud capability requires grants and cannot override identity or pass file paths', async () => {
  const registry = new AppHostCapabilityRegistry()
  registry.registerProtocol(createCloudStorageProtocolDefinition())
  registry.registerHandler(MOSS_CLOUD_STORAGE_PROTOCOL, 'uploads.start', async () => ({ transferId: 'transfer-1' }))
  const request:any = {
    appId:'example.cloud-storage',instanceId:'default',requestId:'r1',protocol:MOSS_CLOUD_STORAGE_PROTOCOL,
    method:'uploads.start',input:{handle:'opaque-handle'},protocols:[MOSS_CLOUD_STORAGE_PROTOCOL],
    permissions:['cloud-storage:write'],grants:['cloud-storage:write'],
    owner:{scope:'host-local',key:'host-local'},principal:{scope:'host-local',key:'host-local'},
  }
  expect(await registry.dispatch(request)).toEqual({transferId:'transfer-1'})
  await expect(registry.dispatch({...request,grants:[]})).rejects.toMatchObject({code:'APP_PERMISSION_DENIED'})
  for(const field of ['orgId','userId','appId','path','objectKey','bucket']) {
    expect(()=>validateCloudStorageHostInput('uploads.start',{handle:'handle',[field]:'injected'})).toThrow()
  }
  expect(()=>validateCloudStorageHostInput('files.list',{limit:100000})).toThrow()
  const manifest=JSON.parse(await readFile(new URL('../../examples/cloud-storage-app/app.moss.json',import.meta.url),'utf8'))
  expect(validateAppManifest(manifest).hostApi).toBe('^3.0.0')
})

test('typed cloud helper dispatches methods and subscribes to named Host events', async () => {
  const calls:any[]=[]
  const cloud=createCloudStorageClient({request:async (...args:any[])=>{calls.push(args);return {state:'ready'}},on:(...args:any[])=>{calls.push(args);return ()=>{}}})
  expect(await cloud.request('status.get')).toEqual({state:'ready'})
  const listener=()=>{}
  const unsubscribe=cloud.on('transfers.progress',listener)
  expect(calls[0]).toEqual([MOSS_CLOUD_STORAGE_PROTOCOL,'status.get',{},undefined])
  expect(calls[1]).toEqual([MOSS_CLOUD_STORAGE_PROTOCOL,'transfers.progress',listener])
  unsubscribe()
})

test('metadata disk failure pauses a task before any upload and permits shutdown', async () => {
  const { CloudStorageHost } = await import('../src/apps/cloud-storage.mjs')
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root=await mkdtemp(join(tmpdir(),'moss-cloud-full-'))
  let requests=0
  const host=new CloudStorageHost({
    directory:join(root,'transfers'),getSettings:()=>({remoteEnabled:true,remoteDirect:{serverUrl:'http://server.test',credentialMode:'api-key',apiKey:'test'}}),
    resolveConnection:async()=>({serverUrl:'http://server.test',userId:'u',orgId:'o',authToken:'token'}),
    fetchImpl:async()=>{requests++;throw new Error('Must not upload')},
    pickFiles:async()=>[join(root,'source')],pickDestination:async()=>null,authorizeApp:async()=>true,
  })
  try {
    await writeFile(join(root,'source'),'data')
    const context={appId:'example',instanceId:'default'}
    const selected=await host.handle('local-files.pick',{},context)
    host.persist=()=>{throw Object.assign(new Error('full'),{code:'ENOSPC'})}
    const created=await host.handle('uploads.start',{handle:selected.files[0].handle},context)
    const task=await host.handle('transfers.get',{transferId:created.transferId},context)
    expect(task.state).toBe('paused');expect(task.error).toBe('ENOSPC');expect(requests).toBe(0)
    await host.close()
  } finally { await host.close();await rm(root,{recursive:true,force:true}) }
})

test('sharing requires its own permission and validates codes, expiration and private input fields', async () => {
  const registry = new AppHostCapabilityRegistry()
  registry.registerProtocol(createCloudStorageProtocolDefinition())
  registry.registerHandler(MOSS_CLOUD_STORAGE_PROTOCOL, 'shares.list', async () => ({ shares: [], nextCursor: null }))
  const request:any = { appId:'example.drive',instanceId:'default',requestId:'share-list',protocol:MOSS_CLOUD_STORAGE_PROTOCOL,
    method:'shares.list',input:{},protocols:[MOSS_CLOUD_STORAGE_PROTOCOL],permissions:['cloud-storage:share'],grants:[],
    owner:{scope:'host-local',key:'host-local'},principal:{scope:'host-local',key:'host-local'} }
  await expect(registry.dispatch(request)).rejects.toMatchObject({code:'APP_PERMISSION_DENIED'})
  expect(await registry.dispatch({...request,grants:['cloud-storage:share']})).toEqual({shares:[],nextCursor:null})
  const settings = {fileId:'f',requestKey:'key',expiresAt:null}
  expect(validateCloudStorageHostInput('shares.create',settings)).toEqual(settings)
  for (const patch of [{accessCode:'a'}, {expiresAt:-1}, {ownerUserId:'other'}, {url:'https://other'}, {requestKey:''}])
    expect(()=>validateCloudStorageHostInput('shares.create',{...settings,...patch})).toThrow()
})

test('Host normalizes public share URLs without exposing login credentials and reports old servers', async () => {
  const { CloudStorageHost } = await import('../src/apps/cloud-storage.mjs')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root=await mkdtemp(join(tmpdir(),'moss-share-host-'))
  const requests:any[]=[]
  let old=false, user='u'
  const host=new CloudStorageHost({directory:root,getSettings:()=>({remoteEnabled:true,remoteDirect:{serverUrl:'https://files.test',credentialMode:'api-key',apiKey:'private-key'}}),
    resolveConnection:async()=>({serverUrl:'https://files.test',userId:user,orgId:'o',authToken:'private-token'}),
    fetchImpl:async (url:any, init:any)=>{requests.push({url,init});return old ? Response.json({error:{code:'NOT_FOUND'}},{status:404}) : Response.json({shares:[{id:'s',url:'/s/public-token'}],nextCursor:null})},
    pickFiles:async()=>[],pickDestination:async()=>null,authorizeApp:async()=>true})
  try {
    const result=await host.handle('shares.list',{}, {appId:'drive',instanceId:'default'})
    expect(result.shares[0].url).toBe('https://files.test/s/public-token')
    expect(JSON.stringify(result)).not.toContain('private-token')
    expect(requests[0].init.headers.authorization).toBe('Bearer private-token')
    old=true
    await expect(host.handle('shares.list',{}, {appId:'drive',instanceId:'default'})).rejects.toMatchObject({code:'SHARING_UNSUPPORTED'})
  } finally {await host.close();await rm(root,{recursive:true,force:true})}
})
