import { createHash, randomUUID } from 'crypto'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import JSZip from 'jszip'
import type { SessionRecord } from './types.js'

export const MAX_PROFILE_ARCHIVE_BYTES = 64 * 1024 * 1024
export const MAX_PROFILE_EXPANDED_BYTES = 256 * 1024 * 1024
export const MAX_PROFILE_FILES = 10_000
export const MAX_MEMORY_FILE_BYTES = 512 * 1024

const SKILL_SYNC_MANIFEST = '.desktop-skills-sync.json'
const skillInstallQueues = new Map<string, Promise<void>>()

function safeRelativePath(value: unknown, label: string): string {
  const normalized = typeof value === 'string'
    ? value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
    : ''
  const parts = normalized.split('/')
  if (
    !normalized ||
    normalized.length > 4096 ||
    isAbsolute(normalized) ||
    parts.some(part => !part || part === '.' || part === '..' || part.length > 255)
  ) {
    throw new Error(`Invalid ${label}.`)
  }
  return parts.join('/')
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function resolveProfileDirectory(
  profileDir: string,
  childName: string,
  create: boolean,
): Promise<string | null> {
  if (create) await mkdir(profileDir, { recursive: true, mode: 0o700 })
  let realProfileDir: string
  try {
    realProfileDir = await realpath(profileDir)
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw error
  }

  const childPath = join(realProfileDir, childName)
  if (create) await mkdir(childPath, { recursive: true, mode: 0o700 })
  let metadata
  try {
    metadata = await lstat(childPath)
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw error
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Profile ${childName} root is not a safe directory.`)
  }
  const realChildPath = await realpath(childPath)
  if (!isInside(realProfileDir, realChildPath)) {
    throw new Error(`Profile ${childName} root is outside the profile.`)
  }
  return realChildPath
}

async function resolveSafeSkillTarget(
  skillsRoot: string,
  relativePath: string,
  createParents: boolean,
): Promise<string | null> {
  await mkdir(skillsRoot, { recursive: true, mode: 0o700 })
  const realRoot = await realpath(skillsRoot)
  const parts = safeRelativePath(relativePath, 'skill path').split('/')
  const fileName = parts.pop()!
  let parent = realRoot
  for (const part of parts) {
    const next = join(parent, part)
    try {
      const metadata = await lstat(next)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error('Skill destination contains an unsafe path component.')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      if (!createParents) return null
      await mkdir(next, { mode: 0o700 })
    }
    parent = next
  }
  const target = join(parent, fileName)
  if (!isInside(realRoot, target)) throw new Error('Skill path is outside the profile.')
  return target
}

function stripQuotes(value: string): string {
  const text = value.trim()
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1).trim()
  }
  return text
}

function parseMemoryDocumentHead(raw: string, relativePath: string) {
  const metadata: Record<string, string> = {}
  let body = raw
  if (raw.startsWith('---\n') || raw.startsWith('---\r\n')) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (match) {
      for (const line of match[1]!.split(/\r?\n/)) {
        const field = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/)
        if (field) metadata[field[1]!.toLowerCase()] = stripQuotes(field[2]!)
      }
      body = raw.slice(match[0].length)
    }
  }
  const isIndex = relativePath === 'MEMORY.md'
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || ''
  const fileName = relativePath.split('/').at(-1)?.replace(/\.md$/i, '') || relativePath
  return {
    title: isIndex ? '记忆索引' : metadata.name || heading || fileName,
    description: metadata.description || '',
    type: isIndex ? 'index' : metadata.type || 'memory',
    isIndex,
  }
}

function parseMemoryIndexPaths(raw: string): Set<string> {
  const paths = new Set<string>()
  for (const match of raw.matchAll(/\[[^\]]*\]\(([^)\r\n]+)\)/g)) {
    let target = String(match[1] || '').trim()
    if (target.startsWith('<') && target.endsWith('>')) {
      target = target.slice(1, -1).trim()
    } else {
      target = target.replace(/\s+["'].*$/, '').trim()
    }
    target = target.replace(/^\.\/+/, '')
    try {
      paths.add(safeRelativePath(target, 'memory path'))
    } catch {}
  }
  return paths
}

async function readBoundedMarkdown(filePath: string) {
  const metadata = await stat(filePath)
  if (!metadata.isFile()) throw new Error('Memory entry is not a file.')
  if (metadata.size > MAX_MEMORY_FILE_BYTES) {
    throw new Error('Memory entry is too large to read.')
  }
  const content = await readFile(filePath, 'utf8')
  return {
    content,
    bytes: metadata.size,
    updatedAt: metadata.mtimeMs,
    readable: true,
  }
}

async function resolveExistingFileWithin(root: string, relativePath: string): Promise<string> {
  const normalized = safeRelativePath(relativePath, 'memory path')
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(resolve(root, normalized)),
  ])
  if (!isInside(realRoot, realTarget)) throw new Error('Memory path is outside the profile.')
  return realTarget
}

export async function listProfileMemory(profileDir: string) {
  const root = await resolveProfileDirectory(profileDir, 'memory', false)
  if (!root) return []
  let indexedPaths = new Set<string>()
  try {
    indexedPaths = parseMemoryIndexPaths(await readFile(join(root, 'MEMORY.md'), 'utf8'))
  } catch {}

  const files: Array<Record<string, unknown>> = []
  async function walk(directory: string, prefix = ''): Promise<void> {
    if (files.length >= 500) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (files.length >= 500) break
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      const fileStat = await stat(fullPath)
      let head = ''
      if (fileStat.size <= MAX_MEMORY_FILE_BYTES) {
        head = (await readFile(fullPath)).subarray(0, 64 * 1024).toString('utf8')
      }
      const document = parseMemoryDocumentHead(head, relativePath)
      files.push({
        id: relativePath,
        path: relativePath,
        ...document,
        indexed: document.isIndex || indexedPaths.has(relativePath),
        bytes: fileStat.size,
        updatedAt: fileStat.mtimeMs,
        readable: fileStat.size <= MAX_MEMORY_FILE_BYTES,
      })
    }
  }
  await walk(root)
  return files
}

export async function readProfileMemory(profileDir: string, relativePath: string) {
  const root = await resolveProfileDirectory(profileDir, 'memory', false)
  if (!root) {
    const error = new Error('Memory root does not exist.') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    throw error
  }
  return readBoundedMarkdown(
    await resolveExistingFileWithin(root, relativePath),
  )
}

export function getSessionMemoryPath(session: SessionRecord): string {
  return join(
    session.runtime.transcriptDir,
    session.transcriptSessionId,
    'session-memory',
    'summary.md',
  )
}

export async function readSessionMemory(session: SessionRecord) {
  try {
    const transcriptRoot = await realpath(session.runtime.transcriptDir)
    const summaryPath = await realpath(getSessionMemoryPath(session))
    if (!isInside(transcriptRoot, summaryPath)) {
      throw new Error('Session memory path is outside the transcript root.')
    }
    const metadata = await stat(summaryPath)
    if (!metadata.isFile()) throw new Error('Session memory entry is not a file.')
    if (metadata.size > MAX_MEMORY_FILE_BYTES) {
      return {
        exists: true,
        content: '',
        bytes: metadata.size,
        updatedAt: metadata.mtimeMs,
        readable: false,
      }
    }
    return { exists: true, ...(await readBoundedMarkdown(summaryPath)) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { exists: false, content: '', bytes: 0, updatedAt: null, readable: true }
    }
    throw error
  }
}

function normalizeArchivePath(value: string): string {
  const normalized = safeRelativePath(value, 'skill archive path')
  if (normalized.split('/').length < 2) {
    throw new Error('Skill archive entries must include a skill directory.')
  }
  return normalized
}

async function readSkillSyncManifest(profileDir: string): Promise<{
  revision: string
  files: string[]
}> {
  try {
    const manifestPath = join(profileDir, SKILL_SYNC_MANIFEST)
    const metadata = await lstat(manifestPath)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return { revision: '', files: [] }
    }
    const parsed = JSON.parse(
      await readFile(manifestPath, 'utf8'),
    ) as { revision?: unknown; files?: unknown }
    return {
      revision: typeof parsed.revision === 'string' ? parsed.revision : '',
      files: Array.isArray(parsed.files)
        ? parsed.files.filter((file): file is string => typeof file === 'string')
        : [],
    }
  } catch {
    return { revision: '', files: [] }
  }
}

export async function getSkillSyncStatus(profileDir: string) {
  const manifest = await readSkillSyncManifest(profileDir)
  return { revision: manifest.revision, fileCount: manifest.files.length }
}

async function installSkillArchiveUnlocked(
  profileDir: string,
  archive: Buffer,
  requestedRevision = '',
) {
  if (archive.length > MAX_PROFILE_ARCHIVE_BYTES) {
    throw new Error('Skill archive is too large.')
  }
  const revision = `sha256:${createHash('sha256').update(archive).digest('hex')}`
  if (requestedRevision && requestedRevision !== revision) {
    throw new Error('Skill archive checksum mismatch.')
  }

  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  const realProfileDir = await realpath(profileDir)
  const skillsRoot = await resolveProfileDirectory(realProfileDir, 'skills', true)
  if (!skillsRoot) throw new Error('Unable to resolve the profile skills directory.')
  const previous = await readSkillSyncManifest(realProfileDir)
  if (previous.revision === revision) {
    return { revision, fileCount: previous.files.length, unchanged: true }
  }

  const zip = await JSZip.loadAsync(archive)
  const files = Object.values(zip.files).filter(entry => !entry.dir)
  if (files.length > MAX_PROFILE_FILES) throw new Error('Skill archive has too many files.')

  const stagedRoot = join(realProfileDir, `.skills-sync-${randomUUID()}`)
  const written: string[] = []
  let expandedBytes = 0
  await mkdir(stagedRoot, { recursive: true })
  try {
    for (const entry of files) {
      const relativePath = normalizeArchivePath(entry.name)
      const declaredSize = Number(
        (entry as unknown as { _data?: { uncompressedSize?: number } })._data
          ?.uncompressedSize,
      )
      if (Number.isFinite(declaredSize) && declaredSize >= 0) {
        expandedBytes += declaredSize
        if (expandedBytes > MAX_PROFILE_EXPANDED_BYTES) {
          throw new Error('Expanded skill archive is too large.')
        }
      }
      const content = await entry.async('nodebuffer')
      if (!Number.isFinite(declaredSize)) expandedBytes += content.length
      if (content.length > MAX_PROFILE_EXPANDED_BYTES || expandedBytes > MAX_PROFILE_EXPANDED_BYTES) {
        throw new Error('Expanded skill archive is too large.')
      }
      const targetPath = resolve(stagedRoot, relativePath)
      if (!isInside(stagedRoot, targetPath)) throw new Error('Skill archive path escapes its root.')
      await mkdir(dirname(targetPath), { recursive: true })
      const mode = typeof entry.unixPermissions === 'number'
        ? entry.unixPermissions & 0o777
        : 0o600
      await writeFile(targetPath, content, { mode: mode || 0o600 })
      written.push(relativePath)
    }

    const writtenSet = new Set(written)
    for (const relativePath of previous.files) {
      if (writtenSet.has(relativePath)) continue
      const stalePath = await resolveSafeSkillTarget(skillsRoot, relativePath, false)
      if (stalePath) await rm(stalePath, { force: true })
    }
    for (const relativePath of written) {
      const sourcePath = resolve(stagedRoot, relativePath)
      const targetPath = await resolveSafeSkillTarget(skillsRoot, relativePath, true)
      if (!targetPath) throw new Error('Unable to resolve skill destination.')
      try {
        const targetStat = await lstat(targetPath)
        if (targetStat.isSymbolicLink()) await rm(targetPath, { force: true })
        else if (!targetStat.isFile()) throw new Error('Skill destination is not a file.')
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      }
      await writeFile(targetPath, await readFile(sourcePath))
      await chmod(targetPath, (await stat(sourcePath)).mode & 0o777)
    }
    const manifestPath = join(realProfileDir, SKILL_SYNC_MANIFEST)
    const temporaryManifestPath = `${manifestPath}.${process.pid}-${randomUUID()}.tmp`
    try {
      await writeFile(
        temporaryManifestPath,
        `${JSON.stringify({ version: 1, revision, files: written }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
      await rename(temporaryManifestPath, manifestPath)
    } finally {
      await rm(temporaryManifestPath, { force: true }).catch(() => {})
    }
    return { revision, fileCount: written.length, unchanged: false }
  } finally {
    await rm(stagedRoot, { recursive: true, force: true })
  }
}

export async function installSkillArchive(
  profileDir: string,
  archive: Buffer,
  requestedRevision = '',
) {
  const key = resolve(profileDir)
  const previous = skillInstallQueues.get(key) ?? Promise.resolve()
  const operation = previous
    .catch(() => {})
    .then(() => installSkillArchiveUnlocked(profileDir, archive, requestedRevision))
  const tail = operation.then(() => {}, () => {})
  skillInstallQueues.set(key, tail)
  try {
    return await operation
  } finally {
    if (skillInstallQueues.get(key) === tail) skillInstallQueues.delete(key)
  }
}
