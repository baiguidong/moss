import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** User choices are outside signed packages and scoped by Runtime owner + App. */
export class AppToolScopeStore {
  constructor(file) {
    this.file = file
    this.values = Object.create(null)
    try {
      const document = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (document.version !== 1 || !document.scopes || typeof document.scopes !== 'object' || Array.isArray(document.scopes)) throw new Error('Invalid App tool scope settings')
      for (const [key, value] of Object.entries(document.scopes)) {
        if (value !== 'session' && value !== 'global') throw new Error('Invalid App tool scope')
        this.values[key] = value
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  get(key) { return this.values[key] }
  set(key, scope) {
    if (scope !== null && scope !== 'session' && scope !== 'global') throw new Error('Invalid App tool scope')
    if ((this.values[key] ?? null) === scope) return false
    const next = Object.assign(Object.create(null), this.values)
    if (scope === null) delete next[key]
    else next[key] = scope
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, scopes: next }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, this.file)
      this.values = next
    } finally { fs.rmSync(temporary, { force: true }) }
    return true
  }
}
