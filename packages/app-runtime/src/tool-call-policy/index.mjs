import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { toolCallPolicyKey } from './identity.mjs'
export { toolCallPolicyKey } from './identity.mjs'

export class AppToolCallPolicyStore {
  constructor(file) {
    this.file = file
    this.values = {}
    try {
      const document = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (document.version !== 1 || !Array.isArray(document.entries)) throw new Error('Invalid tool call policies')
      for (const [ownerApp, key, mode] of document.entries) {
        if (typeof ownerApp !== 'string' || typeof key !== 'string' || mode !== 'draft') throw new Error('Invalid tool call policy')
        this.values[JSON.stringify([ownerApp, key])] = mode
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  list(ownerApp) {
    return Object.fromEntries(Object.entries(this.values).flatMap(([encoded, mode]) => {
      const [app, key] = JSON.parse(encoded)
      return app === ownerApp ? [[key, mode]] : []
    }))
  }
  get(ownerApp, identity) { return this.values[JSON.stringify([ownerApp, toolCallPolicyKey(identity)])] || 'normal' }
  set(ownerApp, identity, mode) {
    if (!['normal', 'draft'].includes(mode)) throw new Error('调用方式必须为正常调用或草稿确认。')
    const key = JSON.stringify([ownerApp, toolCallPolicyKey(identity)])
    const next = { ...this.values }
    if (mode === 'normal') delete next[key]
    else next[key] = mode
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, entries: Object.entries(next).map(([id, value]) => [...JSON.parse(id), value]) }), { mode: 0o600 })
      fs.renameSync(temporary, this.file)
    } finally { fs.rmSync(temporary, { force: true }) }
    this.values = next
    return this.list(ownerApp)
  }
}
