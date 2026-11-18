import { hubText, listHubExperts, listHubSkills } from './managedHub.js'
import { hubIcon, skillHubPresetIcon } from './managedResourceIcons.js'
import type { ManagedResourceKind } from './managedResources.js'

export async function listManagedHubCards(kind: ManagedResourceKind, query: URLSearchParams) {
  const page = Math.max(1, Number.parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = 12
  const keyword = (query.get('keyword') || '').trim()
  let entries: Record<string, any>[]
  let total: number
  if (kind === 'skill') {
    const result = await listHubSkills({ page, pageSize, keyword })
    const data = result.data || result
    entries = data.skills || []
    total = Number(data.total ?? entries.length)
  } else {
    const { experts } = await listHubExperts()
    const term = keyword.toLowerCase()
    const matches = experts.filter(item => !term || [item.id, item.displayName, item.name, item.profession, item.description]
      .some(value => hubText(value).toLowerCase().includes(term)))
    total = matches.length
    entries = matches.slice((page - 1) * pageSize, page * pageSize)
  }
  const items = await Promise.all(entries.map(async item => {
    const slug = String(kind === 'skill' ? item.slug : item.id || item.name)
    const icon = await hubIcon(kind, hubText(kind === 'skill' ? item.iconUrl || item.icon || item.emoji : item.avatar || item.icon))
    return {
      slug, name: hubText(item.displayName) || hubText(item.name) || slug,
      description: hubText(item.description_zh) || hubText(item.description) || hubText(item.summary),
      category: hubText(item.categoryName) || hubText(item.category?.nameZh || item.category) || hubText(item.profession),
      team: item.expertType === 'team', namespace: hubText(item.namespace?.handle || item.namespace),
      version: hubText(item.latestVersion?.version || item.version),
      icon: icon || (kind === 'skill' ? skillHubPresetIcon(slug) : ''),
    }
  }))
  return { items, total, page, pageSize }
}
