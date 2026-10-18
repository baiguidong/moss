import fs from 'node:fs/promises'
import path from 'node:path'
import { writePrivateFileAtomic } from '../../../shared/security/credential-crypto.mjs'

const MAX_BYTES = 512 * 1024
const file = dataDir => path.join(dataDir, 'mcp-tool-catalog.json')

// Display metadata only. Never restore connection state, schemas or credentials.
export function catalogSnapshot(check, redact = value => value) {
  if (!check || !Array.isArray(check.tools) || !Number.isFinite(check.checkedAt) || check.checkedAt < 0) return null
  const tools = check.tools.slice(0, 200).filter(tool => tool && typeof tool.name === 'string' && tool.name.length > 0).map(tool => ({
    name: redact(tool.name).slice(0, 256), description: redact(typeof tool.description === 'string' ? tool.description : '').slice(0, 1500), disabled: tool.disabled === true,
  }))
  return { tools, checkedAt: check.checkedAt, truncated: Boolean(check.truncated || check.tools.length > tools.length) }
}

export async function readToolCatalog(dataDir) {
  try {
    if ((await fs.stat(file(dataDir))).size > MAX_BYTES) return {}
    const value = JSON.parse(await fs.readFile(file(dataDir), 'utf8'))
    if (value.version !== 1 || !value.services || typeof value.services !== 'object') return {}
    return Object.fromEntries(Object.entries(value.services).slice(0, 200).flatMap(([name, entry]) => {
      const snapshot = catalogSnapshot(entry)
      return snapshot && typeof entry.revision === 'string' && entry.revision.length < 512 ? [[name, { ...snapshot, revision: entry.revision }]] : []
    }))
  } catch { return {} } // Corrupt or old display caches must not break App startup.
}

export async function writeToolCatalog(dataDir, services) {
  const bounded = Object.create(null)
  for (const [name, entry] of Object.entries(services).sort((a, b) => b[1].checkedAt - a[1].checkedAt)) {
    const next = { ...bounded, [name]: entry }
    if (Buffer.byteLength(JSON.stringify({ version: 1, services: next })) <= MAX_BYTES) bounded[name] = entry
  }
  await fs.mkdir(dataDir, { recursive: true })
  writePrivateFileAtomic(file(dataDir), JSON.stringify({ version: 1, services: bounded }) + '\n')
}
