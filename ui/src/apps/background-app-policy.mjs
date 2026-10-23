import { existsSync } from 'node:fs'
import path from 'node:path'

export async function shouldRestoreBackgroundApp({ manifest, instance, dataDir }) {
  if (manifest.publisher?.id !== 'moss') return true
  if (manifest.id === 'moss.memory' || manifest.id === 'moss.knowledge-rag') return false
  if (manifest.id === 'moss.audit') return instance.config?.continuousAudit === true
  if (manifest.id !== 'moss.library' || instance.config?.watchSources === true) return true
  const file = path.join(dataDir, 'library.db')
  if (!existsSync(file)) return false
  const sqlite = await import(process.versions.bun ? 'bun:sqlite' : 'node:sqlite')
  const database = sqlite.DatabaseSync ? new sqlite.DatabaseSync(file, { readOnly: true }) : new sqlite.Database(file, { readonly: true })
  try { return Boolean(database.prepare("SELECT 1 FROM library_jobs WHERE status IN ('queued', 'running') LIMIT 1").get()) }
  finally { database.close() }
}
