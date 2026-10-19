import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import semver from 'semver'
import { contracts, authoringLimits } from '../../../packages/host-contracts/src/index.mjs'
import { validateAppPackage, writePackageChecksums } from '../../../packages/app-runtime/src/index.mjs'
import { validateAppManifest } from '../../../packages/app-sdk/src/schemas/index.mjs'
import { APP_ERROR_CODES } from '../../../packages/app-sdk/src/errors.mjs'
import { validateConfiguration } from '../../../packages/app-runtime/src/state/index.mjs'
import { copySource, digest, extractSourceArchive, fail, inside, inspectSource, readJson, realInside, sourceHash, writeJson } from './app-authoring-source.mjs'
import { attachSourcePackage, validateSourcePackage, inspectSourceProject, sourceFileList, sourcePath, restoreSourceModes } from '../../../packages/app-runtime/src/packages/source.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { verifyPackageRuntime } from '../../../packages/app-runtime/src/packages/verify-runtime.mjs'

const exec = promisify(execFile)
const projectRoot = project => project.sourceRoot || project.path

const requiredPermissions = ['apps:read', 'apps:author', 'apps:build', 'apps:install']
const terminal = new Set(['succeeded', 'failed', 'canceled', 'interrupted', 'closed'])
const quote = text => "'" + String(text).replaceAll("'", "'\\''") + "'"
const appIdPattern = /^[a-z0-9][a-z0-9._-]{0,99}$/

