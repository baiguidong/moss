import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext, runWithSessionContextOverridesGenerator } from './sessionIdContext.js'
import { addCronTask, getCronFilePath, listAllCronTasks, nextCronRunMs, removeCronTasks } from './cronTasks.js'
import { readCronTaskStore, updateCronTaskStore } from '../../shared/cron-task-store.mjs'
import { CronListTool } from '../tools/ScheduleCronTool/CronListTool.js'
import { CronCreateTool } from '../tools/ScheduleCronTool/CronCreateTool.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'moss-desktop-cron-'))
  roots.push(root)
  const file = join(root, 'cron_tasks.json')
  const scope = <T>(owner: string, fn: () => T, hostId = 'desktop-1') => runWithSessionIdContext(
    asSessionId(`runtime-${owner}`), null, fn,
    { kind: 'session', sessionId: owner }, { MOSS_CONFIG_DIR: root },
    { executionEnvironment: 'desktop', desktopCronHostId: hostId },
  )
  return { root, file, scope }
}

describe('desktop cron storage', () => {
  test('always persists desktop tasks with exact ownership, including legacy durable:false calls', async () => {
    const f = await setup()
    const transient = await f.scope('one', () => addCronTask('*/5 * * * *', 'once', true, false))
    const durable = await f.scope('two', () => addCronTask('*/5 * * * *', 'persist', true, true))
    expect((await readCronTaskStore(f.file)).find(task => task.id === transient)).toMatchObject({ durable: true, ownerSessionId: 'one', desktopHostId: 'desktop-1' })
    expect((await readCronTaskStore(f.file)).find(task => task.id === durable)).toMatchObject({ durable: true, ownerSessionId: 'two' })
    expect(f.scope('one', () => getCronFilePath())).toBe(f.file)
    expect((await f.scope('one', () => listAllCronTasks())).map(task => task.id)).toEqual([transient])
    expect((await f.scope('one', () => listAllCronTasks(), 'desktop-2')).map(task => task.id)).toEqual([transient])
    expect((await f.scope('two', () => listAllCronTasks(), 'desktop-2')).map(task => task.id)).toEqual([durable])
    await expect(access(join(f.root, '.moss', 'scheduled_tasks.json'))).rejects.toThrow()
  })

  test.each([undefined, false, true])('CronCreate persists one task with its deadline when durable is %s', async durable => {
    const f = await setup()
    const expiresAt = Date.now() + 60 * 60_000
    await f.scope('one', async () => {
      const input = CronCreateTool.inputSchema.parse({ cron: '*/5 * * * *', prompt: '喝水提醒', expires_at: new Date(expiresAt).toISOString(), ...(durable === undefined ? {} : { durable }) })
      expect(await CronCreateTool.validateInput(input)).toEqual({ result: true })
      const result = await CronCreateTool.call(input)
      expect(result.data).toMatchObject({ durable: true, recurring: true, expiresAt })
      expect(CronCreateTool.mapToolResultToToolResultBlockParam(result.data, 'create').content).toContain('survives restarts')
      const tasks = await readCronTaskStore(f.file)
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({ id: result.data.id, prompt: '喝水提醒', expiresAt, durable: true })
    })
    const listed = await f.scope('one', () => CronListTool.call(), 'desktop-2')
    expect(listed.data.jobs).toHaveLength(1)
    expect(listed.data.jobs[0]).toMatchObject({ expiresAt, prompt: '喝水提醒' })
  })

  test('rejects invalid, past, or unreachable deadlines without writing a task', async () => {
    const f = await setup()
    const input = { cron: '*/5 * * * *', prompt: '喝水提醒' }
    expect(CronCreateTool.inputSchema.safeParse({ ...input, expires_at: '2026-11-05T00:00:00' }).success).toBe(false)
    expect(CronCreateTool.inputSchema.safeParse({ ...input, expires_at: 'not-a-date' }).success).toBe(false)
    await f.scope('one', async () => {
      for (const expiresAt of [Date.now() - 1, nextCronRunMs(input.cron, Date.now())!]) {
        expect(await CronCreateTool.validateInput({ ...input, expires_at: new Date(expiresAt).toISOString() })).toMatchObject({ result: false, errorCode: 6 })
        await expect(addCronTask(input.cron, input.prompt, true, false, undefined, undefined, expiresAt)).rejects.toThrow('before its future expiry')
      }
      await expect(addCronTask(input.cron, input.prompt, true, false, undefined, undefined, NaN)).rejects.toThrow()
    })
    expect(await readCronTaskStore(f.file)).toEqual([])
  })

  test('retained expired records do not consume the active job limit', async () => {
    const f = await setup()
    await updateCronTaskStore(f.file, tasks => tasks.push(...Array.from({ length: 50 }, (_, index) => ({ id: `expired-${index}`, ownerSessionId: 'one', cron: '* * * * *', expiresAt: Date.now() - 1 }))))
    expect(await f.scope('one', () => CronCreateTool.validateInput({ cron: '* * * * *', prompt: 'new reminder' }))).toEqual({ result: true })
  })

  test('lists legacy session-only tasks as persistent after a host restart', async () => {
    const f = await setup()
    await updateCronTaskStore(f.file, tasks => tasks.push({ id: 'legacy', ownerSessionId: 'one', desktopHostId: 'old-host', durable: false, cron: '* * * * *', prompt: 'legacy reminder' }))
    const listed = await f.scope('one', () => CronListTool.call(), 'new-host')
    expect(listed.data.jobs).toHaveLength(1)
    expect(CronListTool.mapToolResultToToolResultBlockParam(listed.data, 'list').content).not.toContain('session-only')
  })

  test('Agent list/delete and desktop use the same authoritative file', async () => {
    const f = await setup()
    const id = await f.scope('one', () => addCronTask('*/5 * * * *', 'report', true, true))
    await updateCronTaskStore(f.file, tasks => Object.assign(tasks[0], { enabled: false, status: 'failed', lastError: 'API failed' }))
    const result = await f.scope('one', () => CronListTool.call())
    expect(result.data.jobs[0]).toMatchObject({ enabled: false, status: 'failed', lastError: 'API failed' })
    await f.scope('two', () => removeCronTasks([id]))
    expect(await readCronTaskStore(f.file)).toHaveLength(1)
    await updateCronTaskStore(f.file, tasks => tasks.splice(0, 1))
    expect(await f.scope('one', () => listAllCronTasks())).toEqual([])
  })

  test('parallel creators cannot overwrite one another or mix owning sessions', async () => {
    const f = await setup()
    const ids = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      f.scope(`owner-${index}`, () => addCronTask('* * * * *', `task-${index}`, true, true)),
    ))
    const tasks = await readCronTaskStore(f.file)
    expect(tasks).toHaveLength(12)
    for (let index = 0; index < ids.length; index++) expect(tasks.find(task => task.id === ids[index])?.ownerSessionId).toBe(`owner-${index}`)
  })

  test('worker environment overrides retain the desktop scheduler identity', async () => {
    const f = await setup()
    await f.scope('one', async () => {
      const stream = runWithSessionContextOverridesGenerator({ environment: { MOSS_CONFIG_DIR: f.root } }, async function* () {
        yield await addCronTask('* * * * *', 'worker reminder', true, false, 'worker-1')
      })
      for await (const id of stream) expect((await readCronTaskStore(f.file)).find(task => task.id === id)).toMatchObject({ ownerSessionId: 'one', desktopHostId: 'desktop-1', agentId: 'worker-1', durable: true })
    })
  })
})

