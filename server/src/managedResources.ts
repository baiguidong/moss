import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import JSZip from 'jszip'
import { managedPackageFiles } from '../../shared/managed-resource-package.mjs'
import { emojiIcon, hubIcon, imageThumbnail, skillHubPresetIcon } from './managedResourceIcons.js'
import { basename, join, resolve } from 'node:path'
import { getMossServerHomeDir } from './lib/env.js'

export type ManagedResourceKind = 'skill' | 'expert'

export type ManagedResource = {
  id: string
  orgId: string
  kind: ManagedResourceKind
  slug: string
  name: string
  displayName: string
  description: string
  icon: string
  category: string
  version: string
  sha256: string
  packageFile: string | null
  enabled: boolean
  dependencies: string[]
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

type Store = {
  resources: ManagedResource[]
  grants: Record<string, string[]>
}

function isKind(value: unknown): value is ManagedResourceKind {
  return value === 'skill' || value === 'expert'
}

function safeText(value: unknown, fallback = '', max = 512): string {
  return typeof value === 'string' ? value.trim().slice(0, max) || fallback : fallback
}

function safeId(value: unknown): string {
  const result = safeText(value, '', 128)
  if (!result || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) return ''
  return result
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 160) || 'resource'
}

function policyKey(orgId: string, userId: string, kind: ManagedResourceKind): string {
  return JSON.stringify([orgId, userId, kind])
}

function defaultStore(): Store {
  return { resources: [], grants: {} }
}

export class ManagedResourcesService {
  private readonly indexPath: string
  private readonly packagesDir: string
  private store: Store

  constructor(
    private readonly rootDir = getMossServerHomeDir(),
  ) {
    this.indexPath = join(rootDir, 'managed-resources', 'index.json')
    this.packagesDir = join(rootDir, 'managed-resources', 'packages')
    mkdirSync(resolve(this.packagesDir), { recursive: true, mode: 0o700 })
    this.store = this.load()
  }

