import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { writeJsonFileAtomicAsync } from '../shared/json-files.mjs'

const PREFERENCES_VERSION = 4

export function normalizeAppPreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  return {
    sections: {
      installed: ['app', 'tool'].includes(value.sections?.installed) ? value.sections.installed : 'app',
      marketplace: ['app', 'tool'].includes(value.sections?.marketplace) ? value.sections.marketplace : 'app',
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
        || !['app', 'tool'].includes(input.section)) throw new Error('Invalid App section')
      current.sections[input.surface] = input.section
      const next = normalizeAppPreferences(current)
      await fs.mkdir(rootDir, { recursive: true, mode: 0o700 })
      await writeJsonFileAtomicAsync(file(owner), storedAppPreferences(next))
      return next
    })
  }
  return { read, update }
}
