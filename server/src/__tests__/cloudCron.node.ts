import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { createAuthService } from '../auth/service.js'
import { CronRepository, nextCloudCronRun, assertCronUserCanRun } from '../model/repositories/cron.js'
import { SessionRepository } from '../model/repositories/session.js'
import { initializeDatabase } from '../model/index.js'
import { CloudCronScheduler } from '../cronScheduler.js'
import { handleCronHostRequest } from '../cronHostBridge.js'
import { importLegacyCloudCron } from '../cronLegacyImport.js'
import { runCronPrompt } from '../cronRunner.js'
import { RuntimeService } from '../runtimeService.js'
import { SessionTurnLock } from '../sessionTurnLock.js'
import { startServer } from '../server.js'
import type { SessionCreateInput, ServerConfig } from '../types.js'
import { openTestDatabase } from './databaseTestUtils.js'

const root = await mkdtemp(join(tmpdir(), 'moss-cloud-cron-'))
const db = await openTestDatabase(':memory:')
try {
  const { service: auth } = await createAuthService({ db, tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'alice', password: 'test-password', email: 'alice@example.test' } })
  const login = await auth.issueTokenFromPassword({ username: 'alice', password: 'test-password' })
  const alice = (await auth.verifyAccessToken(login.access_token))!
  const bob = (await auth.createUser({ orgId: alice.orgId, name: 'Bob', email: 'bob@example.test', role: 'user', password: 'test-password' }, alice)).user
  const bobKey = await auth.issuePermanentApiKeyForOAuthUser({ userId: bob.id, orgId: alice.orgId })
  const bobLogin = await auth.issueTokenFromApiKey(bobKey.api_key)
  const sessions = new SessionRepository(db)
  async function source(id: string, userId = alice.userId) {
    return sessions.createSession({ sessionId: id, transcriptSessionId: id, transcriptPath: join(root, `${id}.jsonl`),
      userId, orgId: alice.orgId, role: 'user', scopes: ['sessions:create','sessions:list','sessions:attach'], cwd: root,
      runtime: { backend: 'docker', dockerImage: 'fake', profileDir: root, transcriptDir: root }, status: 'active', desiredState: 'active' })
  }
  await source('source'); await source('bob-source', bob.id)
  // Exercise an upgrade from an existing v1 database without changing its sessions.
  await db.exec('DROP TABLE cron_tasks'); await db.exec('DROP TABLE cron_session_links')
  await db.prepare('UPDATE model_schema SET version=1 WHERE id=1').run()
  await initializeDatabase(db)
  assert.ok(await sessions.getSession('source'))
  assert.equal(Number((await db.prepare('SELECT version FROM model_schema WHERE id=1').get())?.version), 4)
  const repo = new CronRepository(db)
  const now = Date.parse('2026-09-24T00:00:00Z')
  assert.equal(nextCloudCronRun('0 9 * * *', now, 'Asia/Shanghai'), now + 3600000)
  assert.throws(() => nextCloudCronRun('* * * * * *', now, 'UTC'))
  assert.throws(() => nextCloudCronRun('* * * * *', now, 'Invalid/Zone'))
  assert.equal(new Date(nextCloudCronRun('0 9 * * *', Date.parse('2026-03-08T00:00:00Z'), 'America/New_York')).toISOString(), '2026-03-08T13:00:00.000Z')

  let response: any
  const handled = await handleCronHostRequest(JSON.stringify({ type: 'control_request', request_id: 'bridge', request: {
    subtype: 'moss_app_event', event: { type: 'server_cron', input: { operation: 'create', userId: bob.id,
      task: { cron: '0 9 * * *', prompt: 'bridge task', timezone: 'Asia/Shanghai' } } },
  } }), 'source', sessions, { writeStdin: text => { response = JSON.parse(text) } })
  assert.equal(handled, true)
  assert.equal(response.response.response.task.userId, alice.userId)
  assert.equal(response.response.response.task.ownerSessionId, 'source')
  await db.exec('DELETE FROM cron_tasks')

  const config: ServerConfig = { host:'127.0.0.1', port:0, authMode:'local', tokenTtlSec:3600,
    bootstrapAdmin:{username:'alice'}, idleTimeoutMs:600000, maxSessions:32, rootDir:root,
    database:{driver:'sqlite', filename:':memory:'}, dataDir:join(root,'data'), runDir:join(root,'run'), logDir:join(root,'log'),
    dockerStopTimeoutSec:1, dockerLabels:{}, startupPolicy:'reattach-or-resume', heartbeatTimeoutMs:30000,
    reattachProbeTimeoutMs:100, resumeOnMissingRuntime:true, logLevel:'error' }
  const runtime = new RuntimeService({ config, store:sessions, serverInstanceId:'fake' })
  const app = startServer(config, runtime, auth)
  try {
    const base = `http://127.0.0.1:${await app.ready}/api/v1`
    const headers = { authorization:`Bearer ${login.access_token}`, 'content-type':'application/json' }
    const other = { authorization:`Bearer ${bobLogin.access_token}` }
    const result = await fetch(`${base}/cron/tasks`, { method:'POST', headers, body:JSON.stringify({
      ownerSessionId:'source', cron:'0 9 * * *', timezone:'Asia/Shanghai', prompt:'API task',
    }) })
    assert.equal(result.status, 201)
    const { task } = await result.json() as any
    assert.equal((await fetch(`${base}/cron/tasks`)).status, 401)
    assert.deepEqual(await (await fetch(`${base}/cron/tasks`,{headers:other})).json(),{tasks:[]})
    assert.equal((await fetch(`${base}/cron/tasks/${task.id}`,{method:'DELETE',headers:other})).status,404)
    assert.equal((await fetch(`${base}/cron/tasks`,{method:'POST',headers,body:JSON.stringify({ownerSessionId:'bob-source',cron:'* * * * *',prompt:'cross-user'})})).status,400)
    assert.equal((await fetch(`${base}/cron/tasks/${task.id}/enabled`,{method:'POST',headers,body:JSON.stringify({enabled:false})})).status,200)
    await source('execution')
    await source('pending-creation')
    await sessions.setSessionLifecycle('pending-creation','creating','active')
    await db.prepare('INSERT INTO cron_session_links (session_id,task_id,source_session_id) VALUES (?,?,?)').run('execution',task.id,'source')
    const listed = await (await fetch(`${base}/sessions`,{headers})).json() as any
    assert.equal(listed.sessions.some((s:any)=>s.sessionId==='pending-creation'),false)
    assert.equal(listed.sessions.find((s:any)=>s.sessionId==='execution').originChannel,'cron')
    assert.equal(listed.sessions.find((s:any)=>s.sessionId==='execution').sourceSessionId,'source')
    assert.equal((await fetch(`${base}/cron/tasks/${task.id}`,{method:'DELETE',headers})).status,200)

    const profile=join(config.dataDir,'profiles','users',alice.userId)
    await mkdir(profile,{recursive:true})
    await writeFile(join(profile,'cron_tasks.json'),JSON.stringify({tasks:[{id:'legacy',cron:'* * * * *',prompt:'legacy',createdAt:now,recurring:true}]}))
    await importLegacyCloudCron(db,config)
    const legacyList=await (await fetch(`${base}/cron/tasks`,{headers})).json() as any
    const legacy=legacyList.tasks.find((t:any)=>t.id.startsWith('legacy:'))!
    assert.equal(legacy.enabled,false); assert.equal(legacy.orphaned,true)
    // Use the same URL encoding as the desktop for IDs returned by the list API.
    const legacyUrl=`${base}/cron/tasks/${encodeURIComponent(legacy.id)}`
    assert.equal((await fetch(legacyUrl,{method:'DELETE',headers:other})).status,404)
    assert.equal((await fetch(`${legacyUrl}/enabled`,{method:'POST',headers,body:JSON.stringify({enabled:false})})).status,200)
    assert.equal((await fetch(legacyUrl,{method:'DELETE',headers})).status,200)
    assert.equal(await repo.get(legacy.id,alice),null)
    await importLegacyCloudCron(db,config)
    assert.equal((await repo.list(alice)).some(t=>t.id.startsWith('legacy:')),false)
    assert.equal((await fetch(`${base}/cron/tasks/%ZZ`,{method:'DELETE',headers})).status,400)
  } finally { await app.stop() }

  let time = now + 10 * 60000, calls = 0, fail = false
  let gate: Promise<void> | undefined
  let beforeCreate: (() => Promise<void>) | undefined
  const fakeRuntime = {
    getSession: (id:string) => sessions.getSession(id),
    createSession: async (input:SessionCreateInput) => {
      await beforeCreate?.()
      const id = randomUUID(); const created = await source(id, input.userId)
      assert.equal(input.cwd, root)
      await db.prepare('INSERT INTO cron_session_links (session_id,task_id,source_session_id) VALUES (?,?,?)')
        .run(id, input.scheduledTask!.taskId, input.scheduledTask!.sourceSessionId)
      return (await sessions.getSession(created.sessionId))!
    },
  } as unknown as RuntimeService
  const scheduler = new CloudCronScheduler(repo, fakeRuntime, owner => assertCronUserCanRun(db,owner), () => {}, () => time,
    async () => { calls++; if (fail) throw new Error('API failed'); await gate })
  const recurring = await repo.create(alice,'source',{cron:'*/5 * * * *',timezone:'UTC',prompt:'report'},now)
  await scheduler.tick(); await scheduler.waitForIdle()
  assert.equal(calls,1)
  const finished = (await repo.get(recurring.id,alice))!
  assert.equal(finished.nextRunAt, now + 15 * 60000)
  const executionId = finished.executionSessionId
  await scheduler.tick(); await scheduler.waitForIdle(); assert.equal(calls,1)
  time += 5 * 60000; await scheduler.tick(); await scheduler.waitForIdle()
  assert.equal((await repo.get(recurring.id,alice))!.executionSessionId,executionId)
  assert.equal(calls,2)
  await repo.remove(recurring.id,alice)

  const one = await repo.create(alice,'source',{cron:'* * * * *',prompt:'one',recurring:false},now)
  fail=true; await scheduler.tick(); await scheduler.waitForIdle()
  assert.equal((await repo.get(one.id,alice))!.status,'failed')
  assert.equal((await repo.get(one.id,alice))!.enabled,false)
  fail=false; assert.equal(await scheduler.launch(one.id,alice),true); await scheduler.waitForIdle()
  assert.equal(await repo.get(one.id,alice),null)

  let release!:()=>void
  gate = new Promise(resolve=>{release=resolve})
  const racing = await repo.create(alice,'source',{cron:'* * * * *',prompt:'racing'},now)
  const results = await Promise.all([scheduler.launch(racing.id,alice),scheduler.launch(racing.id,alice)])
  assert.equal(results.filter(Boolean).length,1)
  // Let asynchronous session setup reach the fake executor before completing it.
  await repo.toggle(racing.id,alice,false,time)
  release(); await scheduler.waitForIdle(); gate=undefined
  assert.equal((await repo.get(racing.id,alice))!.enabled,false)
  await repo.remove(racing.id,alice)

  // Deleting a running task hides it immediately but cannot free its run quota.
  const deleting = await repo.create(alice,'source',{cron:'* * * * *',prompt:'deleting'},now)
  const active = (await repo.claim(deleting.id,alice,'host',true,time))!
  assert.ok(active)
  await repo.remove(deleting.id,alice)
  assert.equal(await repo.get(deleting.id,alice),null)
  assert.equal((await repo.list(alice)).some(task => task.id === deleting.id),false)
  const waiting = await repo.create(alice,'source',{cron:'* * * * *',prompt:'waiting'},now)
  assert.equal(await repo.claim(waiting.id,alice,'host',true,time),null)
  await repo.finish(active,null,time)
  assert.equal(await db.prepare('SELECT id FROM cron_tasks WHERE id=?').get(deleting.id),undefined)
  const next = (await repo.claim(waiting.id,alice,'host',true,time))!
  assert.ok(next)
  await repo.remove(waiting.id,alice)
  await repo.recover(time+90001)
  assert.equal(await db.prepare('SELECT id FROM cron_tasks WHERE id=?').get(waiting.id),undefined)

  // A deletion during async session setup must also release its retained lease.
  let creationStarted!: () => void
  let finishCreation!: () => void
  const creationReady = new Promise<void>(resolve => { creationStarted = resolve })
  const creationGate = new Promise<void>(resolve => { finishCreation = resolve })
  beforeCreate = async () => { creationStarted(); await creationGate }
  const cancelled = await repo.create(alice,'source',{cron:'* * * * *',prompt:'cancel setup'},now)
  const callsBeforeCancel = calls
  assert.equal(await scheduler.launch(cancelled.id,alice),true)
  await creationReady
  await repo.remove(cancelled.id,alice)
  finishCreation()
  await scheduler.waitForIdle()
  beforeCreate = undefined
  assert.equal(calls,callsBeforeCancel)
  assert.equal(await db.prepare('SELECT id FROM cron_tasks WHERE id=?').get(cancelled.id),undefined)

  const crashed = await repo.create(alice,'source',{cron:'* * * * *',prompt:'crashed'},now)
  await repo.claim(crashed.id,alice,'old-host',true,now)
  await repo.recover(now+90001)
  assert.equal((await repo.get(crashed.id,alice))!.status,'failed')
  assert.equal((await repo.get(crashed.id,alice))!.enabled,false)
  await scheduler.stop()

  // Real sockets, fake Agent: verifies offline driving and handling of approval requests.
  const executionPrompt = '执行 df 命令，并将完整结果发送给我'
  for (const mode of ['success','approval','disconnect']) {
    const server=net.createServer(socket=>{
      let buffer=''
      socket.on('data',chunk=>{
        buffer+=chunk.toString(); let n
        while((n=buffer.indexOf('\n'))>=0) {
          const message=JSON.parse(buffer.slice(0,n)); buffer=buffer.slice(n+1)
          if(message.type==='stdin' && JSON.parse(message.data).type==='user') {
            assert.equal(JSON.parse(message.data).message.content, executionPrompt)
            if(mode==='disconnect') { socket.destroy(); return }
            socket.write(JSON.stringify({type:'stdout',line:JSON.stringify(mode==='approval'
              ? {type:'control_request',request_id:'approval',request:{subtype:'can_use_tool'}}
              : {type:'result',is_error:false,subtype:'success'})})+'\n')
          }
          if(message.type==='interrupt') socket.write(JSON.stringify({type:'stdout',line:JSON.stringify({type:'result',is_error:true})})+'\n')
        }
      })
    })
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const port=(server.address() as net.AddressInfo).port
    const lock=new SessionTurnLock()
    const runner={ acquireSessionTurn:(id:string)=>lock.acquire(id), ensureSessionReady:async()=>({attempt:{}}),
      connectToAttempt:async()=>new Promise<net.Socket>(resolve=>{const socket=net.createConnection({port,host:'127.0.0.1'},()=>resolve(socket))}) } as unknown as RuntimeService
    try {
      const result=runCronPrompt(runner,'fake',executionPrompt,AbortSignal.timeout(2000))
      if(mode==='success') await result
      else await assert.rejects(result,mode==='approval'?/人工确认/:/中断/)
    } finally { await new Promise<void>(resolve=>server.close(()=>resolve())) }
  }
  console.log('cloud cron: migration, ownership/API isolation, host bridge, lifecycle, restart, and offline runner passed')
} finally { await db.close(); await rm(root,{recursive:true,force:true}) }
