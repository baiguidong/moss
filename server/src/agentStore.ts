import { createHash } from 'crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import path from 'path'
import {
  fetchSkillHubSkillDetail,
  getInstalledSkills,
  installHubSkill,
  type InstalledSkillInfo,
} from './skillStore.js'
import { MOSS_HOME } from './lib/env.js'

const HUB_AUTHORIZATION =
  String(process.env.MOSS_HUB_AUTHORIZATION || 'sud0@sudo').trim() || 'sud0@sudo'

const MOSS_ASSISTANTS_DIR = path.join(MOSS_HOME, 'assistants')
const LEGACY_ASSISTANT_HUB_DIR = path.join(MOSS_ASSISTANTS_DIR, 'hub')
const LEGACY_ASSISTANT_SYSTEM_DIR = path.join(MOSS_ASSISTANTS_DIR, 'system')
const LEGACY_ASSISTANT_CUSTOM_DIR = path.join(
  MOSS_ASSISTANTS_DIR,
  '_my-custom-assistant',
)
const RESERVED_ASSISTANT_ROOT_NAMES = ['hub', 'system', '_my-custom-assistant']
const ASSISTANT_SEARCH_DIRS = [
  {
    dir: MOSS_ASSISTANTS_DIR,
    category: 'custom' as const,
    reservedNames: RESERVED_ASSISTANT_ROOT_NAMES,
  },
  { dir: LEGACY_ASSISTANT_SYSTEM_DIR, category: 'system' as const },
  { dir: LEGACY_ASSISTANT_HUB_DIR, category: 'hub' as const },
  { dir: LEGACY_ASSISTANT_CUSTOM_DIR, category: 'custom' as const },
]

export const ASSISTANT_META_FILE = '_moss_meta.json'
const DEFAULT_ASSISTANT_PROMPT_FILE = 'assistant.md'

function normalizeHubApiBaseUrl(rawValue: unknown): string {
  const trimmed = String(rawValue || '')
    .trim()
    .replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

const configuredHubApiBaseUrl = normalizeHubApiBaseUrl(
  process.env.MOSS_HUB_API_BASE_URL || process.env.MOSS_HUB_BASE_URL || '',
)

const HUB_API_BASE_URL = configuredHubApiBaseUrl

function isHubStoreEnabled(): boolean {
  return HUB_API_BASE_URL.length > 0
}

function assertHubStoreEnabled(): void {
  if (!isHubStoreEnabled()) {
    throw new Error('Agent hub is disabled. Set MOSS_HUB_API_BASE_URL to enable remote hub access.')
  }
}

function getHubApiUrl(pathname: string): string {
  assertHubStoreEnabled()
  return `${HUB_API_BASE_URL}${pathname}`
}

export type AgentHubAssistant = {
  id: string
  name: string
  display_name: string
  description?: string
  avatar?: string
  emoji?: string | null
  category?: string
  categories?: string[]
  skills?: string[]
  core_features?: unknown
  applicable_scenarios?: unknown
  sourceUrl?: string
  [key: string]: unknown
}

export type AgentHubDetail = AgentHubAssistant & {
  versions?: Array<Record<string, unknown>>
}

export type AssistantStoreMeta = {
  id?: string
  name?: string
  display_name?: string
  description?: string
  avatar?: string
  emoji?: string | null
  category?: string
  categories?: string[]
  source_type?: 'hub' | 'upload' | 'system'
  tag?: string
  is_builtin?: boolean
  enabled?: boolean
  installed_version?: string
  installed_at?: string
  prompt_file?: string
  skills?: string[]
  enabledSkills?: string[]
  [key: string]: unknown
}

export type InstalledAssistantInfo = {
  id: string
  name: string
  displayName: string
  description: string
  avatar: string
  emoji: string
  category: string
  categories: string[]
  version: string
  source: string
  isBuiltin: boolean
  isHubInstalled: boolean
  enabled: boolean
  tag: string
  skills: string[]
  enabledSkills: string[]
  meta: AssistantStoreMeta | null
}

export type FetchAgentHubAssistantsParams = {
  cursor?: string
  limit?: number
  query?: string
  category?: string
}

type AssistantSearchResult = {
  dir: string
  category: 'custom' | 'hub' | 'system'
}

function getAssistantSearchRootDirs(): string[] {
  return ASSISTANT_SEARCH_DIRS.map(entry => entry.dir)
}

// Strictly require targetPath to be inside rootDir, excluding rootDir itself.
function isPathInsideDir(rootDir: string, targetPath: string): boolean {
  const rel = path.relative(path.resolve(rootDir), path.resolve(targetPath))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function isReservedAssistantRootDir(targetPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath)
  return RESERVED_ASSISTANT_ROOT_NAMES.some(
    name => path.resolve(MOSS_ASSISTANTS_DIR, name) === resolvedTarget,
  )
}

function sanitizeAssistantDirName(name: string): string | null {
  const trimmed = String(name || '').trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') return null
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return null
  }
  if (trimmed !== path.basename(trimmed)) return null
  if (RESERVED_ASSISTANT_ROOT_NAMES.includes(trimmed)) return null
  return trimmed
}