  private load(): Store {
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8')) as Partial<Store> & {
        policies?: Record<string, { mode: string; resourceIds: string[] }>
      }
      const resources = (parsed.resources || []).filter(item => item && isKind(item.kind))
      if (parsed.grants) return { resources, grants: parsed.grants }
      // Convert saved draft policies to explicit IDs before applying any mutations.
      const grants: Store['grants'] = {}
      for (const [key, policy] of Object.entries(parsed.policies || {})) {
        const [org, , kind] = JSON.parse(key)
        grants[key] = resources.filter(item => {
          if (item.orgId !== org || item.kind !== kind) return false
          const listed = policy.resourceIds.includes(item.id) || policy.resourceIds.includes(item.slug)
          return policy.mode === 'inherit' || (policy.mode === 'deny_list' ? !listed : policy.mode === 'allow_list' && listed)
        }).map(item => item.id)
      }
      return { resources, grants }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return defaultStore()
    }
  }

  private persist(): void {
    const temp = `${this.indexPath}.tmp-${process.pid}`
    try {
      writeFileSync(temp, JSON.stringify(this.store), { mode: 0o600 })
      renameSync(temp, this.indexPath)
    } catch (error) {
      this.store = this.load()
      throw error
    }
  }

  private allowed(resource: ManagedResource, userId: string): boolean {
    const ids = this.store.grants[policyKey(resource.orgId, userId, resource.kind)]
    return resource.enabled && ids?.includes(resource.id) === true
  }

  private allowedWithDependencies(resource: ManagedResource, userId: string): boolean {
    if (!this.allowed(resource, userId)) return false
    if (resource.kind !== 'expert') return true
    return resource.dependencies.every(dependency => {
      const skill = this.store.resources.find(item => item.orgId === resource.orgId && item.kind === 'skill' && (item.id === dependency || item.slug === dependency))
      return Boolean(skill && this.allowed(skill, userId))
    })
  }

  private discardUnusedPackage(file: string | null | undefined): void {
    if (!file || basename(file) !== file || this.store.resources.some(item => item.packageFile === file)) return
    rmSync(join(this.packagesDir, file), { force: true })
    rmSync(join(this.packagesDir, file + '.thumbnail'), { force: true })
  }

  async install(input: {
    orgId: string
    kind: ManagedResourceKind
    slug: string
    name?: string
    displayName?: string
    description?: string
    icon?: string
    category?: string
    version?: string
    dependencies?: string[]
    metadata?: Record<string, unknown>
    packageBytes?: Uint8Array
  }): Promise<ManagedResource> {
    const orgId = safeId(input.orgId)
    const slug = safeId(input.slug)
    if (!orgId || !isKind(input.kind) || !slug || slug.includes(':')) throw Object.assign(new Error('无效的资源标识'), { statusCode: 400 })
    if (!input.packageBytes?.length) throw Object.assign(new Error('缺少资源 ZIP'), { statusCode: 400 })
    let meta: Record<string, unknown> = {}
    let files: ReturnType<typeof managedPackageFiles>
    try {
      const zip = await JSZip.loadAsync(input.packageBytes)
      files = managedPackageFiles(zip, input.kind)
      const metaFile = files.find(file => file.name === '_moss_meta.json')
      if (metaFile) {
        const value = JSON.parse(await metaFile.entry.async('string'))
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的资源元数据')
        meta = value
      }
    } catch (error) {
      throw Object.assign(new Error(`资源 ZIP 无效：${error instanceof Error ? error.message : error}`), { statusCode: 400 })
    }
    const existing = this.store.resources.find(item => item.orgId === orgId && item.kind === input.kind && item.slug === slug)
    const now = Date.now()
    const id = existing?.id || `${input.kind}-${randomUUID()}`
    const version = safeText(input.version || meta.installed_version || meta.version, '1.0.0', 128)
    const sha256 = createHash('sha256').update(input.packageBytes).digest('hex')
    const packageFile = `${safeFilePart(orgId)}-${safeFilePart(id)}-${sha256}.pkg`
    const packagePath = join(this.packagesDir, packageFile)
    if (!existsSync(packagePath)) {
      const tempPath = packagePath + '.tmp-' + randomUUID()
      try {
        writeFileSync(tempPath, input.packageBytes, { mode: 0o600 })
        renameSync(tempPath, packagePath)
      } finally {
        rmSync(tempPath, { force: true })
      }
    }
    const resource: ManagedResource = {
      id, orgId, kind: input.kind, slug,
      name: safeText(input.name, slug),
      displayName: safeText(input.displayName || meta.display_name, safeText(input.name, slug)),
      description: safeText(input.description || meta.description), icon: safeText(input.icon || meta.icon || meta.avatar || meta.emoji), category: safeText(input.category),
      version, sha256, packageFile, enabled: existing?.enabled ?? true,
      dependencies: (input.dependencies || (Array.isArray(meta.dependencies) ? meta.dependencies : [])).map(safeId).filter(Boolean),
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : existing?.metadata || {},
      createdAt: existing?.createdAt || now, updatedAt: now,
    }
    const index = this.store.resources.findIndex(item => item.id === id && item.orgId === orgId)
    if (index >= 0) this.store.resources[index] = resource
    else this.store.resources.push(resource)
    try {
      this.persist()
    } finally {
      this.discardUnusedPackage(packageFile)
    }
    this.discardUnusedPackage(existing?.packageFile)
    await this.thumbnail(resource, files)
    return resource
  }

  async setEnabled(orgId: string, kind: ManagedResourceKind, id: string, enabled: boolean): Promise<ManagedResource | null> {
    const resource = this.store.resources.find(item => item.orgId === orgId && item.kind === kind && item.id === id)
    if (!resource) return null
    resource.enabled = enabled
    resource.updatedAt = Date.now()
    this.persist()
    return resource
  }

  async remove(orgId: string, kind: ManagedResourceKind, id: string): Promise<boolean> {
    const index = this.store.resources.findIndex(item => item.orgId === orgId && item.kind === kind && item.id === id)
    if (index < 0) return false
    const [resource] = this.store.resources.splice(index, 1)
    for (const [key, ids] of Object.entries(this.store.grants)) {
      if (ids.includes(id)) this.store.grants[key] = ids.filter(resourceId => resourceId !== id)
    }
    this.persist()
    this.discardUnusedPackage(resource?.packageFile)
    return true
  }

  list(orgId: string, kind?: ManagedResourceKind): ManagedResource[] {
    return this.store.resources.filter(item => item.orgId === orgId && (!kind || item.kind === kind)).map(item => ({ ...item, dependencies: [...item.dependencies], metadata: { ...item.metadata } }))
  }

  listForUser(orgId: string, userId: string, kind?: ManagedResourceKind): ManagedResource[] {
    const resources = this.store.resources.filter(item => item.orgId === orgId && (!kind || item.kind === kind))
    return resources.filter(item => this.allowedWithDependencies(item, userId)).map(item => ({ ...item, dependencies: [...item.dependencies], metadata: { ...item.metadata } }))
  }

  getForUser(orgId: string, userId: string, kind: ManagedResourceKind, idOrSlug: string): ManagedResource | null {
    const resource = this.store.resources.find(item => item.orgId === orgId && item.kind === kind && (item.id === idOrSlug || item.slug === idOrSlug))
    return resource && this.allowedWithDependencies(resource, userId) ? { ...resource, dependencies: [...resource.dependencies], metadata: { ...resource.metadata } } : null
  }

  getPackage(resource: ManagedResource): Uint8Array | null {
    if (!resource.packageFile) return null
    const packagePath = resolve(this.packagesDir, resource.packageFile)
    if (basename(resource.packageFile) !== resource.packageFile || !existsSync(packagePath)) return null
    return new Uint8Array(readFileSync(packagePath))
  }

  getAssignedIds(orgId: string, userId: string, kind: ManagedResourceKind): string[] {
    return [...(this.store.grants[policyKey(orgId, userId, kind)] || [])]
  }

  async setAssignedIds(orgId: string, userId: string, kind: ManagedResourceKind, ids: string[]): Promise<void> {
    const catalog = new Set(this.list(orgId, kind).map(resource => resource.id))
    if (!ids.every(id => catalog.has(id))) throw Object.assign(new Error('授权清单包含未知资源'), { statusCode: 400 })
    this.store.grants[policyKey(orgId, userId, kind)] = [...new Set(ids)]
    this.persist()
  }

  assignmentCounts(orgId: string, userIds: string[], kind: ManagedResourceKind) {
    const counts: Record<string, number> = Object.create(null)
    for (const userId of userIds) {
      for (const id of this.getAssignedIds(orgId, userId, kind)) counts[id] = (counts[id] || 0) + 1
    }
    return counts
  }

  updateAssignments(orgId: string, userIds: string[], kind: ManagedResourceKind, add: string[], remove: string[]) {
    const catalog = new Set(this.list(orgId, kind).map(resource => resource.id))
    const removed = new Set(remove)
    if (![...add, ...remove].every(id => catalog.has(id)) || add.some(id => removed.has(id))) {
      throw Object.assign(new Error('授权变更包含无效或冲突的资源'), { statusCode: 400 })
    }
    for (const userId of userIds) {
      const ids = this.getAssignedIds(orgId, userId, kind).filter(id => !removed.has(id))
      this.store.grants[policyKey(orgId, userId, kind)] = [...new Set([...ids, ...add])]
    }
    this.persist()
  }

  private async thumbnail(resource: ManagedResource, files?: ReturnType<typeof managedPackageFiles>): Promise<string> {
    const file = resource.packageFile
    if (!file || basename(file) !== file) return ''
    const cache = join(this.packagesDir, file + '.thumbnail')
    try {
      if (existsSync(cache)) {
        const saved = JSON.parse(readFileSync(cache, 'utf8'))
        if (saved.source === resource.icon) return saved.image
      }
      if (!files) {
        const bytes = this.getPackage(resource)
        if (!bytes) return ''
        files = managedPackageFiles(await JSZip.loadAsync(bytes), resource.kind)
      }
      const metadata = files.find(entry => entry.name === '_moss_meta.json')
      const meta = metadata ? JSON.parse(await metadata.entry.async('string')) : {}
      const source = resource.icon || safeText(meta.icon || meta.avatar || meta.emoji)
      const iconFile = files.find(entry => entry.name === source.replace(/^\.\//, ''))
        || files.find(entry => /^(?:(?:assets|avatars)\/)?(?:icon|avatar|expert|logo)\.(?:png|webp|jpe?g|gif|svg)$/i.test(entry.name))
      let image = iconFile ? await imageThumbnail(await iconFile.entry.async('nodebuffer')) : ''
      image ||= emojiIcon(source) || emojiIcon(meta.emoji)
      const remote = resource.metadata?.source === 'skillhub' || resource.metadata?.source === 'experthub'
      if (!image && remote) image = await hubIcon(resource.kind, source)
      if ((image || !source || !remote) && existsSync(join(this.packagesDir, file))) {
        const tmp = cache + '.' + randomUUID()
        writeFileSync(tmp, JSON.stringify({ source: resource.icon, image }), { mode: 0o600 })
        renameSync(tmp, cache)
      }
      return image
    } catch { return '' }
  }

  async withIcons(resources: ManagedResource[]) {
    return Promise.all(resources.map(async resource => {
      const icon = await this.thumbnail(resource)
      const fromSkillHub = resource.kind === 'skill' && resource.metadata?.source === 'skillhub'
      return { ...resource, icon: icon || (fromSkillHub ? skillHubPresetIcon(resource.slug) : '') }
    }))
  }

  async manifest(orgId: string, userId: string) {
    const icons = await this.withIcons(this.listForUser(orgId, userId))
    const images = new Map(icons.map(item => [item.id, item]))
    const resources = this.listForUser(orgId, userId)
    return {
      orgId, userId,
      resources: resources.map(({ id, kind, slug, displayName, description, category, version, sha256 }) =>
        ({ id, kind, slug, displayName, description, category, version, sha256, icon: images.get(id)?.sha256 === sha256 ? images.get(id)?.icon : '' })),
    }
  }

}
