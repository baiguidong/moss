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
  expect(validateAppManifest(manifest).hostApi).toBe('^2.2.0')
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