function getAssistantCategory(
  meta: AssistantStoreMeta | null | undefined,
  fallback: AssistantSearchResult['category'] = 'custom',
): AssistantSearchResult['category'] {
  if (meta?.is_builtin === true || meta?.source_type === 'system') {
    return 'system'
  }
  if (meta?.source_type === 'hub') {
    return 'hub'
  }
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean)
  }
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed
          .map(item => String(item || '').trim())
          .filter(Boolean)
      : []
  } catch {
    return [value.trim()]
  }
}

function normalizeVersion(value: unknown): string {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  const lower = normalized.toLowerCase()
  if (lower === 'unknown' || lower === 'unkown') return ''
  return normalized
}

function normalizeAssistantRelativePath(filePath: unknown): string {
  if (typeof filePath !== 'string') return ''
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!normalized) return ''
  if (/^[a-zA-Z]:\//.test(normalized)) return ''
  if (normalized.startsWith('/')) return ''

  const safePath = path.posix.normalize(normalized)
  if (safePath === '.' || safePath === '..' || safePath.startsWith('../')) {
    return ''
  }
  return safePath
}

function normalizeZipEntryPath(entryPath: string): string {
  return path.posix
    .normalize(entryPath.replaceAll('\\', '/').replace(/^\.\/+/, ''))
}

function isUnsafeZipEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath === '.') return false
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) return true
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return true
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\.\/+/, '')
  return normalized === '..' || normalized.startsWith('../')
}

