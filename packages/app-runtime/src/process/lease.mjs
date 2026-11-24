import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { APP_ERROR_CODES, AppServiceError } from '../../../app-sdk/src/index.mjs'
import {
  findMarkedProcesses,
  hasProcessMarker,
  processTreeExists,
  readProcessInfo,
  signalProcessTree,
  waitForProcessTreeGone,
} from './process-info.mjs'

const ownerFilePattern = /^[a-f0-9-]{36}\.json$/
const unavailable = message => new AppServiceError(APP_ERROR_CODES.backendUnavailable, message)
const leaseDirectoryName = appId => createHash('sha256').update(appId).digest('hex')

async function removeLease(directory, id) {
  // Never recursively remove the shared path: another Host may already own it.
  for (const suffix of ['.child.json', '.child.tmp']) {
    await fs.unlink(path.join(directory, id + suffix)).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  try { await fs.unlink(path.join(directory, `${id}.json`)) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  await fs.rmdir(directory).catch(error => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error
  })
}

export class AppProcessLeases {
  constructor({ directory, killTimeoutMs = 2_000, onRecover = () => {} }) {
    this.directory = directory
    this.killTimeoutMs = killTimeoutMs
    this.onRecover = onRecover
  }

  async recoverAll() {
    if (!this.directory) return []
    let entries
    try { entries = await fs.readdir(this.directory, { withFileTypes: true }) } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const errors = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue
      try { await this.recover(path.join(this.directory, entry.name), null, { skipActive: true }) } catch (error) {
        errors.push(error)
      }
    }
    return errors
  }

  async listOccupants(ownerKey) {
    if (!this.directory) return []
    const entries = await fs.readdir(this.directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const occupants = await Promise.all(entries
      .filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
      .map(entry => this.inspect(path.join(this.directory, entry.name), null, ownerKey).catch(() => null)))
    return occupants.filter(Boolean)
  }

  async inspect(directory, appId, ownerKey) {
    const record = await this.readLease(directory, appId)
    if (!record || record.appOwner?.key !== ownerKey) return null
    const owner = await readProcessInfo(record.owner.pid)
    const activeHost = owner?.started === record.owner.started
    const child = await this.readChild(directory, record.id, record.appId)
    const current = child && await readProcessInfo(child.pid)
    const matchingChild = current?.started === child?.started && hasProcessMarker(current, record.marker)
    const stoppedChild = Boolean(child && (!current || current.started !== child.started) && !processTreeExists(child.pid))
    return {
      appId: record.appId,
      instanceId: record.instanceId,
      leaseId: record.id,
      ownerPid: activeHost ? owner.pid : null,
      pid: matchingChild ? current.pid : null,
      state: stoppedChild ? 'stale' : !activeHost ? 'orphan' : owner.pid !== process.pid ? 'other-host' : 'owned',
    }
  }

  async releaseOccupant(appId, leaseId, ownerKey) {
    const directory = path.join(this.directory, leaseDirectoryName(appId))
    const occupant = await this.inspect(directory, appId, ownerKey)
    if (!occupant || occupant.leaseId !== leaseId) throw unavailable('App 占用状态已变化，请刷新后重试。')
    if (occupant.state === 'stale') {
      await this.recover(directory, appId, { expectedLeaseId: leaseId, clearStopped: true })
    } else if (occupant.state === 'orphan') {
      await this.recover(directory, appId, { expectedLeaseId: leaseId })
    } else {
      throw unavailable('此后台仍由 Moss 管理，请在对应的 Moss 窗口重启该 App。')
    }
  }

  async acquire(definition) {
    const base = this.directory || path.join(definition.runtimeDir, 'processes')
    await fs.mkdir(base, { recursive: true, mode: 0o700 })
    const directory = path.join(base, leaseDirectoryName(definition.appId))
    const owner = await readProcessInfo(process.pid)
    if (!owner) throw unavailable('Cannot identify the App Backend Host process')
    const id = randomUUID()
    const marker = `--moss-app-process=${id}`
    const record = {
      schemaVersion: 1, id, marker, appId: definition.appId, instanceId: definition.instanceId,
      appOwner: definition.owner || null, owner: { pid: owner.pid, started: owner.started },
    }
    const staging = await fs.mkdtemp(path.join(base, '.pending-'))
    try {
      await fs.writeFile(path.join(staging, `${id}.json`), JSON.stringify(record), { mode: 0o600 })
      for (let attempt = 0; ; attempt++) {
        try {
          // A nonempty directory is published atomically and cannot replace a live lease.
          await fs.rename(staging, directory)
          break
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error
          if (attempt >= 5) throw unavailable(`Cannot acquire App Backend ownership: ${definition.appId}`)
          await this.recover(directory, definition.appId)
        }
      }
    } finally { await fs.rm(staging, { recursive: true, force: true }) }

    return {
      marker,
      async recordChild(pid) {
        const child = await readProcessInfo(pid)
        if (!hasProcessMarker(child, marker)) throw unavailable('Cannot identify the launched App Backend')
        const temporary = path.join(directory, `${id}.child.tmp`)
        await fs.writeFile(temporary, JSON.stringify({ pid, started: child.started }), { mode: 0o600 })
        await fs.rename(temporary, path.join(directory, `${id}.child.json`))
        return child
      },
      release: () => removeLease(directory, id),
    }
  }

  async readLease(directory, appId) {
    let entries
    try { entries = await fs.readdir(directory) } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    if (!entries.length) {
      return null
    }
    const files = entries.filter(name => ownerFilePattern.test(name))
    if (files.length !== 1) throw unavailable(`Invalid App Backend ownership record: ${appId}`)
    let record
    try { record = JSON.parse(await fs.readFile(path.join(directory, files[0]), 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return
      throw unavailable(`Cannot read App Backend ownership record: ${appId}`)
    }
    if (record.schemaVersion !== 1 || `${record.id}.json` !== files[0]
      || typeof record.appId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,159}$/.test(record.appId)
      || (appId && record.appId !== appId)
      || leaseDirectoryName(record.appId) !== path.basename(directory)
      || record.marker !== `--moss-app-process=${record.id}` || !Number.isSafeInteger(record.owner?.pid)
      || record.owner.pid < 1 || typeof record.owner.started !== 'string' || !record.owner.started) {
      throw unavailable(`Invalid App Backend ownership record: ${appId}`)
    }
    return record
  }

  async readChild(directory, leaseId, appId) {
    let savedChild = null
    try { savedChild = JSON.parse(await fs.readFile(path.join(directory, `${leaseId}.child.json`), 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw unavailable(`Cannot read App Backend process record: ${appId}`)
    }
    if (savedChild && (!Number.isSafeInteger(savedChild.pid) || savedChild.pid < 1 || typeof savedChild.started !== 'string' || !savedChild.started)) {
      throw unavailable(`Invalid App Backend process record: ${appId}`)
    }
    return savedChild
  }

  async recover(directory, appId, { skipActive = false, expectedLeaseId, clearStopped = false } = {}) {
    const record = await this.readLease(directory, appId)
    if (!record) {
      await fs.rmdir(directory).catch(error => {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error
      })
      return
    }
    if (expectedLeaseId && record.id !== expectedLeaseId) throw unavailable('App 占用状态已变化，请刷新后重试。')
    appId = record.appId
    const owner = await readProcessInfo(record.owner.pid)
    if (owner?.started === record.owner.started) {
      // On this Host a failed shutdown can leave a lease after its group has gone.
      // Foreign live Hosts require an explicit request before clearing even an empty lease.
      if (owner.pid === process.pid || clearStopped) {
        const child = await this.readChild(directory, record.id, appId)
        if (child && !processTreeExists(child.pid)) {
          const current = await readProcessInfo(child.pid)
          if (current?.started !== child.started && !(await findMarkedProcesses(record.marker)).length) {
            await removeLease(directory, record.id)
            return
          }
        }
      }
      if (skipActive) return
      throw unavailable(`App Backend is already running in another Host: ${appId}。可在「概览 → 资源监控」查看占用情况。`)
    }
    const savedChild = await this.readChild(directory, record.id, appId)
    let recordedProcess = null
    if (savedChild) {
      const current = await readProcessInfo(savedChild.pid)
      if (current?.started === savedChild.started && !hasProcessMarker(current, record.marker)) {
        throw unavailable(`Cannot verify the previous App Backend identity; refusing to start another process: ${appId}`)
      }
      if (current?.started === savedChild.started) recordedProcess = current
    }
    // The unique command-line marker prevents an old PID from targeting a reused process.
    const children = await findMarkedProcesses(record.marker)
    // Do not lose a recorded child if it changes its process title during the
    // scan. Termination must reverify it or fail closed, rather than release.
    if (recordedProcess && !children.some(child => child.pid === recordedProcess.pid)) children.push(recordedProcess)
    // The Backend can exit after losing its Host while a helper remains in
    // the detached process group.  Its command line no longer carries the
    // launch marker, so the process scan cannot find it.  The durable child
    // identity still pins the group leader PID; recover that group before
    // releasing the lease instead of silently orphaning the helper.
    if (!recordedProcess && savedChild && await processTreeExists(savedChild.pid)) {
      children.push({ pid: savedChild.pid, started: savedChild.started, command: '' })
    }
    for (const child of children) {
      if (savedChild?.pid === child.pid && savedChild.started !== child.started) {
        throw unavailable(`App Backend process identity changed: ${appId}`)
      }
      await this.terminateOrphan(child, record.marker, appId)
      this.onRecover({ appId, instanceId: record.instanceId, owner: record.appOwner, pid: child.pid })
    }
    await removeLease(directory, record.id)
  }

  async terminateOrphan(child, marker, appId) {
    for (const [signal, timeout] of [['SIGTERM', this.killTimeoutMs], ['SIGKILL', 2_000]]) {
      const current = await readProcessInfo(child.pid)
      if (!current) {
        // A detached Backend can have exited while one of its helpers still
        // occupies the process group.  The group was already identified by
        // the marked root before this loop, so finish reaping it.  If there is
        // no group either, the orphan is already gone.
        if (!processTreeExists(child.pid)) return
        // The durable lease identifies the detached process group even when
        // its leader has already exited.  A reused PID would still be caught
        // by the identity check above whenever a process is present.
      } else {
        if (current.started !== child.started) throw unavailable(`App Backend process identity changed: ${appId}`)
        if (!hasProcessMarker(current, marker)) {
          throw unavailable(`Cannot verify the previous App Backend identity; refusing to terminate an unverified process: ${appId}`)
        }
      }
      await signalProcessTree(child.pid, signal)
      if (await waitForProcessTreeGone(child.pid, timeout)) return
    }
    throw unavailable(`Orphaned App Backend did not exit; refusing to start another process: ${appId}`)
  }
}