/** Core owns references and jobs; the installed provider owns all model tools. */
export async function createAppAuthoringHost(options) {
  const { home, appsDir, catalog, getRuntime, getSession } = options
  const root = path.join(home, 'app-authoring')
  await fs.mkdir(root, { recursive: true })
  const statePath = path.join(root, 'state.json')
  const state = await readJson(statePath, { projects: {}, bindings: {}, targets: {}, drafts: {}, operations: {}, keys: {} })
  const tickets = new Map(), controllers = new Map(), previewHandles = new Map(), workTasks = new Map()
  let queue = Promise.resolve(), saves = Promise.resolve(), shuttingDown = false
  const serial = operation => { const task = queue.then(operation, operation); queue = task.catch(() => {}); return task }
  const save = () => { const value = structuredClone(state); const task = saves.then(() => writeJson(statePath, value)); saves = task.catch(() => {}); return task }
  const publicProject = project => ({ projectRef: project.id, projectId: project.projectId, providerId: project.providerId, appId: project.appId, baseVersion: project.baseVersion, installationRevision: project.installationRevision, sourceHash: project.sourceHash, contractHash: project.contractHash, sdkHash: project.sdkHash, path: project.path, sourceRoot: projectRoot(project), appRoot: project.appRoot || '.', sourceKind: project.sourceKind, ...(project.sourceManifest ? { toolchain: project.sourceManifest.toolchain, commands: project.sourceManifest.commands } : {}) })
  const publicOperation = operation => ({ operationRef: operation.id, kind: operation.kind, status: operation.status, projectRef: operation.projectRef, createdAt: operation.createdAt, updatedAt: operation.updatedAt, ...(operation.result ? { result: operation.result } : {}), ...(operation.error ? { error: operation.error } : {}) })
  async function changed(operation) {
    operation.updatedAt = Date.now()
    await save()
    await options.onChanged?.(publicOperation(operation), state.projects[operation.projectRef])
  }
  function owned(record, context) {
    if (!record || record.owner !== context.owner?.key || record.providerAppId !== context.appId) fail('Reference does not belong to this App and owner', APP_ERROR_CODES.permissionDenied)
    return record
  }
  function projectFor(ref, context) { return owned(state.projects[ref], context) }
  function requireTool(context) {
    if (shuttingDown) fail('Core is shutting down', APP_ERROR_CODES.hostUnavailable)
    context.assertCurrent?.()
    const ticket = tickets.get(context.invocation?.ticket)
    if (!ticket || ticket.signal?.aborted || context.surface !== 'backend' || context.invocation?.origin !== 'agent-tool'
      || ticket.appId !== context.appId || ticket.version !== context.version || ticket.owner !== context.owner?.key
      || ticket.sessionId !== context.invocation.sessionId || ticket.effect === 'read') fail('This operation requires a live ordinary Agent write tool invocation', APP_ERROR_CODES.permissionDenied)
    if (ticket.generation !== undefined && ticket.generation !== context.generation) fail('Tool invocation generation changed', APP_ERROR_CODES.permissionDenied)
    ticket.generation = context.generation
    const session = getSession(ticket.sessionId)
    if (!session || session.agentMode === 'remote-direct' || session.workspace !== ticket.workspace) fail('Bound ordinary session is unavailable', APP_ERROR_CODES.permissionDenied)
    return { ticket, session }
  }
  function requireProjectTool(ref, context) {
    const authority = requireTool(context), project = projectFor(ref, context)
    if (project.sessionId !== authority.session.id || project.workspace !== authority.session.workspace) fail('Project belongs to a different session', APP_ERROR_CODES.permissionDenied)
    return { ...authority, project }
  }
  async function installed(appId) {
    if (!appIdPattern.test(appId)) fail('Invalid App identity', APP_ERROR_CODES.invalidInput)
    const current = await readJson(path.join(appsDir, appId, 'current.json'), {})
    const revision = await options.getInstallationRevision(appId)
    if (!current.version) return { appId, version: null, installationRevision: revision, manifest: null }
    const manifest = await readJson(path.join(appsDir, appId, 'versions', current.version, 'app.moss.json'))
    if (manifest.id !== appId || manifest.version !== current.version) fail('Installed App identity is invalid')
    return { appId, version: current.version, installationRevision: revision, manifest }
  }
  async function target(appId, context) {
    const current = await installed(appId)
    const id = randomUUID()
    state.targets[id] = { ...current, id, owner: context.owner.key, providerAppId: context.appId }
    await save()
    return { targetRef: id, appId, version: current.version, installationRevision: current.installationRevision, displayName: current.manifest?.displayName || appId }
  }
  async function sourceFor(target, run) {
    if (target.version) {
      const installedRoot = path.join(appsDir, target.appId, 'versions', target.version)
      const packaged = await validateSourcePackage(installedRoot)
      if (packaged) return run(packaged.root, 'package', packaged.descriptor)
    }
    const stored = path.join(root, 'sources', target.appId, target.version || 'none')
    try { await fs.access(stored); return await run(stored, 'snapshot') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const archive = path.join(appsDir, target.appId, 'sources', `${target.version}.tar.gz`)
    try { await fs.access(archive) } catch { return await run(null, 'artifact-only') }
    const staging = path.join(root, `source-${randomUUID()}`)
    const copy = `${staging}.tar.gz`
    try {
      await fs.copyFile(archive, copy)
      await extractSourceArchive(copy, staging)
      return await run(staging, 'archive')
    } finally { await fs.rm(staging, { recursive: true, force: true }); await fs.rm(copy, { force: true }) }
  }
  async function inspect(input, context) {
    if (input.projectRef) {
      const project = projectFor(input.projectRef, context)
      await realInside(project.workspace, project.path)
      const source = await inspectSource(projectRoot(project), { appRoot: project.appRoot || '.' })
      return { ...publicProject(project), ...source, current: await installed(project.appId) }
    }
    const current = input.targetRef ? owned(state.targets[input.targetRef], context) : await installed(input.appId)
    return sourceFor(current, async (directory, sourceKind, descriptor) => ({ appId: current.appId, version: current.version, installationRevision: current.installationRevision, sourceKind,
      ...(descriptor ? { sourceRoot: directory, path: sourcePath(directory, descriptor.appRoot), appRoot: descriptor.appRoot, toolchain: descriptor.toolchain, commands: descriptor.commands } : {}),
      ...(directory ? await inspectSource(directory, { appRoot: descriptor?.appRoot || '.' }) : { editable: false, missing: ['rebuildable source'], sourceHash: null }) }))
  }
  async function availability() {
    const runtime = getRuntime()
    if (!runtime) return { available: false, reason: 'host-unavailable', provider: null }
    for (const method of ['info.get', 'contracts.list', 'contracts.get', 'sdk.export']) if (!runtime.hostCapabilities.handlers.get('moss.host/v1')?.has(method)) return { available: false, reason: 'host-upgrade-required', provider: null }
    for (const method of Object.keys(contracts['moss.apps/v1'].methods)) if (!runtime.hostCapabilities.handlers.get('moss.apps/v1')?.has(method)) return { available: false, reason: 'host-upgrade-required', provider: null }
    const { resourceProviders } = await runtime.listContributions({ kinds: ['resourceProviders'] })
    const providers = resourceProviders.filter(provider => provider.authoring?.target === 'moss-app')
    const eligible = []
    for (const provider of providers) {
      const installation = runtime.installations.get(provider.appId)
      if (!requiredPermissions.every(permission => installation?.grants?.includes(permission))) continue
      const instance = runtime.resolveContributionInstance(provider.appId)
      if (!instance.enabled) continue
      const status = await runtime.getInstanceStatus(provider.appId, instance.id)
      try {
        const pkg = await runtime.getActivePackage(provider.appId)
        validateConfiguration(pkg.root, pkg.manifest.backend, instance.config || {}, await runtime.credentials.get(provider.appId, instance.id))
      } catch { continue }
      eligible.push({ ...provider, faulted: ['error', 'crash-loop', 'failed', 'crashed', 'crash_loop'].includes(status?.state || status?.runtime?.state) })
    }
    if (eligible.length !== 1) return { available: false, reason: eligible.length ? 'provider-conflict' : 'provider-unavailable', provider: null }
    const provider = eligible[0]
    return { available: !provider.faulted, reason: provider.faulted ? 'backend-failed' : null, provider: { id: provider.id, appId: provider.appId, intents: provider.authoring.intents } }
  }
  async function authoringResources() {
    const [skills, assistants] = await Promise.all([options.listSkills?.() || [], options.listAssistants?.() || []])
    const items = new Map()
    for (const [kind, resources] of [['skill', skills], ['assistant', assistants]]) {
      for (const resource of resources) {
        const key = `${kind}:${resource.name}`
        if (!resource.name || !resource.source || resource.enabled === false || items.has(key)) continue
        items.set(key, { kind, name: resource.name, displayName: resource.displayName || resource.name,
          description: resource.description || '', icon: resource.icon || resource.avatar || '', emoji: resource.emoji || '',
          source: resource.source })
      }
    }
    return [...items.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))
  }
  async function resolveAuthoringResources(input) {
    if (input === undefined) return []
    if (!Array.isArray(input) || input.length > 20) fail('最多选择 20 个技能或助手')
    const installed = await authoringResources(), selected = new Map()
    for (const ref of input) {
      const resource = installed.find(item => item.kind === ref?.kind && item.name === ref?.name)
      if (!resource) fail('所选技能或助手已停用或卸载，请重新选择')
      if (resource.kind === 'assistant' && [...selected.values()].some(item => item.kind === 'assistant' && item.name !== resource.name)) fail('每次只能选择一个助手')
      const { kind, name, displayName, source } = resource
      selected.set(`${kind}:${name}`, { kind, name, displayName, source })
    }
    const resources = [...selected.values()]
    // Leave room for the provider/draft IDs within the composer's 8 KiB context limit.
    if (JSON.stringify(resources).length > 7000) fail('所选资源过多，请减少选择后重试')
    return resources
  }
  async function prepareDraft(input, context, selectedAppId) {
    const available = await availability()
    if (!available.available) fail(available.reason, APP_ERROR_CODES.hostUnavailable)
    const { provider } = available
    if (!provider.intents.includes(input.intent)) fail('Unsupported authoring intent')
    const resources = input.intent === 'create' ? await resolveAuthoringResources(input.ref?.resources) : []
    const providerContext = { owner: context.owner, appId: provider.appId }
    let targetRecord = null
    if (input.intent === 'edit') {
      if (selectedAppId) targetRecord = await target(selectedAppId, providerContext)
      else if (context.appId === provider.appId && input.targetRef) targetRecord = owned(state.targets[input.targetRef], providerContext)
      else targetRecord = await target(context.appId, providerContext)
    }
    const draftRef = randomUUID()
    state.drafts[draftRef] = { id: draftRef, owner: context.owner.key, providerAppId: provider.appId, providerId: provider.id, targetRef: targetRecord?.targetRef || targetRecord?.id || null, intent: input.intent }
    await save()
    return { appId: provider.appId, context: { providerId: provider.id, intent: input.intent, ref: { draftRef, ...(targetRecord ? { targetRef: targetRecord.targetRef || targetRecord.id } : {}), ...(resources.length ? { resources } : {}), ...(!resources.length && input.ref?.skillPath ? { skillPath: String(input.ref.skillPath).slice(0, 4096) } : {}) } }, prompt: String(input.prompt || '').slice(0, 4000), title: input.intent === 'edit' ? `迭代 ${targetRecord.appId}` : '创建 App' }
  }
  async function prepareProject(input, context) {
    const { ticket, session } = requireTool(context)
    if (!ticket.providerId) fail('This App does not declare an authoring resource provider', APP_ERROR_CODES.permissionDenied)
    if (input.projectRef) {
      const { project } = requireProjectTool(input.projectRef, context)
      await realInside(project.workspace, project.path)
      return { ...publicProject(project), sourceHash: await sourceHash(projectRoot(project)) }
    }
    const bindingKey = `${context.owner.key}:${session.id}:${context.appId}:${input.projectId}`
    if (state.bindings[bindingKey]) {
      const existing = projectFor(state.bindings[bindingKey], context)
      if (input.appId && input.appId !== existing.appId && input.appId !== existing.origin?.appId) fail('Project ID is already bound to another App')
      await realInside(existing.workspace, existing.path)
      return { ...publicProject(existing), sourceHash: await sourceHash(projectRoot(existing)) }
    }
    const draft = input.draftRef ? owned(state.drafts[input.draftRef], context) : null
    if (draft && draft.intent !== input.intent) fail('Draft intent differs from the requested project')
    if (draft?.targetRef && input.targetRef && input.targetRef !== draft.targetRef) fail('Draft target cannot be replaced')
    const targetRef = draft?.targetRef || input.targetRef
    const base = targetRef ? owned(state.targets[targetRef], context) : null
    if (input.intent === 'edit' && !base) fail('Select a target reference before editing', APP_ERROR_CODES.invalidInput)
    if (base) {
      const current = await installed(base.appId)
      if (current.version !== base.version || current.installationRevision !== base.installationRevision) fail('Target changed before source preparation; select it again')
    }
    let appId = input.appId || base?.appId
    if (!appIdPattern.test(appId || '')) fail('A valid new App ID is required', APP_ERROR_CODES.invalidInput)
    const market = base && (await options.listApps()).find(app => app.id === base.appId)?.marketplaceSource
    const fork = Boolean(base && market && !input.replaceOriginal)
    if (fork && appId === base.appId) appId = `${appId.slice(0, 65)}.local-${randomUUID().slice(0, 8)}`
    const current = await installed(appId)
    if ((!base || fork) && current.version) fail('App ID is already installed; use an edit target')
    const id = randomUUID(), workspace = await fs.realpath(session.workspace)
    const parent = path.join(workspace, 'apps')
    await fs.mkdir(parent, { recursive: true })
    await realInside(workspace, parent)
    const directory = path.join(parent, `${appId}-${id.slice(0, 8)}`)
    let sourceKind = 'new', sourceManifest = null, appRoot = '.'
    if (input.sourcePath) {
      const source = await realInside(workspace, path.resolve(workspace, input.sourcePath))
      const packaged = await validateSourcePackage(source)
      sourceManifest = packaged?.descriptor || null; appRoot = sourceManifest?.appRoot || '.'
      const description = await inspectSource(packaged?.root || source, { appRoot })
      if (!description.editable) fail(`Source is incomplete: ${description.missing.join(', ')}`)
      await copySource(packaged?.root || source, directory, undefined, { includeSdk: true })
      sourceKind = 'local'
    } else if (base) {
      await sourceFor(base, async (source, kind, descriptor) => {
        if (!source) fail('Only runtime artifacts are installed. Select matching source inside the session workspace.')
        sourceManifest = descriptor || null; appRoot = descriptor?.appRoot || '.'
        const description = await inspectSource(source, { appRoot })
        if (!description.editable) fail(`Source is incomplete: ${description.missing.join(', ')}`)
        await copySource(source, directory, undefined, { includeSdk: true })
        sourceKind = kind
      })
    } else await fs.mkdir(directory)
    if (sourceManifest) await restoreSourceModes(directory, sourceManifest)
    if (fork || (base && appId !== base.appId)) {
      const manifest = await readJson(path.join(directory, appRoot, 'app.moss.json'))
      manifest.id = appId; manifest.version = '0.1.0'
      await writeJson(path.join(directory, appRoot, 'app.moss.json'), manifest)
    }
    const project = { id, projectId: input.projectId, providerId: draft?.providerId || ticket.providerId, providerAppId: context.appId, owner: context.owner.key, sessionId: session.id,
      workspace: session.workspace, path: sourcePath(directory, appRoot), sourceRoot: directory, appRoot, sourceManifest, appId, sourceKind, baseVersion: current.version, installationRevision: current.installationRevision,
      sourceHash: await sourceHash(directory), contractHash: catalog.info.contractHash, sdkHash: catalog.info.sdkHash,
      navigationRequired: input.intent === 'create' || Boolean(fork || (base && appId !== base.appId)),
      origin: base ? { appId: base.appId, version: base.version, marketplace: Boolean(market) } : null }
    state.projects[id] = project; state.bindings[bindingKey] = id
    await save()
    await options.onBind?.(session, { providerId: project.providerId, intent: input.intent, ref: { projectRef: id } })
    return publicProject(project)
  }
  function findRetry(kind, key, input, project) {
    const identity = `${project.owner}:${project.providerAppId}:${project.sessionId}:${kind}:${key}`
    const previous = state.keys[identity]
    if (previous) {
      if (previous.hash !== digest(input)) fail('Submission key was already used with different content')
      if (!state.operations[previous.id]) fail('The retained receipt has expired; inspect the current installation before submitting again')
      return { identity, operation: state.operations[previous.id] }
    }
    return { identity, operation: null }
  }
  function operation(kind, input, project, status) {
    const retry = findRetry(kind, input.submissionKey, input, project)
    if (retry.operation) return retry.operation
    const id = randomUUID()
    const item = { id, kind, status, projectRef: project.id, providerAppId: project.providerAppId, owner: project.owner, sessionId: project.sessionId, input, createdAt: Date.now(), updatedAt: Date.now() }
    state.operations[id] = item; state.keys[retry.identity] = { hash: digest(input), id }
    return item
  }
  async function getOperation(input, context) {
    const item = owned(state.operations[input.operationRef], context)
    const result = publicOperation(item)
    if (item.kind === 'build') {
      const file = await fs.open(path.join(root, `${item.id}.log`), 'r').catch(() => null)
      if (file) {
        try { const buffer = Buffer.alloc(Math.min(input.limit || 16384, 65536)); const { bytesRead } = await file.read(buffer, 0, buffer.length, input.offset || 0); result.log = buffer.subarray(0, bytesRead).toString('utf8'); result.nextOffset = (input.offset || 0) + bytesRead }
        finally { await file.close() }
      }
    }
    return result
  }
  function checkSnapshot(project) {
    if (project.contractHash !== catalog.info.contractHash || project.sdkHash !== catalog.info.sdkHash) fail('Core developer snapshot changed; export the current SDK and validate again')
  }
  async function runCommand(command, args, directory, item, signal) {
    const logPath = path.join(root, `${item.id}.log`)
    let size = 0, writes = Promise.resolve()
    try { await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: directory, detached: process.platform !== 'win32', windowsHide: true,
        env: { PATH: options.buildPath || process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: path.join(directory, '.tmp'), TMPDIR: path.join(directory, '.tmp'), HOME: directory, USERPROFILE: directory, CI: '1', npm_config_cache: path.join(root, 'dependency-cache', item.cacheKey || 'tools', 'npm'), BUN_INSTALL_CACHE_DIR: path.join(root, 'dependency-cache', item.cacheKey || 'tools', 'bun') }, stdio: ['ignore', 'pipe', 'pipe'] })
      const stop = () => { if (!child.pid) return; if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-child.pid, 'SIGKILL') } catch {} } }
      let failure
      const timer = setTimeout(() => { failure = new Error('Build exceeded 120 seconds'); stop() }, 120000)
      const append = data => { const bytes = data.subarray(0, Math.max(0, authoringLimits.logBytes - size)); size += bytes.length; if (bytes.length) writes = writes.then(() => fs.appendFile(logPath, bytes)).catch(error => { failure = error; stop() }); if (size >= authoringLimits.logBytes) { failure = new Error('Build log limit exceeded'); stop() } }
      child.stdout.on('data', append); child.stderr.on('data', append)
      signal.addEventListener('abort', stop, { once: true })
      child.once('error', error => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(error) })
      child.once('close', code => { clearTimeout(timer); signal.removeEventListener('abort', stop); if (failure) reject(failure); else if (signal.aborted) reject(new Error('Build canceled')); else if (code !== 0) reject(new Error(`Build command exited with ${code}; inspect build.get log for details`)); else resolve() })
      if (signal.aborted) stop()
    }) } finally { await writes }
  }
  function launch(item, work) {
    const controller = new AbortController(); controllers.set(item.id, controller)
    const task = Promise.resolve().then(() => work(controller.signal)).catch(async error => {
      if (!terminal.has(item.status)) { item.status = controller.signal.aborted ? 'canceled' : 'failed'; item.error = String(error.message || error).slice(0, 8192); await changed(item) }
    }).finally(() => { controllers.delete(item.id); workTasks.delete(item.id); pumpBuilds() })
    workTasks.set(item.id, task)
  }
  const queuedBuilds = new Map()
  function pumpBuilds() {
    if (shuttingDown) return
    const running = Object.values(state.operations).filter(item => item.kind === 'build' && item.status === 'running')
    for (const [id, work] of queuedBuilds) {
      if (running.length >= authoringLimits.concurrentBuilds) break
      const item = state.operations[id]
      queuedBuilds.delete(id)
      if (item.status !== 'queued') continue
      item.status = 'running'; running.push(item)
      launch(item, async signal => { await changed(item); await work(signal) })
    }
  }
  async function startBuild(input, context) {
    const { project, ticket } = requireProjectTool(input.projectRef, context)
    if (options.npmCommand === null) fail('Managed Node/npm runtime is unavailable; install the Core Node runtime before building', APP_ERROR_CODES.hostUnavailable)
    const retry = findRetry('build', input.submissionKey, input, project)
    if (retry.operation) return publicOperation(retry.operation)
    checkSnapshot(project)
    if (input.contractHash !== project.contractHash || input.sdkHash !== project.sdkHash) fail('Build uses a different SDK/contract snapshot')
    if (Object.values(state.operations).some(item => item.projectRef === project.id && item.kind === 'build' && !terminal.has(item.status))) fail('A build is already active for this project')
    if (queuedBuilds.size >= authoringLimits.queuedBuilds) fail('Build queue is full', APP_ERROR_CODES.resourceExhausted)
    await realInside(project.workspace, project.path)
    const appRoot = project.appRoot || '.'
    const source = await inspectSource(projectRoot(project), { appRoot })
    if (!source.editable) fail(`Source is incomplete: ${source.missing.join(', ')}`)
    if (source.sourceHash !== input.sourceHash) fail('Source changed; inspect again')
    const npm = options.npmCommand || ['npm', []]
    const npmVersion = (await exec(npm[0], [...npm[1], '--version'], { timeout: 10000 })).stdout.trim()
    const spec = await inspectSourceProject(projectRoot(project), { appRoot, packageManagerVersion: npmVersion })
    const requireNavigation = project.navigationRequired ?? !project.origin
    validateAppManifest(spec.manifest, { requireNavigation })
    const manager = spec.toolchain.packageManager
    let bunCommand = options.bunCommand
    if (manager.name === 'bun' && bunCommand === undefined) {
      try {
        const detected = await exec('bun', ['--version'], { env: { PATH: options.buildPath || process.env.PATH, SystemRoot: process.env.SystemRoot }, timeout: 10000 })
        if (detected.stdout.trim() === manager.version) bunCommand = ['bun', []]
      } catch {}
    }
    const runner = manager.name === 'bun' ? bunCommand || [npm[0], [...npm[1], 'exec', '--yes', `--package=bun@${manager.version}`, '--', 'bun']]
      : manager.version === npmVersion ? npm : [npm[0], [...npm[1], 'exec', '--yes', `--package=npm@${manager.version}`, '--', 'npm']]
    const buildRoot = path.join(await fs.realpath(project.workspace), '.moss-app-builds')
    await fs.mkdir(buildRoot, { recursive: true }); await realInside(project.workspace, buildRoot)
    const directory = path.join(buildRoot, randomUUID())
    await copySource(projectRoot(project), directory, input.sourceHash, { includeSdk: true })
    // Fresh builds always install the lockfile; the user's dependency cache is
    // only a download cache, never a shared writable node_modules tree.
    const commands = [spec.commands.install, spec.commands.build].filter(Boolean).map(command => ({
      command: runner[0], args: [...runner[1], ...command.argv.slice(1)], cwd: sourcePath(directory, command.cwd),
    }))
    const nodeExecutable = options.nodeExecutable || getRuntime()?.supervisor?.nodeExecutable || process.execPath
    try {
      for (const command of commands) await ticket.authorizeCommand(`cd ${quote(command.cwd)} && ${[command.command, ...command.args].map(quote).join(' ')}`)
      if (spec.manifest.backend) await ticket.authorizeCommand(`${quote(nodeExecutable)} ${quote(path.join(directory, appRoot, spec.manifest.backend.entry))} # isolated App Backend handshake verification`)
      requireTool(context)
    } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error }
    const item = operation('build', input, project, 'queued'); item.directory = directory
    item.cacheKey = digest({ manager, node: process.versions.node, platform: process.platform, arch: process.arch, sdk: project.sdkHash,
      lock: spec.lockfile ? digest(await fs.readFile(path.join(directory, spec.lockfile))) : null })
    await changed(item)
    queuedBuilds.set(item.id, async signal => {
      const frozenSource = path.join(root, `snapshot-${item.id}`)
      try {
        const sdkRoot = path.join(directory, '.moss-sdk')
        const pinnedSdk = await readJson(path.join(sdkRoot, 'snapshot.json'), null)
        const linkSdk = async () => {
          if (!pinnedSdk) return
          for (const name of ['app-sdk', 'host-contracts']) {
            const link = path.join(directory, 'node_modules', '@moss', name)
            await fs.mkdir(path.dirname(link), { recursive: true })
            try { await fs.symlink(path.join(sdkRoot, 'packages', name), link, process.platform === 'win32' ? 'junction' : 'dir') }
            catch (error) { if (error.code !== 'EEXIST') throw error; if (await fs.realpath(link) !== path.join(sdkRoot, 'packages', name)) fail('Installed SDK differs from the pinned source SDK') }
          }
        }
        const workspaceSdk = await fs.access(path.join(directory, 'vendor/moss-core/packages/app-sdk/package.json')).then(() => true, () => false)
        if (pinnedSdk) {
          if (project.sourceManifest) {
            const expected = project.sourceManifest.files.filter(file => file.path.startsWith('.moss-sdk/')).map(({ executable, ...file }) => file)
            const actual = (await sourceFileList(sdkRoot)).map(file => ({ ...file, path: `.moss-sdk/${file.path}` }))
            if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('Pinned SDK source was modified; migrate the SDK explicitly')
          }
          await linkSdk()
        } else if (!workspaceSdk) await catalog.exportTo(directory)
        await copySource(directory, frozenSource, input.sourceHash, { includeSdk: true })
        const frozenHash = digest(await sourceFileList(frozenSource))
        for (const command of commands) {
          signal.throwIfAborted()
          await fs.mkdir(path.join(command.cwd, '.tmp'), { recursive: true })
          await runCommand(command.command, command.args, command.cwd, item, signal)
          if (command === commands[0] && spec.commands.install) {
            if (pinnedSdk) await linkSdk(); else if (!workspaceSdk) await catalog.exportTo(directory)
          }
        }
        signal.throwIfAborted()
        const builtApp = sourcePath(directory, appRoot)
        const manifest = validateAppManifest(await readJson(path.join(builtApp, 'app.moss.json')), { requireNavigation })
        if (manifest.id !== project.appId) fail('Built App identity differs from project')
        // Source-mutating build scripts cannot silently change the packaged input.
        const checkCopy = path.join(root, `check-${item.id}`)
        try {
          await copySource(directory, checkCopy, input.sourceHash, { includeSdk: true })
          if (digest(await sourceFileList(checkCopy)) !== frozenHash) fail('Build changed its source inputs')
        } finally { await fs.rm(checkCopy, { recursive: true, force: true }) }
        const artifactDir = path.join(root, 'artifacts', item.id)
        await fs.mkdir(artifactDir, { recursive: true })
        for (const name of ['dist', 'schemas', 'assets', 'resources', 'app.moss.json', 'README.md', 'LICENSE', 'LICENSE.md']) {
          try { await fs.cp(path.join(builtApp, name), path.join(artifactDir, name), { recursive: true }) }
          catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        const descriptor = await attachSourcePackage(artifactDir, frozenSource, { appRoot, packageManagerVersion: manager.version,
          origin: { kind: 'builder', buildRef: item.id, inputSourceHash: input.sourceHash, parent: project.origin }, sdk: pinnedSdk || (workspaceSdk ? project.sourceManifest?.sdk || {} : catalog.info) })
        const verification = await verifyPackageRuntime(artifactDir, { nodeExecutable, signal })
        await writePackageChecksums(artifactDir); await validateAppPackage(artifactDir, { requireSource: true })
        signal.throwIfAborted()
        item.artifact = { id: item.id, directory: artifactDir, source: path.join(artifactDir, 'source'), manifest, hash: await sourceHash(artifactDir, { packageFiles: true }), sourceHash: input.sourceHash, contractHash: project.contractHash, sdkHash: project.sdkHash }
        item.status = 'succeeded'; item.result = { artifactRef: item.id, artifactHash: item.artifact.hash, version: manifest.version, sourceHash: input.sourceHash, packagedSourceHash: descriptor.sourceHash, verification }
        project.lastArtifactRef = item.id
        await changed(item)
      } finally {
        await fs.rm(directory, { recursive: true, force: true })
        await fs.rm(frozenSource, { recursive: true, force: true })
        if (!item.artifact) await fs.rm(path.join(root, 'artifacts', item.id), { recursive: true, force: true })
      }
    })
    pumpBuilds()
    return publicOperation(item)
  }
  async function artifactFor(ref, context) {
    const build = owned(state.operations[ref], context)
    if (build.kind !== 'build' || build.status !== 'succeeded' || !build.artifact) fail('Artifact is not a successful immutable build')
    checkSnapshot(projectFor(build.projectRef, context))
    if (build.artifact.contractHash !== catalog.info.contractHash || build.artifact.sdkHash !== catalog.info.sdkHash) fail('Artifact was built against an older Core developer snapshot')
    if (build.artifact.hash !== await sourceHash(build.artifact.directory, { packageFiles: true })) fail('Artifact was modified after validation')
    await validateAppPackage(build.artifact.directory, { requireSource: true })
    return { artifact: build.artifact, project: projectFor(build.projectRef, context) }
  }
  async function startPreview(input, context) {
    const { artifact, project } = await artifactFor(input.artifactRef, context)
    requireProjectTool(project.id, context)
    const previous = findRetry('preview', input.submissionKey, input, project).operation
    if (previous) return publicOperation(previous)
    const grants = input.grants || []
    if (grants.some(grant => !artifact.manifest.permissions.includes(grant))) fail('Preview permission was not requested by the target App', APP_ERROR_CODES.permissionDenied)
    if (!await options.authorizePreview?.(artifact.manifest, grants)) fail('Preview execution was not authorized', APP_ERROR_CODES.permissionDenied)
    requireProjectTool(project.id, context)
    await artifactFor(input.artifactRef, context) // Consent may remain open while the build directory changes.
    const item = operation('preview', input, project, 'starting')
    await changed(item)
    launch(item, async signal => {
      const handle = await options.preview(artifact, { grants, config: input.config || {}, signal, previewRef: item.id, onClosed: () => service.cancelFromCore(item.id, item.sessionId) })
      previewHandles.set(item.id, handle)
      if (signal.aborted) { await handle.close(); item.status = 'closed' } else { item.status = 'ready'; item.result = { previewRef: item.id, appId: artifact.manifest.id, hasUi: Boolean(artifact.manifest.ui) } }
      await changed(item)
    })
    return publicOperation(item)
  }
  async function testPreview(input, context) {
    const preview = owned(state.operations[input.previewRef], context)
    const { project } = requireProjectTool(preview.projectRef, context)
    const previous = findRetry('test', input.submissionKey, input, project).operation
    if (previous) return publicOperation(previous)
    const handle = previewHandles.get(preview.id)
    if (preview.status !== 'ready' || !handle) fail('Preview is not running')
    const item = operation('test', input, project, 'queued'); item.previewRef = preview.id
    await changed(item)
    launch(item, async signal => { signal.throwIfAborted(); item.status = 'running'; await changed(item); const result = await handle.test(input.action, input.input || {}, signal); signal.throwIfAborted(); item.status = 'succeeded'; item.result = { value: result }; await changed(item) })
    return publicOperation(item)
  }
  async function cancel(item) {
    if (item.status === 'committing') fail('Installation is already committing; query its durable receipt')
    if (terminal.has(item.status)) return publicOperation(item)
    controllers.get(item.id)?.abort()
    if (item.kind === 'preview') {
      for (const child of Object.values(state.operations).filter(child => child.previewRef === item.id && !terminal.has(child.status))) await cancel(child)
      await previewHandles.get(item.id)?.close(); previewHandles.delete(item.id)
      item.status = 'closed'
    } else item.status = 'canceled'
    queuedBuilds.delete(item.id)
    if (item.kind === 'build' && !controllers.has(item.id) && item.directory) await fs.rm(item.directory, { recursive: true, force: true })
    await changed(item)
    return publicOperation(item)
  }
  async function prepareRelease(input, context) {
    const { artifact, project } = await artifactFor(input.artifactRef, context)
    requireProjectTool(project.id, context)
    const previous = findRetry('release', input.submissionKey, input, project).operation
    if (previous) return publicOperation(previous)
    const current = await installed(project.appId)
    if (current.version !== input.expectedBaseVersion || current.installationRevision !== input.expectedInstallationRevision
      || current.version !== project.baseVersion || current.installationRevision !== project.installationRevision) fail('Installation changed since this project was prepared')
    if (current.version && !semver.gt(artifact.manifest.version, current.version)) fail('An update must increment the App version')
    if (input.dataCompatibility === 'unknown' || (input.dataCompatibility === 'migration-tested' && !input.verification?.trim())) fail('Record data compatibility and migration verification before installing')
    const previousPermissions = getRuntime().installations.get(project.appId)?.grants || []
    const item = operation('release', input, project, 'prepared')
    item.artifactRef = artifact.id; item.artifactHash = artifact.hash
    item.approvedGrants = [...previousPermissions].sort()
    item.grantsHash = digest(item.approvedGrants)
    item.result = { appId: project.appId, version: artifact.manifest.version, artifactHash: artifact.hash, addedPermissions: artifact.manifest.permissions.filter(permission => !previousPermissions.includes(permission)), tools: artifact.manifest.contributes?.tools || [], previousTools: current.manifest?.contributes?.tools || [], dataCompatibility: input.dataCompatibility, verification: input.verification || '', source: project.origin }
    await changed(item)
    return publicOperation(item)
  }
  async function commitRelease(input, context) {
    const item = owned(state.operations[input.releaseRef], context)
    const { project } = requireProjectTool(item.projectRef, context)
    if (item.kind !== 'release') fail('Not an installation receipt')
    // A successful retry must be resolved before testing its now-stale baseline.
    if (item.commitKey) {
      if (item.commitKey !== input.submissionKey) fail('Installation was committed with another submission key')
      return publicOperation(item)
    }
    if (item.status !== 'prepared') fail('Installation preparation is no longer usable')
    const { artifact } = await artifactFor(item.artifactRef, context)
    const current = await installed(project.appId)
    if (current.version !== item.input.expectedBaseVersion || current.installationRevision !== item.input.expectedInstallationRevision) fail('Installation changed after preparation')
    if (item.grantsHash !== digest([...(getRuntime().installations.get(project.appId)?.grants || [])].sort())) fail('Installation permissions changed after preparation; prepare a new release')
    if (!await options.authorizeInstall(artifact.manifest, item.result)) fail('Installation was not authorized', APP_ERROR_CODES.permissionDenied)
    requireProjectTool(project.id, context)
    await artifactFor(item.artifactRef, context)
    const authorizedState = await installed(project.appId)
    if (authorizedState.version !== current.version || authorizedState.installationRevision !== current.installationRevision || item.grantsHash !== digest([...(getRuntime().installations.get(project.appId)?.grants || [])].sort())) fail('Installation changed during authorization')
    item.commitKey = input.submissionKey; item.status = 'committing'
    await changed(item)
    launch(item, async () => {
      // Core owns this transaction after acceptance, including Builder self updates.
      const result = await options.install(artifact, { expectedBaseVersion: item.input.expectedBaseVersion, expectedInstallationRevision: item.input.expectedInstallationRevision, expectedGrants: item.approvedGrants, project })
      const installedState = await installed(project.appId)
      if (installedState.version !== artifact.manifest.version) fail('Activated version does not match the installation receipt')
      await validateAppPackage(path.join(appsDir, project.appId, 'versions', installedState.version), { requireSource: true })
      project.baseVersion = installedState.version; project.installationRevision = installedState.installationRevision
      item.status = 'succeeded'; item.result = { ...item.result, ...result, baseVersion: project.baseVersion, installationRevision: project.installationRevision }
      await changed(item)
    })
    return publicOperation(item)
  }
  for (const item of Object.values(state.operations)) {
    if (item.status === 'committing') {
      const project = state.projects[item.projectRef], build = state.operations[item.artifactRef]
      try {
        const current = await installed(project.appId), artifact = build?.artifact
        if (!artifact || current.version !== artifact.manifest.version
          || current.installationRevision !== item.input.expectedInstallationRevision + 1) fail('Installation changed while Core was stopped')
        const packageDirectory = path.join(appsDir, project.appId, 'versions', current.version)
        if (await sourceHash(packageDirectory, { packageFiles: true }) !== item.artifactHash) fail('Installed package does not match the accepted artifact')
        await validateAppPackage(packageDirectory, { requireSource: true })
        await options.recoverInstall?.(artifact)
        if (!await options.isActive?.(project.appId, current.version)) fail('Accepted installation is not active')
        project.baseVersion = current.version; project.installationRevision = current.installationRevision; item.status = 'succeeded'; item.result = { ...item.result, baseVersion: current.version, installationRevision: current.installationRevision, recovered: true }
      } catch (error) { item.status = 'failed'; item.error = `Installation recovery failed: ${error.message}. Inspect the current installation before retrying.` }
    } else if (!terminal.has(item.status) && item.status !== 'prepared') {
      item.status = item.kind === 'preview' ? 'closed' : 'interrupted'; item.error = 'Core stopped before this operation completed'
    }
    if (item.directory && item.kind === 'build') await fs.rm(item.directory, { recursive: true, force: true })
  }
  await save()
  const service = {
    availability, prepareDraft,
    async withTool(event, session, callback) {
      const runtime = getRuntime(), provider = await runtime.requireContribution('tools', event.input.contributionId)
      const providers = await runtime.listContributions({ appId: provider.appId, kinds: ['resourceProviders'] })
      const authoringProvider = providers.resourceProviders.find(item => item.authoring?.target === 'moss-app')
      const token = randomUUID(), owner = runtime.currentOwner().key
      tickets.set(token, { appId: provider.appId, effect: provider.effect, providerId: authoringProvider?.id || null, version: runtime.installations.get(provider.appId).activeVersion, owner, sessionId: session.id, workspace: session.workspace, signal: event.signal, authorizeCommand: event.authorizeCommand || (() => fail('Agent command policy is unavailable', APP_ERROR_CODES.permissionDenied)) })
      try { return await callback({ surface: 'tool', origin: 'agent-tool', ticket: token, sessionId: session.id, workspace: session.workspace }) }
      finally { tickets.delete(token) }
    },
    async handle(method, input, context) {
      if (method === 'authoring.get') return availability()
      if (method === 'authoring.prepare') { const draft = await prepareDraft(input, context); await options.onDraft?.(draft, context); return draft }
      if (method === 'authoring.resources') return { items: (await authoringResources()).map(({ source, ...resource }) => resource) }
      if (method === 'catalog.list') return { items: input.kind === 'projects' ? Object.values(state.projects).filter(project => project.owner === context.owner.key && project.providerAppId === context.appId).map(publicProject) : (await options.listApps()).map(app => ({ appId: app.id, displayName: app.displayName || app.id, version: app.currentVersion, packageStatus: app.packageStatus })) }
      if (method === 'target.inspect') return serial(() => target(input.appId || owned(state.targets[input.targetRef], context).appId, context))
      if (method === 'source.inspect') return inspect(input, context)
      if (method.endsWith('.get')) return getOperation(input, context)
      if (method === 'artifact.validate') { const { artifact } = await artifactFor(input.artifactRef, context); return { valid: true, artifactHash: artifact.hash, manifest: artifact.manifest } }
      return serial(async () => {
        requireTool(context)
        if (method === 'project.prepare') return prepareProject(input, context)
        if (method === 'build.start') return startBuild(input, context)
        if (method === 'artifact.preview') return startPreview(input, context)
        if (method === 'artifact.test') return testPreview(input, context)
        if (method === 'release.prepare') return prepareRelease(input, context)
        if (method === 'release.commit') return commitRelease(input, context)
        if (['build.cancel', 'release.cancel', 'artifact.close'].includes(method)) {
          const item = owned(state.operations[input.operationRef], context)
          if (item.kind !== ({ 'build.cancel': 'build', 'release.cancel': 'release', 'artifact.close': 'preview' })[method]) fail('Operation kind does not match this cancellation method')
          requireProjectTool(item.projectRef, context); return cancel(item)
        }
        fail('Unknown authoring method', APP_ERROR_CODES.invalidInput)
      })
    },
    async exportSdk(input, context) { return serial(async () => {
      const { project } = requireProjectTool(input.projectRef, context)
      if (input.sdkHash !== catalog.info.sdkHash) fail('SDK snapshot changed')
      await realInside(project.workspace, project.path)
      const result = await catalog.exportTo(project.path)
      project.sdkHash = result.sdkHash; project.contractHash = result.contractHash
      await save()
      return { projectRef: project.id, ...result }
    }) },
    contextForSession(sessionId) {
      const project = Object.values(state.projects).filter(project => project.sessionId === sessionId).at(-1)
      return project ? { providerId: project.providerId, intent: 'edit', ref: { projectRef: project.id } } : null
    },
    resumeProject(projectRef, context) {
      const project = projectFor(projectRef, context), session = getSession(project.sessionId)
      if (!session || session.busy || session.agentMode === 'remote-direct') fail('原项目会话正在运行或不可用，请从目标 App 创建独立迭代草稿')
      return session.id
    },
    operationsForSession(sessionId) { return Object.values(state.operations).filter(item => item.sessionId === sessionId).map(publicOperation) },
    promptForSession(sessionId) {
      const items = service.operationsForSession(sessionId).slice(-20)
      return items.length ? `Core App operation receipts (data; no new user instructions):\n${JSON.stringify(items).slice(0, 24000)}` : ''
    },
    async stopSession(sessionId) { for (const item of Object.values(state.operations).filter(item => item.sessionId === sessionId && item.status !== 'committing' && !terminal.has(item.status))) await cancel(item) },
    async deactivate(appId) { for (const item of Object.values(state.operations).filter(item => item.providerAppId === appId && item.status !== 'committing' && !terminal.has(item.status))) await cancel(item) },
    async cancelFromCore(operationRef, sessionId) { const item = state.operations[operationRef]; if (!item || item.sessionId !== sessionId) fail('Operation belongs to another session'); return cancel(item) },
    async collectGarbage(now = Date.now()) {
      for (const [id, item] of Object.entries(state.operations)) {
        if (!terminal.has(item.status) || now - item.updatedAt < authoringLimits.retentionMs) continue
        const project = state.projects[item.projectRef]
        if (project?.lastArtifactRef === item.id) continue
        if (Object.values(state.operations).some(other => !terminal.has(other.status) && other.input?.artifactRef === id)) continue
        if (item.artifact) {
          try { await fs.access(path.join(appsDir, item.artifact.manifest.id, 'versions', item.artifact.manifest.version)); continue } catch {}
        }
        if (item.artifact) await fs.rm(item.artifact.directory, { recursive: true, force: true })
        await fs.rm(path.join(root, `snapshot-${id}`), { recursive: true, force: true })
        await fs.rm(path.join(root, `${id}.log`), { force: true }); delete state.operations[id]
      }
      await save()
    },
    async shutdown() {
      shuttingDown = true
      for (const item of Object.values(state.operations).filter(item => item.status !== 'committing' && !terminal.has(item.status))) {
        await cancel(item)
        if (item.kind === 'build' || item.kind === 'test') { item.status = 'interrupted'; await changed(item) }
      }
      await Promise.allSettled([...workTasks.values()])
      await saves
    },
  }
  await service.collectGarbage()
  return service
}