function buildInstalledSkillLookup(
  installedSkills: InstalledSkillInfo[],
): Map<string, InstalledSkillInfo> {
  const lookup = new Map<string, InstalledSkillInfo>()

  for (const skill of installedSkills) {
    const keys = [skill.id, skill.name, path.basename(skill.source)]
      .map(value => String(value || '').trim())
      .filter(Boolean)

    for (const key of keys) {
      if (!lookup.has(key)) {
        lookup.set(key, skill)
      }
    }
  }

  return lookup
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  assertHubStoreEnabled()
  const headers = new Headers(init?.headers)
  headers.set('Authorization', HUB_AUTHORIZATION)
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', 'Moss-AgentHub/1.0')
  }

  const response = await fetch(url, {
    ...init,
    headers,
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return response.json()
}

function unwrapHubResponse(result: unknown): Record<string, unknown> {
  if (!isRecord(result)) {
    throw new Error('Invalid hub response')
  }
  if (result.success === false) {
    const message =
      typeof result.message === 'string'
        ? result.message
        : typeof result.msg === 'string'
          ? result.msg
          : 'Hub request failed'
    throw new Error(message)
  }
  return result
}

function normalizeAgentHubAssistant(rawValue: unknown): AgentHubAssistant | null {
  if (!isRecord(rawValue)) {
    return null
  }

  const categories = parseStringArray(rawValue.categories)
  const category =
    typeof rawValue.category === 'string' && rawValue.category.trim()
      ? rawValue.category.trim()
      : categories[0] || ''
  const name =
    typeof rawValue.name === 'string' && rawValue.name.trim()
      ? rawValue.name.trim()
      : ''
  const id =
    typeof rawValue.id === 'string' && rawValue.id.trim()
      ? rawValue.id.trim()
      : name

  if (!id || !name) {
    return null
  }

  const displayNameSource =
    typeof rawValue.display_name === 'string'
      ? rawValue.display_name
      : typeof rawValue.profession === 'string'
        ? rawValue.profession
        : name

  return {
    ...rawValue,
    id,
    name,
    display_name: displayNameSource.trim() || name,
    description:
      typeof rawValue.description === 'string' ? rawValue.description : '',
    avatar: typeof rawValue.avatar === 'string' ? rawValue.avatar : '',
    emoji:
      typeof rawValue.emoji === 'string'
        ? rawValue.emoji
        : rawValue.emoji === null
          ? null
          : null,
    category,
    categories,
    skills: parseStringArray(rawValue.skills),
    sourceUrl:
      typeof rawValue.sourceUrl === 'string'
        ? rawValue.sourceUrl
        : typeof rawValue.source_url === 'string'
          ? rawValue.source_url
          : '',
    core_features: rawValue.core_features,
    applicable_scenarios: rawValue.applicable_scenarios,
    versions: Array.isArray(rawValue.versions)
      ? rawValue.versions.filter(isRecord)
      : undefined,
  }
}

async function downloadFileBuffer(url: string): Promise<Buffer> {
  assertHubStoreEnabled()
  const response = await fetch(url, {
    headers: {
      Authorization: HUB_AUTHORIZATION,
      'User-Agent': 'Moss-AgentHub/1.0',
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function verifyChecksum(
  buffer: Buffer,
  expectedChecksum: string,
): Promise<boolean> {
  const actualChecksum = createHash('sha256').update(buffer).digest('hex')
  return actualChecksum === expectedChecksum
}

function resolveZipStripPrefix(entryNames: string[]): string {
  const fileEntries = entryNames
    .map(normalizeZipEntryPath)
    .filter(entryPath => !entryPath.endsWith('/'))
    .filter(
      entryPath =>
        !entryPath.includes('__MACOSX') && !entryPath.endsWith('.DS_Store'),
    )
    .filter(Boolean)

  for (const entryPath of fileEntries) {
    if (isUnsafeZipEntryPath(entryPath)) {
      throw new Error(`Unsafe zip entry path: ${entryPath}`)
    }
  }

  const topLevelParts = fileEntries.map(entryPath => entryPath.split('/')[0])
  const uniqueTopLevel = Array.from(new Set(topLevelParts)).filter(Boolean)

  if (uniqueTopLevel.length === 1 && fileEntries.every(entry => entry.includes('/'))) {
    return `${uniqueTopLevel[0]!}/`
  }

  return ''
}

async function extractAssistantZip(
  buffer: Buffer,
  targetDir: string,
): Promise<void> {
  const { unzipSync } = await import('fflate')
  const zipEntries = unzipSync(new Uint8Array(buffer))
  const stripPrefix = resolveZipStripPrefix(Object.keys(zipEntries))

  await mkdir(targetDir, { recursive: true })

  for (const [rawEntryName, content] of Object.entries(zipEntries)) {
    if (rawEntryName.endsWith('/')) continue
    if (isUnsafeZipEntryPath(rawEntryName)) {
      throw new Error(`Unsafe zip entry path: ${rawEntryName}`)
    }

    let entryName = normalizeZipEntryPath(rawEntryName)
    if (!entryName) continue
    if (entryName.includes('__MACOSX') || entryName.endsWith('.DS_Store')) {
      continue
    }
    if (stripPrefix) {
      if (!entryName.startsWith(stripPrefix)) {
        continue
      }
      entryName = entryName.slice(stripPrefix.length)
      if (!entryName) continue
    }

    const fullPath = path.join(targetDir, entryName)
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, Buffer.from(content))
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile()
  } catch {
    return false
  }
}

async function readAssistantMeta(
  assistantDir: string,
): Promise<AssistantStoreMeta | null> {
  try {
    const metaContent = await readFile(
      path.join(assistantDir, ASSISTANT_META_FILE),
      'utf-8',
    )
    const parsed = JSON.parse(metaContent)
    return isRecord(parsed) ? (parsed as AssistantStoreMeta) : null
  } catch {
    return null
  }
}

async function writeAssistantMeta(
  assistantDir: string,
  meta: AssistantStoreMeta,
): Promise<void> {
  await writeFile(
    path.join(assistantDir, ASSISTANT_META_FILE),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  )
}

async function resolveAssistantRuleFile(
  assistantDir: string,
  preferredRuleFile: unknown = DEFAULT_ASSISTANT_PROMPT_FILE,
): Promise<string | undefined> {
  const candidate = normalizeAssistantRelativePath(
    preferredRuleFile || DEFAULT_ASSISTANT_PROMPT_FILE,
  )
  if (!candidate || !candidate.toLowerCase().endsWith('.md')) {
    return undefined
  }
  const fullPath = path.resolve(assistantDir, candidate)
  if (await fileExists(fullPath)) {
    return candidate
  }
  return undefined
}

async function scanAssistantDirs(
  baseDir: string,
  reservedNames: readonly string[] = [],
): Promise<string[]> {
  const reserved = new Set(reservedNames)
  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    return entries
      .filter(
        entry =>
          entry.isDirectory() &&
          !entry.name.startsWith('_') &&
          !reserved.has(entry.name),
      )
      .map(entry => path.join(baseDir, entry.name))
  } catch {
    return []
  }
}

async function findAssistantDir(
  assistantName: string,
): Promise<AssistantSearchResult | null> {
  const normalizedAssistantName = String(assistantName || '').trim()
  if (!normalizedAssistantName) {
    return null
  }

  const candidateNames = [normalizedAssistantName]
  if (normalizedAssistantName.startsWith('builtin-')) {
    candidateNames.push(normalizedAssistantName.slice('builtin-'.length))
  }

  for (const { dir, category, reservedNames = [] } of ASSISTANT_SEARCH_DIRS) {
    for (const candidateName of candidateNames) {
      if (reservedNames.includes(candidateName)) continue
      const assistantDir = path.join(dir, candidateName)
      try {
        const entryStat = await stat(assistantDir)
        if (entryStat.isDirectory()) {
          const meta = await readAssistantMeta(assistantDir)
          return { dir: assistantDir, category: getAssistantCategory(meta, category) }
        }
      } catch {
        // Continue searching.
      }
    }
  }

  for (const { dir, category, reservedNames = [] } of ASSISTANT_SEARCH_DIRS) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue
        if (reservedNames.includes(entry.name)) continue
        const candidateDir = path.join(dir, entry.name)
        const meta = await readAssistantMeta(candidateDir)
        if (meta?.name === normalizedAssistantName) {
          return { dir: candidateDir, category: getAssistantCategory(meta, category) }
        }
      }
    } catch {
      // Ignore missing directory and continue searching.
    }
  }

  return null
}

