import JSZip from 'jszip'
import { gunzipSync } from 'node:zlib'
import categoryNames from './assets/hub-category-names.json'
import type { ManagedResourceKind } from './managedResources.js'

const DEFAULT_SKILL_HUB = 'https://api.skillhub.cn'
const DEFAULT_EXPERT_HUB = 'https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace'

export function hubText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const record = value as Record<string, unknown>
  for (const key of ['zh', 'zh-CN', 'zhCN', 'displayName', 'display_name', 'name', 'title', 'en', 'en-US']) {
    const text = hubText(record[key])
    if (text) return text
  }
  return ''
}

function hubBase(value: string | undefined, fallback: string): string {
  const raw = String(value || fallback).trim().replace(/\/+$/, '')
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return fallback
  }
}

export type HubCategory = { id: string; name: string }

export function categoryId(value: any): string {
  return hubText(value?.key || value?.id || value?.categoryId || value?.slug || value)
}

// Older installations saved only the public hub key. Resolve those offline too.
export function categoryLabel(kind: ManagedResourceKind, value: any, categories: HubCategory[] = []): string {
  const id = categoryId(value)
  const defaults: Record<string, string> = categoryNames[kind]
  return categories.find(item => item.id === id)?.name
    || hubText(value?.displayName || value?.nameZh || value?.name || value?.title)
    || (Object.hasOwn(defaults, id) ? defaults[id]! : id)
}

function hubCategories(kind: ManagedResourceKind, entries: any[]): HubCategory[] {
  const names = new Map<string, string>()
  for (const entry of entries) {
    const id = categoryId(entry)
    if (id && entry?.active !== false && !names.has(id)) names.set(id, categoryLabel(kind, entry))
  }
  return Array.from(names, ([id, name]) => ({ id, name }))
}

export async function listHubSkillCategories(): Promise<HubCategory[]> {
  try {
    const result = await getJson(`${skillHubBase()}/api/v1/categories`)
    return hubCategories('skill', result.items || result.data || [])
  } catch {
    return Object.entries(categoryNames.skill).map(([id, name]) => ({ id, name }))
  }
}

