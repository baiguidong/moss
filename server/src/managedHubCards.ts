import { categoryId, categoryLabel, expertCategories, hubText, listHubExperts, listHubSkillCategories, listHubSkills, type HubCategory } from './managedHub.js'
import { hubIcon, skillHubPresetIcon } from './managedResourceIcons.js'
import type { ManagedResourceKind } from './managedResources.js'

export async function listManagedHubCards(kind: ManagedResourceKind, query: URLSearchParams) {
  const page = Math.max(1, Number.parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = 12
  const keyword = (query.get('keyword') || '').trim()
  const category = (query.get('category') || '').trim()
  let entries: Record<string, any>[]
  let categories: HubCategory[]
  let total: number
  if (kind === 'skill') {
    const [result, skillCategories] = await Promise.all([listHubSkills({ page, pageSize, keyword, category }), listHubSkillCategories()])
    categories = skillCategories
    const data = result.data || result
    entries = data.skills || []
    total = Number(data.total ?? entries.length)
  } else {
    const bundle = await listHubExperts()
    categories = expertCategories(bundle)
    const term = keyword.toLowerCase()
    const matches = bundle.experts.filter(item => {
      const id = categoryId(item.categoryId || item.category)
      if (category && id !== category) return false
      return !term || [item.id, item.displayName, item.name, item.profession, item.description, categoryLabel(kind, id, categories)]
        .some(value => hubText(value).toLowerCase().includes(term))
    })
    total = matches.length
    entries = matches.slice((page - 1) * pageSize, page * pageSize)
  }
  const items = await Promise.all(entries.map(async item => {
    const slug = String(kind === 'skill' ? item.slug : item.id || item.name)
    const icon = await hubIcon(kind, hubText(kind === 'skill' ? item.iconUrl || item.icon || item.emoji : item.avatar || item.icon))
    return {
      slug, name: hubText(item.displayName) || hubText(item.name) || slug,
      subtitle: kind === 'skill' ? hubText(item.ownerName || item.owner?.displayName || item.namespace?.displayName || item.namespace?.handle) : hubText(item.profession || item.title),
      description: hubText(item.summary_zh) || hubText(item.description_zh) || hubText(item.description) || hubText(item.summary),
      category: hubText(item.categoryName) || categoryLabel(kind, item.categoryId || item.category, categories),
      subCategories: kind === 'skill' && Array.isArray(item.subCategories)
        ? item.subCategories.map(value => categoryLabel(kind, value)).filter(Boolean) : [],
      team: (item.expertType || item.type) === 'team', namespace: hubText(item.namespace?.handle || item.namespace),
      version: hubText(item.latestVersion?.version || item.version),
      icon: icon || (kind === 'skill' ? skillHubPresetIcon(slug) : ''),
    }
  }))
  return { items, categories, total, page, pageSize }
}