function toInstalledAssistantInfo(params: {
  assistantDir: string
  dirName: string
  meta: AssistantStoreMeta | null
  category: AssistantSearchResult['category']
}): InstalledAssistantInfo {
  const { assistantDir, dirName, meta, category } = params
  const categories = parseStringArray(meta?.categories)
  const normalizedCategory =
    typeof meta?.category === 'string' ? meta.category : categories[0] || ''

  return {
    id: typeof meta?.id === 'string' ? meta.id : '',
    name:
      typeof meta?.name === 'string' && meta.name.trim()
        ? meta.name
        : dirName,
    displayName:
      typeof meta?.display_name === 'string' && meta.display_name.trim()
        ? meta.display_name
        : typeof meta?.name === 'string' && meta.name.trim()
          ? meta.name
          : dirName,
    description: typeof meta?.description === 'string' ? meta.description : '',
    avatar: typeof meta?.avatar === 'string' ? meta.avatar : '',
    emoji: typeof meta?.emoji === 'string' ? meta.emoji : '',
    category: normalizedCategory,
    categories,
    version: normalizeVersion(meta?.installed_version),
    source: assistantDir,
    isBuiltin: meta?.is_builtin === true || category === 'system',
    isHubInstalled: meta?.source_type === 'hub' || category === 'hub',
    enabled: meta?.enabled !== false,
    tag:
      typeof meta?.tag === 'string' && meta.tag.trim()
        ? meta.tag
        : category,
    skills: parseStringArray(meta?.skills),
    enabledSkills: parseStringArray(meta?.enabledSkills),
    meta,
  }
}

