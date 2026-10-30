import fs from 'node:fs/promises'
import path from 'node:path'

const safe = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
const inside = (root, file) => { const rel = path.relative(root, file); return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) }
const cleanup = Symbol('session storage cleanup')
const mutations = new Set(['tasks.start', 'files.import', 'files.pick'])

/** Workspace ownership comes from Main's session records, never from tool arguments. */
export function createAppSessionStorage({ getSession, getSessions = () => [], createSession, getRuntime }) {
  const closing = new Set(), bindings = new Map(), pendingBindings = new Map(), preparations = new Map()
  function record(id, allowClosing = false) {
    const session = getSession(id)
    if (!session || session.agentMode === 'remote-direct' || (!allowClosing && (session.deleted || session.deleting || closing.has(id)))) throw new Error('会话已关闭或不可用于 App 创作')
    return session
  }
  async function resolveScope(appId, instanceId, sessionId, { create = false, allowClosing = false } = {}) {
    if (![appId, instanceId, sessionId].every(safe)) throw new Error('会话存储标识无效')
    const session = record(sessionId, allowClosing), workspace = await fs.realpath(session.workspace)
    let directory = workspace
    for (const part of ['artifacts', appId, sessionId]) {
      directory = path.join(directory, part)
      if (create) await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
      const resolved = await fs.realpath(directory)
      if (!inside(workspace, resolved) || resolved !== directory) throw new Error('会话产物目录不能指向工作区以外或符号链接')
    }
    const marker = path.join(directory, '.moss-session.json')
    if (create) await fs.writeFile(marker, JSON.stringify({ sessionId, appId, instanceId }), { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error })
    const owner = JSON.parse(await fs.readFile(marker, 'utf8'))
    if (owner.sessionId !== sessionId || owner.appId !== appId || owner.instanceId !== instanceId) throw new Error('会话产物归属不匹配')
    record(sessionId, allowClosing)
    return { sessionId, workspace, directory }
  }
  function scope(appId, instanceId, sessionId, options = {}) {
    const pending = resolveScope(appId, instanceId, sessionId, options)
    if (options.create) {
      if (!preparations.has(sessionId)) preparations.set(sessionId, new Set())
      const group = preparations.get(sessionId)
      group.add(pending)
      void pending.finally(() => { group.delete(pending); if (!group.size) preparations.delete(sessionId) }).catch(() => {})
    }
    return pending
  }
  return {
    scope,
    async forkSession(sourceId, targetId) {
      const source = record(sourceId), target = record(targetId)
      const parent = path.join(source.workspace, 'artifacts')
      const apps = await fs.readdir(parent, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      const pairs = []
      for (const app of apps) {
        if (!app.isDirectory() || !safe(app.name)) continue
        const owner = await fs.readFile(path.join(parent, app.name, sourceId, '.moss-session.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error })
        if (!owner || owner.sessionId !== sourceId || owner.appId !== app.name) continue
        const original = await scope(app.name, owner.instanceId, sourceId)
        const pending = await fs.readdir(path.join(original.directory, 'jobs', '.pending')).catch(error => { if (error.code === 'ENOENT') return []; throw error })
        const state = await fs.readFile(path.join(original.directory, 'workspace.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error })
        if (pending.length || state?.tasks?.some(task => ['queued', 'running', 'canceling'].includes(task.status))) throw new Error('创作任务仍在运行，请完成后再分叉会话')
        const copy = await scope(app.name, owner.instanceId, targetId, { create: true })
        if ((await fs.readdir(copy.directory)).some(name => name !== '.moss-session.json')) throw new Error('分叉会话的产物目录已存在')
        pairs.push({ original, copy, appId: app.name })
      }
      const rewrite = value => {
        if (typeof value === 'string') {
          for (const { original, copy } of pairs) value = value === original.directory ? copy.directory : value.replaceAll(original.directory + path.sep, copy.directory + path.sep)
          return pairs.length ? value.replace(/([?&]session=)([a-zA-Z0-9._-]+)/g, (match, prefix, id) => id === sourceId ? prefix + targetId : match) : value
        }
        if (Array.isArray(value)) return value.map(rewrite)
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'sessionId' && item === sourceId ? targetId : rewrite(item)]))
        return value
      }
      async function rewriteMetadata(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name)
          if (entry.isDirectory()) await rewriteMetadata(file)
          else if (entry.isFile() && entry.name.endsWith('.json')) {
            const text = await fs.readFile(file, 'utf8')
            let value
            try { value = JSON.parse(text) } catch { continue }
            const updated = rewrite(value)
            if (JSON.stringify(value) !== JSON.stringify(updated)) await fs.writeFile(file, JSON.stringify(updated))
          }
        }
      }
      for (const { original, copy, appId } of pairs) {
        await fs.cp(original.directory, copy.directory, { recursive: true, filter: async file => {
          if (path.basename(file) === '.moss-session.json') return false
          if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('创作产物包含符号链接，无法独立复制')
          return true
        } })
        await rewriteMetadata(copy.directory)
        // The ordinary managed-workspace copy also copied the old namespace.
        const oldCopy = path.join(await fs.realpath(target.workspace), 'artifacts', appId, sourceId)
        if (oldCopy !== original.directory) {
          const oldOwner = await fs.readFile(path.join(oldCopy, '.moss-session.json'), 'utf8').then(JSON.parse).catch(() => null)
          if (oldOwner?.sessionId === sourceId && oldOwner.appId === appId) await fs.rm(oldCopy, { recursive: true, force: true })
        }
      }
      return rewrite
    },
    async pendingScopes(appId, instanceId) {
      const found = []
      for (const session of getSessions()) {
        if (session.deleted || session.deleting || closing.has(session.id) || session.agentMode === 'remote-direct') continue
        try {
          const storage = await scope(appId, instanceId, session.id)
          const pending = path.join(storage.directory, 'jobs', '.pending')
          const queue = await fs.lstat(pending).catch(() => null)
          const hasQueue = queue?.isDirectory() && (await fs.readdir(pending)).some(id => /^[a-f0-9-]{36}$/.test(id))
          const state = await fs.readFile(path.join(storage.directory, 'workspace.json'), 'utf8').then(JSON.parse).catch(() => null)
          if (hasQueue || state?.tasks?.some(task => ['queued', 'running', 'canceling'].includes(task.status))) found.push(storage)
        } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
      }
      return found
    },
    async removeSessionFiles(sessionId) {
      if (getSession(sessionId)?.agentMode === 'remote-direct') return
      const session = record(sessionId, true), parent = path.join(session.workspace, 'artifacts')
      const apps = await fs.readdir(parent, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      for (const app of apps) {
        if (!app.isDirectory() || !safe(app.name)) continue
        const owner = await fs.readFile(path.join(parent, app.name, sessionId, '.moss-session.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error })
        if (!owner || owner.sessionId !== sessionId || owner.appId !== app.name) continue
        const storage = await scope(app.name, owner.instanceId, sessionId, { allowClosing: true })
        if (storage) await fs.rm(storage.directory, { recursive: true, force: true })
      }
    },
    assertSession(sessionId) { record(sessionId) },
    async prepare({ appId, instanceId, actionName, input, options, manifest }) {
      if (manifest.backend?.storage !== 'session') return { input, options }
      let invocation = options.invocation || {}, sessionId = invocation.sessionId
      if (input?.uri) {
        const uri = new URL(input.uri), owner = uri.searchParams.get('session')
        if (owner) {
          if (sessionId && sessionId !== owner) throw new Error('作品属于其他会话，请先显式导入文件')
          sessionId = owner; uri.searchParams.delete('session'); input = { ...input, uri: uri.href }
        }
      }
      const binding = `${appId}:${instanceId}:${options.sourceId || invocation.origin || 'ui'}`
      if (!sessionId && invocation.surface === 'app') sessionId = bindings.get(binding)
      if (!sessionId && invocation.surface === 'app' && mutations.has(actionName)) {
        if (!pendingBindings.has(binding)) pendingBindings.set(binding, Promise.resolve().then(() => createSession(appId, manifest.displayName)).then(session => {
          bindings.set(binding, session.id); return session.id
        }).finally(() => pendingBindings.delete(binding)))
        sessionId = await pendingBindings.get(binding)
      }
      const isCleanup = options[cleanup] === true
      if (actionName === 'session.close' && !isCleanup) throw new Error('会话清理由宿主管理')
      if (!sessionId) {
        if (mutations.has(actionName)) throw new Error('请在会话中调用创作工具')
        return { input, options: { ...options, invocation: { ...invocation, storage: null } } }
      }
      const storage = await scope(appId, instanceId, sessionId, { create: !isCleanup, allowClosing: isCleanup })
      const authorize = options.authorizeDispatch
      return { input, options: { ...options, invocation: { ...invocation, sessionId, workspace: storage.workspace, storage },
        authorizeDispatch: () => { record(sessionId, isCleanup); authorize?.() } } }
    },
    async closeSession(sessionId) {
      if (getSession(sessionId)?.agentMode === 'remote-direct') return
      closing.add(sessionId)
      await Promise.allSettled([...(preparations.get(sessionId) || [])])
      const runtime = getRuntime()
      if (!runtime) return
      for (const installation of runtime.installations.list()) {
        const pkg = await runtime.getActivePackage(installation.appId).catch(() => null)
        if (pkg?.manifest.backend?.storage !== 'session') continue
        const instance = runtime.resolveContributionInstance(installation.appId)
        const runtimeRecord = runtime.runtimeForInstance(installation.appId, instance.id)
        const process = runtimeRecord && runtime.supervisor.processes.get(runtimeRecord.key)
        if (!process) continue
        if (!['running', 'starting'].includes(process.state)) { await runtime.supervisor.stop(runtimeRecord.key); continue }
        const exists = await scope(installation.appId, instance.id, sessionId, { allowClosing: true }).catch(error => { if (error.code === 'ENOENT') return null; throw error })
        if (!exists) continue
        try {
          await runtime.invoke(installation.appId, instance.id, 'session.close', {}, {
            [cleanup]: true, invocation: { surface: 'app', origin: 'session-cleanup', sessionId }, timeoutMs: 30000,
          })
        } catch (error) {
          // Stop/reap the process tree before allowing deletion after a failed acknowledgement.
          await runtime.supervisor.stop(runtimeRecord.key)
        }
      }
      for (const [key, id] of bindings) if (id === sessionId) bindings.delete(key)
    },
  }
}
