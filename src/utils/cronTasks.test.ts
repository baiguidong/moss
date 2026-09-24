import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext, runWithSessionContextOverridesGenerator } from './sessionIdContext.js'
import { addCronTask, getCronFilePath, listAllCronTasks, removeCronTasks } from './cronTasks.js'
import { readCronTaskStore, updateCronTaskStore } from '../../shared/cron-task-store.mjs'
import { CronListTool } from '../tools/ScheduleCronTool/CronListTool.js'

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
  test('records exact ownership and durability at creation, without a separate project copy', async () => {
    const f = await setup()
    const transient = await f.scope('one', () => addCronTask('*/5 * * * *', 'once', true, false))
    const durable = await f.scope('two', () => addCronTask('*/5 * * * *', 'persist', true, true))
    expect((await readCronTaskStore(f.file)).find(task => task.id === transient)).toMatchObject({ durable: false, ownerSessionId: 'one', desktopHostId: 'desktop-1' })
    expect((await readCronTaskStore(f.file)).find(task => task.id === durable)).toMatchObject({ durable: true, ownerSessionId: 'two' })
    expect(f.scope('one', () => getCronFilePath())).toBe(f.file)
    expect((await f.scope('one', () => listAllCronTasks())).map(task => task.id)).toEqual([transient])
    expect(await f.scope('one', () => listAllCronTasks(), 'desktop-2')).toEqual([])
    expect((await f.scope('two', () => listAllCronTasks(), 'desktop-2')).map(task => task.id)).toEqual([durable])
    await expect(access(join(f.root, '.moss', 'scheduled_tasks.json'))).rejects.toThrow()
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
      for await (const id of stream) expect((await readCronTaskStore(f.file)).find(task => task.id === id)).toMatchObject({ ownerSessionId: 'one', desktopHostId: 'desktop-1', agentId: 'worker-1' })
    })
  })
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