export async function fetchAgentHubAssistants(
  params: FetchAgentHubAssistantsParams,
): Promise<{
  assistants: AgentHubAssistant[]
  next_cursor: string | null
  has_more: boolean
}> {
  if (!isHubStoreEnabled()) {
    return { assistants: [], next_cursor: null, has_more: false }
  }

  const searchParams = new URLSearchParams()
  if (params.cursor) searchParams.set('cursor', params.cursor)
  if (params.limit) searchParams.set('limit', String(params.limit))
  if (params.query) searchParams.set('query', params.query)
  if (params.category) searchParams.set('category', params.category)

  const result = await fetchJson(getHubApiUrl(`/assistants/cursor?${searchParams}`))
  const unwrapped = unwrapHubResponse(result)
  const data = isRecord(unwrapped.data) ? unwrapped.data : unwrapped
  const rawAssistants = Array.isArray(data.assistants) ? data.assistants : []

  return {
    assistants: rawAssistants
      .map(normalizeAgentHubAssistant)
      .filter((assistant): assistant is AgentHubAssistant => assistant !== null),
    next_cursor:
      typeof data.next_cursor === 'string' && data.next_cursor
        ? data.next_cursor
        : null,
    has_more: data.has_more === true,
  }
}

export async function fetchAgentHubCategories(): Promise<string[]> {
  if (!isHubStoreEnabled()) {
    return []
  }

  const result = await fetchJson(getHubApiUrl('/categories?type=1'))
  if (Array.isArray(result)) {
    return result.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    )
  }

  const unwrapped = unwrapHubResponse(result)
  const categories = Array.isArray(unwrapped.data) ? unwrapped.data : []

  return categories.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  )
}

export async function fetchAgentHubAssistantDetail(
  assistantId: string,
): Promise<AgentHubDetail | null> {
  if (!isHubStoreEnabled()) {
    return null
  }

  const result = await fetchJson(
    getHubApiUrl(`/assistants/${encodeURIComponent(assistantId)}`),
  )
  const unwrapped = unwrapHubResponse(result)
  const rawDetail = isRecord(unwrapped.data)
    ? unwrapped.data
    : isRecord(unwrapped.assistant)
      ? unwrapped.assistant
      : unwrapped

  const normalized = normalizeAgentHubAssistant(rawDetail)
  return normalized ? (normalized as AgentHubDetail) : null
}

export async function getInstalledAssistants(): Promise<InstalledAssistantInfo[]> {
  const results: InstalledAssistantInfo[] = []

  for (const {
    dir: baseDir,
    category: fallbackCategory,
    reservedNames = [],
  } of ASSISTANT_SEARCH_DIRS) {
    const assistantDirs = await scanAssistantDirs(baseDir, reservedNames)
    for (const assistantDir of assistantDirs) {
      const dirName = path.basename(assistantDir)
      const meta = await readAssistantMeta(assistantDir)
      const category = getAssistantCategory(meta, fallbackCategory)
      results.push(
        toInstalledAssistantInfo({
          assistantDir,
          dirName,
          meta,
          category,
        }),
      )
    }
  }

  return results
}

export async function fetchAgentHubSkillDetailsByIds(
  skillIds: string[],
): Promise<Array<Record<string, unknown>>> {
  const normalizedIds = skillIds
    .map(skillId => String(skillId || '').trim())
    .filter(Boolean)

  if (normalizedIds.length === 0) {
    return []
  }

  const details = await Promise.all(
    normalizedIds.map(async (skillId): Promise<Record<string, unknown> | null> => {
      try {
        const detail = await fetchSkillHubSkillDetail(skillId)
        if (!detail) return null
        return {
          id: detail.id,
          name: detail.name,
          display_name: detail.display_name,
          description: detail.description,
          icon: detail.icon,
          emoji: detail.emoji ?? null,
          category: detail.category,
          categories: detail.categories,
        }
      } catch {
        return null
      }
    }),
  )

  return details.filter((detail): detail is Record<string, unknown> => detail !== null)
}

