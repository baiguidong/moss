import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { writeJsonFileAtomicAsync } from '../shared/json-files.mjs'

const PREFERENCES_VERSION = 2

export function normalizeAppPreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  return {
    sections: {
      installed: ['local', 'online', 'all'].includes(value.sections?.installed) ? value.sections.installed : 'all',
      marketplace: ['local', 'online', 'all'].includes(value.sections?.marketplace) ? value.sections.marketplace : 'all',
    },
  }
}

function storedAppPreferences(value) {
  return { schemaVersion: PREFERENCES_VERSION, ...value }
}

export function createAppDiscoveryPreferences({ rootDir }) {
  const queues = new Map()
  const file = owner => path.join(rootDir, `${createHash('sha256').update(String(owner || 'desktop')).digest('hex')}.json`)
  async function readFile(owner) {
    try {
      const stored = JSON.parse(await fs.readFile(file(owner), 'utf8'))
      const value = normalizeAppPreferences(stored)
      // Older profiles persisted the former default of "local" even when the
      // user only changed the installed Apps filter. Show the full market once
      // on upgrade; explicit choices made after this version remain persistent.
      if (stored.schemaVersion !== PREFERENCES_VERSION && value.sections.marketplace === 'local') {
        value.sections.marketplace = 'all'
      }
      return { value, needsMigration: JSON.stringify(stored) !== JSON.stringify(storedAppPreferences(value)) }
    } catch (error) {
      if (error.code === 'ENOENT') return { value: normalizeAppPreferences(), needsMigration: false }
      throw error
    }
  }
  function enqueue(owner, operation) {
    const key = file(owner)
    const task = (queues.get(key) || Promise.resolve()).catch(() => {}).then(operation)
    queues.set(key, task)
    void task.finally(() => { if (queues.get(key) === task) queues.delete(key) }).catch(() => {})
    return task
  }
  function read(owner) {
    return enqueue(owner, async () => {
      const { value, needsMigration } = await readFile(owner)
      if (needsMigration) await writeJsonFileAtomicAsync(file(owner), storedAppPreferences(value))
      return value
    })
  }
  function update(owner, input = {}) {
    return enqueue(owner, async () => {
      const { value: current } = await readFile(owner)
      if (input.action !== 'section' || !Object.hasOwn(current.sections, input.surface)
        || !['local', 'online', 'all'].includes(input.section)) throw new Error('Invalid App section')
      current.sections[input.surface] = input.section
      const next = normalizeAppPreferences(current)
      await fs.mkdir(rootDir, { recursive: true, mode: 0o700 })
      await writeJsonFileAtomicAsync(file(owner), storedAppPreferences(next))
      return next
    })
  }
  return { read, update }
}