function safePath(value: string): string {
  const text = String(value || '').trim().replace(/^\/+/, '')
  if (!text || text.includes('..') || text.includes('\\')) throw new Error('Invalid hub resource path')
  return text
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Hub request failed (${response.status})`)
  return await response.json()
}

async function getBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Hub download failed (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

export function skillHubBase(): string {
  return hubBase(process.env.MOSS_SKILL_HUB_BASE_URL || process.env.MOSS_HUB_API_BASE_URL, DEFAULT_SKILL_HUB)
}

export function expertHubBase(): string {
  return hubBase(process.env.MOSS_EXPERT_HUB_BASE_URL, DEFAULT_EXPERT_HUB)
}

export async function listHubSkills(params: { keyword?: string; category?: string; page?: number; pageSize?: number } = {}) {
  const url = new URL(`${skillHubBase()}/api/skills`)
  url.searchParams.set('page', String(Math.max(1, params.page || 1)))
  url.searchParams.set('pageSize', String(Math.min(100, Math.max(1, params.pageSize || 20))))
  if (params.keyword) url.searchParams.set('keyword', params.keyword)
  if (params.category) url.searchParams.set('category', params.category)
  return await getJson(url.toString())
}

export async function getHubSkill(slug: string, namespace?: string) {
  const url = new URL(`${skillHubBase()}/api/v1/skills/${encodeURIComponent(slug)}`)
  if (namespace) url.searchParams.set('namespace', namespace)
  return await getJson(url.toString())
}

export async function downloadHubSkill(slug: string, version?: string, namespace?: string) {
  const url = new URL(`${skillHubBase()}/api/v1/download`)
  url.searchParams.set('slug', slug)
  if (version) url.searchParams.set('version', version)
  if (namespace) url.searchParams.set('namespace', namespace)
  return await getBytes(url.toString())
}

export async function listHubExperts() {
  const base = expertHubBase()
  const manifests: any[] = []
  for (const name of ['expert_center.json', 'externalExpert.json']) {
    try {
      const value = await getJson(`${base}/${name}`)
      manifests.push(value)
    } catch {
      if (name === 'expert_center.json') throw new Error('Expert Hub manifest unavailable')
    }
  }
  const categories = manifests.flatMap(value => value.categories || value.categoryList || value.expertCategories || [])
  const experts = manifests.flatMap(value => value.experts || value.expertList || value.items || value.list || [])
  const seen = new Set<string>()
  return { categories, experts: experts.filter(item => { const id = String(item?.id || item?.name || ''); if (!id || seen.has(id)) return false; seen.add(id); return true }) }
}

export async function downloadHubExpert(expert: any): Promise<Uint8Array> {
  const base = expertHubBase()
  const promptFile = String(expert?.promptFile || expert?.prompt_file || expert?.prompt || '').trim()
  if (!promptFile) throw new Error('Expert does not provide a prompt file')
  const zip = new JSZip()
  const plugin = String(expert?.plugin || '').trim()
  if (plugin && /^[A-Za-z0-9._-]+$/.test(plugin)) {
    try {
      const bundle = gunzipSync(Buffer.from(await getBytes(`${base}/bundles/${encodeURIComponent(plugin)}.tar.gz`)))
      let offset = 0
      while (offset + 512 <= bundle.length) {
        const header = bundle.subarray(offset, offset + 512)
        if (header.every(byte => byte === 0)) break
        const read = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '').trim()
        const name = read(0, 100)
        const prefix = read(345, 155)
        const type = read(156, 1) || '0'
        const size = Number.parseInt(read(124, 12), 8) || 0
        const fullName = (prefix ? `${prefix}/${name}` : name).replace(/^\.\/+/, '')
        const dataStart = offset + 512
        const dataEnd = dataStart + size
        if (!Number.isSafeInteger(size) || size < 0 || dataEnd > bundle.length) throw new Error('Invalid Expert bundle')
        if ((type === '0' || type === '') && fullName && !fullName.includes('..') && !fullName.startsWith('/') && dataEnd <= bundle.length) {
          zip.file(fullName, bundle.subarray(dataStart, dataEnd))
          if (fullName.startsWith('agents/')) zip.file('.moss/' + fullName, bundle.subarray(dataStart, dataEnd))
        }
        offset = dataStart + Math.ceil(size / 512) * 512
      }
    } catch {
      // Some experts have no downloadable bundle. The prompt-only package is
      // still a valid managed expert and keeps the install path available.
    }
  }
  async function getPrompt(file: string) {
    const relative = safePath(file)
    const local = relative.startsWith(`plugins/${plugin}/`) ? relative.slice(`plugins/${plugin}/`.length) : relative
    const bundled = zip.file(local)
    return bundled ? await bundled.async('nodebuffer') : Buffer.from(await getBytes(`${base}/${relative}`))
  }
  zip.file('assistant.md', await getPrompt(promptFile))
  const members = []
  for (const member of expert.members || []) {
    const id = String(member.agentName || member.id || '')
    if (!/^[a-zA-Z0-9._-]+$/.test(id) || id === '.' || id === '..') throw new Error('Invalid expert member')
    const local = `agents/${id}.md`
    const prompt = await getPrompt(member.promptFile || member.prompt || `plugins/${plugin}/${local}`)
    zip.file(local, prompt)
    zip.file('.moss/' + local, prompt)
    members.push({ id, agent_name: id, name: hubText(member.name) || id, displayName: hubText(member.displayName) || id,
      description: hubText(member.description), profession: hubText(member.profession), role: hubText(member.role),
      promptFile: local, localPromptFile: local, runtimePromptFile: '.moss/' + local })
  }
  zip.file('_moss_meta.json', JSON.stringify({
    id: expert.id || expert.name,
    name: expert.name || expert.id,
    display_name: hubText(expert.displayName) || hubText(expert.display_name) || hubText(expert.name) || expert.id,
    description: hubText(expert.description) || hubText(expert.profession),
    kind: 'expert',
    expert_type: expert.expertType || expert.type || expert.expert_type || 'agent',
    plugin,
    members,
    skills: Array.isArray(expert.skills) ? expert.skills : [],
  }))
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export async function hubExpert(slug: string) {
  const bundle = await listHubExperts()
  const expert = bundle.experts.find(item => String(item?.id || item?.name || '') === slug)
  if (!expert) throw new Error('Expert not found')
  return { ...expert, categoryName: expert.categoryName || categoryLabel('expert', expert.categoryId || expert.category, expertCategories(bundle)), source_type: 'moss-server' }
}

export function expertCategories(bundle: Awaited<ReturnType<typeof listHubExperts>>): HubCategory[] {
  const counts = new Map<string, number>()
  for (const expert of bundle.experts) {
    const id = categoryId(expert.categoryId || expert.category)
    if (id) counts.set(id, (counts.get(id) || 0) + 1)
  }
  return hubCategories('expert', [...bundle.categories, ...counts.keys()])
    .filter(item => counts.has(item.id))
    .sort((a, b) => counts.get(b.id)! - counts.get(a.id)! || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}