export async function installHubAssistant(params: {
  assistantName: string
  sourceUrl: string
  version?: string
  checksum?: string
  assistantMeta?: AgentHubAssistant | null
  selectedSkillIds?: string[]
}): Promise<{
  assistantName: string
  version: string
  installedSkills: string[]
  failedSkills: string[]
}> {
  assertHubStoreEnabled()
  const assistantName = String(params.assistantName || '').trim()
  const sourceUrl = String(params.sourceUrl || '').trim()
  if (!assistantName) {
    throw new Error('assistantName is required')
  }
  const assistantDirName = sanitizeAssistantDirName(assistantName)
  if (!assistantDirName) {
    throw new Error(`assistantName is invalid or reserved: ${assistantName}`)
  }
  if (!sourceUrl) {
    throw new Error('sourceUrl is required')
  }

  const zipBuffer = await downloadFileBuffer(sourceUrl)
  if (params.checksum?.trim()) {
    const isValid = await verifyChecksum(zipBuffer, params.checksum.trim())
    if (!isValid) {
      console.warn(
        `[AgentHub] Checksum mismatch for ${assistantName}, continuing with install`,
      )
    }
  }

  await mkdir(MOSS_ASSISTANTS_DIR, { recursive: true })
  const assistantDir = path.join(MOSS_ASSISTANTS_DIR, assistantDirName)
  const existingMeta = await readAssistantMeta(assistantDir)
  if (existingMeta?.is_builtin === true) {
    throw new Error('Cannot overwrite builtin assistant')
  }
  await rm(assistantDir, { recursive: true, force: true })
  await mkdir(assistantDir, { recursive: true })
  await extractAssistantZip(zipBuffer, assistantDir)

  const normalizedAssistant =
    params.assistantMeta && isRecord(params.assistantMeta)
      ? normalizeAgentHubAssistant(params.assistantMeta)
      : null
  const promptFile = await resolveAssistantRuleFile(assistantDir)
  if (!promptFile) {
    throw new Error('Assistant package is missing assistant.md')
  }

  const installedSkills = await getInstalledSkills()
  const installedSkillLookup = buildInstalledSkillLookup(installedSkills)
  const selectedSkillIds = Array.from(
    new Set(
      (
    params.selectedSkillIds?.length
      ? params.selectedSkillIds
      : normalizedAssistant?.skills || []
      )
        .map(skillId => String(skillId || '').trim())
        .filter(Boolean),
    ),
  )

  const installedSkillNames: string[] = []
  const failedSkillIds: string[] = []
  const enabledSkillNames = new Set<string>()

  for (const skillId of selectedSkillIds) {
    const detail = await fetchSkillHubSkillDetail(skillId).catch(() => null)
    if (!detail) {
      failedSkillIds.push(skillId)
      continue
    }

    const existingSkill =
      installedSkillLookup.get(skillId) || installedSkillLookup.get(detail.name)
    if (existingSkill) {
      enabledSkillNames.add(existingSkill.name || detail.name)
      continue
    }

    const latestVersion = detail.versions?.[0]
    if (!latestVersion?.source_url) {
      failedSkillIds.push(skillId)
      continue
    }

    try {
      await installHubSkill({
        skillName: detail.name,
        sourceUrl: latestVersion.source_url,
        version:
          typeof latestVersion.version === 'string'
            ? latestVersion.version
            : undefined,
        checksum:
          typeof latestVersion.checksum === 'string'
            ? latestVersion.checksum
            : undefined,
        skillMeta: detail,
      })
      installedSkillNames.push(detail.name)
      enabledSkillNames.add(detail.name)
      installedSkillLookup.set(skillId, {
        id: detail.id,
        name: detail.name,
        displayName: detail.display_name,
        description: detail.description || '',
        version:
          typeof latestVersion.version === 'string'
            ? latestVersion.version
            : '',
        icon: detail.icon || '',
        emoji: detail.emoji || '',
        category: detail.category || '',
        categories: detail.categories || [],
        isBuiltin: false,
        isHubInstalled: true,
        isUploaded: false,
        enabled: true,
        source: path.join(MOSS_HOME, 'skills', detail.name),
        meta: null,
      })
      installedSkillLookup.set(detail.name, installedSkillLookup.get(skillId)!)
    } catch {
      failedSkillIds.push(skillId)
    }
  }

  const installedVersion =
    normalizeVersion(params.version) || '1.0.0'
  const meta: AssistantStoreMeta = {
    id: normalizedAssistant?.id || '',
    name: assistantName,
    display_name:
      normalizedAssistant?.display_name || normalizedAssistant?.name || assistantName,
    description: normalizedAssistant?.description || '',
    avatar: normalizedAssistant?.avatar || '',
    emoji: normalizedAssistant?.emoji || null,
    category: normalizedAssistant?.category || '',
    categories: normalizedAssistant?.categories || [],
    source_type: 'hub',
    tag: 'hub',
    is_builtin: false,
    enabled: true,
    installed_version: installedVersion,
    installed_at: new Date().toISOString(),
    prompt_file: promptFile,
    skills: selectedSkillIds,
    enabledSkills: Array.from(enabledSkillNames),
  }
  await writeAssistantMeta(assistantDir, meta)

  return {
    assistantName,
    version: installedVersion,
    installedSkills: installedSkillNames,
    failedSkills: failedSkillIds,
  }
}

