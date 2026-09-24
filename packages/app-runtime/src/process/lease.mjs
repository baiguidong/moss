import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { APP_ERROR_CODES, AppServiceError } from '../../../app-sdk/src/index.mjs'
import { findMarkedProcesses, hasProcessMarker, readProcessInfo } from './process-info.mjs'

const ownerFilePattern = /^[a-f0-9-]{36}\.json$/
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const unavailable = message => new AppServiceError(APP_ERROR_CODES.backendUnavailable, message)

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

async function sameProcess(info, marker, appId) {
  const current = await readProcessInfo(info.pid)
  if (current?.started !== info.started) return false
  if (!hasProcessMarker(current, marker)) {
    throw unavailable(`Cannot verify the previous App Backend identity; refusing to start another process: ${appId}`)
  }
  return true
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

  async acquire(definition) {
    const base = this.directory || path.join(definition.runtimeDir, 'processes')
    await fs.mkdir(base, { recursive: true, mode: 0o700 })
    const directory = path.join(base, createHash('sha256').update(definition.appId).digest('hex'))
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
      },
      release: () => removeLease(directory, id),
    }
  }

  async recover(directory, appId, { skipActive = false } = {}) {
    let entries
    try { entries = await fs.readdir(directory) } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    if (!entries.length) {
      await fs.rmdir(directory).catch(error => {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error
      })
      return
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
      || createHash('sha256').update(record.appId).digest('hex') !== path.basename(directory)
      || record.marker !== `--moss-app-process=${record.id}` || !Number.isSafeInteger(record.owner?.pid)
      || record.owner.pid < 1 || typeof record.owner.started !== 'string' || !record.owner.started) {
      throw unavailable(`Invalid App Backend ownership record: ${appId}`)
    }
    appId = record.appId
    const owner = await readProcessInfo(record.owner.pid)
    if (owner?.started === record.owner.started) {
      if (skipActive) return
      throw unavailable(`App Backend is already running in another Host: ${appId}`)
    }
    let savedChild = null
    try { savedChild = JSON.parse(await fs.readFile(path.join(directory, `${record.id}.child.json`), 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw unavailable(`Cannot read App Backend process record: ${appId}`)
    }
    let recordedProcess = null
    if (savedChild) {
      if (!Number.isSafeInteger(savedChild.pid) || savedChild.pid < 1 || typeof savedChild.started !== 'string' || !savedChild.started) {
        throw unavailable(`Invalid App Backend process record: ${appId}`)
      }
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
      if (!await sameProcess(child, marker, appId)) return
      try { process.kill(child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
      const deadline = Date.now() + timeout
      do {
        if (!await sameProcess(child, marker, appId)) return
        await delay(25)
      } while (Date.now() < deadline)
    }
    throw unavailable(`Orphaned App Backend did not exit; refusing to start another process: ${appId}`)
  }
}