test.each(['server', 'cli'])('does not silently ignore a desktop deadline in %s', async environment => {
  const f = await setup()
  const calls: unknown[] = []
  const cron = environment === 'server' ? {
    create: async (input: unknown) => { calls.push(input); return { id: 'server-job' } },
    list: async () => [], remove: async () => {},
  } : undefined
  await runWithSessionIdContext(asSessionId('other-host'), null, async () => {
    const expiresAt = Date.now() + 60 * 60_000
    expect(await CronCreateTool.validateInput({ cron: '* * * * *', prompt: 'test', expires_at: new Date(expiresAt).toISOString() })).toMatchObject({ result: false, errorCode: 5 })
    await expect(addCronTask('* * * * *', 'test', true, true, undefined, undefined, expiresAt)).rejects.toThrow('Moss Desktop')
  }, { kind: 'session', sessionId: 'other-host' }, { MOSS_CONFIG_DIR: f.root }, environment === 'server' ? { executionEnvironment: 'server', cron } : undefined)
  expect(calls).toEqual([])
  expect(await readCronTaskStore(f.file)).toEqual([])
})

test('server host provider owns cloud persistence without desktop storage', async () => {
  const f = await setup()
  const calls: unknown[] = []
  const cron = {
    create: async (input: unknown) => { calls.push(input); return { id: 'server-job' } },
    list: async () => [{ id: 'server-job', cron: '* * * * *', prompt: 'cloud', createdAt: 1, durable: true }],
    remove: async (ids: string[]) => { calls.push(ids) },
  }
  await runWithSessionIdContext(asSessionId('server'), null, async () => {
    expect(await addCronTask('* * * * *', 'cloud', true, false, undefined, 'Asia/Shanghai')).toBe('server-job')
    expect((await listAllCronTasks())[0].id).toBe('server-job')
    await removeCronTasks(['server-job'])
  }, { kind: 'session', sessionId: 'server' }, { MOSS_CONFIG_DIR: f.root }, { executionEnvironment: 'server', cron })
  expect(calls).toEqual([{ cron:'* * * * *', prompt:'cloud', recurring:true, agentId:undefined, timezone:'Asia/Shanghai' }, ['server-job']])
  await expect(access(f.file)).rejects.toThrow()
})