export async function uninstallAssistant(params: {
  assistantName: string
  sourcePath?: string
}): Promise<void> {
  const sourcePath =
    params.sourcePath || (await findAssistantDir(params.assistantName))?.dir
  if (!sourcePath) {
    throw new Error('Assistant not found')
  }
  if (
    !getAssistantSearchRootDirs().some(root => isPathInsideDir(root, sourcePath)) ||
    isReservedAssistantRootDir(sourcePath)
  ) {
    throw new Error('Refusing to remove path outside assistant directories')
  }

  const meta = await readAssistantMeta(sourcePath)
  if (meta?.is_builtin === true) {
    throw new Error('Builtin assistants cannot be uninstalled')
  }

  await rm(sourcePath, { recursive: true, force: true })
}

export async function updateInstalledAssistantMeta(params: {
  assistantName: string
  updates: Partial<
    Pick<AssistantStoreMeta, 'display_name' | 'description' | 'avatar'>
  >
}): Promise<void> {
  const result = await findAssistantDir(params.assistantName)
  if (!result) {
    throw new Error('Assistant not found')
  }

  const existingMeta = (await readAssistantMeta(result.dir)) || {}
  const nextMeta: AssistantStoreMeta = {
    ...existingMeta,
  }

  if (typeof params.updates.display_name === 'string') {
    nextMeta.display_name = params.updates.display_name.trim()
  }
  if (typeof params.updates.description === 'string') {
    nextMeta.description = params.updates.description.trim()
  }
  if (typeof params.updates.avatar === 'string') {
    nextMeta.avatar = params.updates.avatar.trim()
  }

  await writeAssistantMeta(result.dir, nextMeta)
}

export async function getAssistantContextSummary(
  assistantName: string,
): Promise<{ promptFile?: string; skills: string[] } | null> {
  const result = await findAssistantDir(assistantName)
  if (!result) {
    return null
  }

  const meta = await readAssistantMeta(result.dir)
  const promptFile = await resolveAssistantRuleFile(
    result.dir,
    meta?.prompt_file,
  )
  return {
    promptFile,
    skills: parseStringArray(meta?.skills),
  }
}

/**
 * Get assistant system prompt content for MOSS_ASSISTANT_NAME env var handling.
 * Reads the assistant prompt file content from the assistant directory.
 */
export async function getAssistantSystemPrompt(
  assistantName: string,
): Promise<string | null> {
  const result = await findAssistantDir(assistantName)
  if (!result) {
    return null
  }

  const meta = await readAssistantMeta(result.dir)
  const promptFile = await resolveAssistantRuleFile(
    result.dir,
    meta?.prompt_file,
  )

  if (!promptFile) {
    return null
  }

  const fullPath = path.resolve(result.dir, promptFile)
  try {
    const content = await readFile(fullPath, 'utf-8')
    return content.trim() || null
  } catch {
    return null
  }
}

export { ASSISTANT_SEARCH_DIRS, MOSS_ASSISTANTS_DIR }
