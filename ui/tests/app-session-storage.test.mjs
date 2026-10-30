import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAppSessionStorage } from '../src/apps/app-session-storage.mjs'
import { createAppArtifactUrls } from '../src/apps/app-artifacts.mjs'
import { resolveAppSkills } from '../src/apps/app-skills.mjs'

test('session roots, artifact URLs and deletion are isolated even in a shared workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-storage-'))
  const sessions = new Map(['one', 'two'].map(id => [id, { id, workspace: root }]))
  const storage = createAppSessionStorage({ getSession: id => sessions.get(id), getSessions: () => [...sessions.values()], getRuntime: () => null })
  const artifacts = createAppArtifactUrls({ sessionStorage: storage })
  try {
    const one = await storage.scope('test.creator', 'default', 'one', { create: true })
    const two = await storage.scope('test.creator', 'default', 'two', { create: true })
    await fs.writeFile(path.join(one.directory, 'result.pdf'), 'session one')
    await fs.writeFile(path.join(two.directory, 'result.pdf'), 'session two')
    const context = { appId: 'test.creator', instanceId: 'default', dataDir: path.join(root, 'private'), assertCurrent() {} }
    const first = await artifacts.url({ sessionId: 'one', relativePath: 'result.pdf' }, context)
    const second = await artifacts.url({ sessionId: 'two', relativePath: 'result.pdf' }, context)
    expect(await (await fetch(first.url)).text()).toBe('session one')
    expect(await (await fetch(second.url)).text()).toBe('session two')
    await fs.symlink(path.join(two.directory, 'result.pdf'), path.join(one.directory, 'escape.pdf'))
    await expect(artifacts.url({ sessionId: 'one', relativePath: 'escape.pdf' }, context)).rejects.toThrow('outside')
    await fs.mkdir(path.join(one.directory, 'jobs', '.pending'), { recursive: true })
    await fs.writeFile(path.join(one.directory, 'jobs', '.pending', '12345678-1234-1234-1234-123456789012'), '')
    expect((await storage.pendingScopes('test.creator', 'default')).map(scope => scope.sessionId)).toEqual(['one'])
    sessions.get('one').deleted = true
    await storage.closeSession('one')
    expect((await fetch(first.url)).status).toBe(404)
    expect((await fetch(second.url)).status).toBe(200)
    await storage.removeSessionFiles('one')
    expect(await fs.stat(one.directory).catch(() => null)).toBeNull()
    expect(await fs.readFile(path.join(two.directory, 'result.pdf'), 'utf8')).toBe('session two')
    await expect(storage.scope('test.creator', 'default', 'one', { create: true })).rejects.toThrow('关闭')
  } finally { await artifacts.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('Host binds UI creation once, rejects forged session roots, and refuses cross-session versions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-binding-'))
  const sessions = new Map(); let created = 0
  const storage = createAppSessionStorage({ getSession: id => sessions.get(id), getRuntime: () => null,
    createSession: async () => { const session = { id: 'new-' + ++created, workspace: root }; sessions.set(session.id, session); return session } })
  const request = { appId: 'test.creator', instanceId: 'default', manifest: { backend: { storage: 'session' } }, actionName: 'tasks.start', input: {},
    options: { sourceId: 42, invocation: { surface: 'app', origin: 'ui', workspace: '/untrusted', storage: { directory: '/untrusted' } } } }
  try {
    const [first, second] = await Promise.all([storage.prepare(request), storage.prepare(request)])
    expect(created).toBe(1)
    expect(first.options.invocation.storage).toEqual(second.options.invocation.storage)
    expect(first.options.invocation.workspace).toBe(await fs.realpath(root))
    await expect(storage.prepare({ ...request, actionName: 'composer.resolve', input: { uri: 'moss-test://works/task?session=another' }, options: first.options })).rejects.toThrow('其他会话')
    await expect(storage.prepare({ ...request, actionName: 'session.close' })).rejects.toThrow('宿主管理')
    const record = sessions.get('new-1'); record.deleted = true
    expect(() => first.options.authorizeDispatch()).toThrow('关闭')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('creation skills grant only resource reads and expose no private data or CLI mutation path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-skills-'))
  try {
    await fs.writeFile(path.join(root, 'SKILL.md'), 'Use the native tool')
    await fs.writeFile(path.join(root, 'cli.mjs'), '')
    const runtime = { installations: { list: () => [{ appId: 'test.creator', enabled: true }] },
      getActivePackage: async () => ({ root, manifest: { toolScope: 'global', backend: { storage: 'session' }, contributes: { skills: [{ id: 'creator', path: 'SKILL.md', cli: 'cli.mjs' }] } } }),
      getToolScope: () => 'global', ensureDefaultInstance: async () => ({ id: 'default', enabled: true }), dataDir: '/private/app-data', appDataPath: path.join }
    const result = await resolveAppSkills(runtime)
    expect(result.directories).toEqual([])
    expect(result.readDirectories).toEqual([await fs.realpath(root)])
    expect(result.skills[0].execution).toBe('tools')
    expect(result.skills[0].dataDir).toBeUndefined()
    expect(result.skills[0].cliPath).toBeUndefined()
    expect(result.prompt).not.toContain('/private/app-data')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('forked session artifacts and persisted references survive deleting their source session', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'session-storage-fork-')))
  const sessions = new Map(['original', 'fork'].map(id => [id, { id, workspace: path.join(root, id) }]))
  const storage = createAppSessionStorage({ getSession: id => sessions.get(id), getRuntime: () => null })
  try {
    for (const session of sessions.values()) await fs.mkdir(session.workspace)
    const original = await storage.scope('test.creator', 'default', 'original', { create: true })
    const result = path.join(original.directory, 'result.txt')
    await fs.writeFile(result, 'independent result')
    await fs.writeFile(path.join(original.directory, 'task.json'), JSON.stringify({ sessionId: 'original', artifacts: [{ path: result }], result: { resourceUri: 'moss-test://works/task?session=original' } }))
    await fs.cp(sessions.get('original').workspace, sessions.get('fork').workspace, { recursive: true })
    const rewrite = await storage.forkSession('original', 'fork')
    const copy = await storage.scope('test.creator', 'default', 'fork')
    const task = JSON.parse(await fs.readFile(path.join(copy.directory, 'task.json'), 'utf8'))
    expect(task.sessionId).toBe('fork')
    expect(task.artifacts[0].path).toBe(path.join(copy.directory, 'result.txt'))
    expect(task.result.resourceUri).toBe('moss-test://works/task?session=fork')
    expect(rewrite('[result](moss-test://works/task?session=original)')).toBe('[result](moss-test://works/task?session=fork)')
    sessions.get('original').deleted = true
    await storage.closeSession('original'); await storage.removeSessionFiles('original')
    expect(await fs.readFile(task.artifacts[0].path, 'utf8')).toBe('independent result')
    expect(await fs.stat(path.join(sessions.get('fork').workspace, 'artifacts', 'test.creator', 'original')).catch(() => null)).toBeNull()
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
