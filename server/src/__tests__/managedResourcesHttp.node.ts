import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { createModels } from '../model/index.js'
import { createAuthService } from '../auth/service.js'
import { readServerConfig } from '../config.js'
import { startServer } from '../server.js'
import { updateSystemSettings } from '../systemSettings.js'
import { createManagedResourceClient, managedResourceIpc } from '../../../ui/src/managed-resource-client.mjs'

const root = await mkdtemp(join(tmpdir(), 'moss-managed-http-'))
process.env.MOSS_SERVER_HOME = root
const home = join(root, 'desktop')
const models = await createModels({ driver: 'sqlite', filename: join(root, 'db.sqlite') })
const { service: auth } = await createAuthService({ db: models.db, tokenTtlSec: 3600, bootstrapAdmin: { username: 'admin', password: 'password' } })
const admin = await auth.issueTokenFromPassword({ username: 'admin', password: 'password' })
const { department: parent } = await auth.createDepartment({ orgId: admin.user.orgId, name: '运营部' })
const { department: child } = await auth.createDepartment({ orgId: admin.user.orgId, parentId: parent.id, name: '内容组' })
async function user(name: string, departmentId: string) {
  const { user } = await auth.createUser({ orgId: admin.user.orgId, name, departmentId, password: 'password' })
  return auth.issueTokenFromPassword({ username: user.name, password: 'password' })
}
const a = await user('member-a', parent.id)
const b = await user('member-b', child.id)
const { config } = await readServerConfig(join(root, 'server.json'))
const app = startServer({ ...config, port: 0, host: '127.0.0.1' }, models, auth)
const base = `http://127.0.0.1:${await app.ready}`
const api = '/api/v1/managed-resources'
const packageBytes = await new JSZip().file('SKILL.md', '# Local only download').generateAsync({ type: 'nodebuffer' })
const hub = createServer((req, res) => {
  const url = new URL(req.url!, 'http://localhost')
  const path = url.pathname
  if (path === '/api/v1/categories') return res.end(JSON.stringify({ items: [{ key: 'office-tools', name: '办公工具' }] }))
  if (path === '/api/skills') {
    const skills = [
      { slug: 'hub-skill', category: 'office-tools', subCategories: [{ key: 'office-doc', name: '文档处理' }], description_zh: '画图', iconUrl: '🎨' },
      { slug: 'no-art' }, { slug: 'broken-art', iconUrl: '/missing.png' },
    ].filter(skill => !url.searchParams.has('category') || skill.category === url.searchParams.get('category'))
    return res.end(JSON.stringify({ data: { skills, total: skills.length } }))
  }
  if (path === '/api/v1/skills/hub-skill') return res.end(JSON.stringify({ skill: { name: 'hub-skill', iconUrl: '🎨', category: 'office-tools' } }))
  if (path === '/api/v1/download') return res.end(packageBytes)
  if (path === '/expert_center.json') return res.end(JSON.stringify({
    categories: [{ id: '06-ContentCreative', name: { zh: '内容创作' } }, { id: 'custom', name: { zh: '自定义' } }],
    experts: [{ id: 'helper', categoryId: '06-ContentCreative', promptFile: 'helper.md', avatar: '🎙' }, { id: 'other', categoryId: 'custom' }],
  }))
  if (path === '/helper.md') return res.end('Expert from the Hub')
  res.writeHead(404).end()
})
await new Promise<void>(resolve => hub.listen(0, '127.0.0.1', resolve))
const hubUrl = 'http://127.0.0.1:' + (hub.address() as { port: number }).port
process.env.MOSS_SKILL_HUB_BASE_URL = process.env.MOSS_EXPERT_HUB_BASE_URL = hubUrl
async function request(path: string, method = 'GET', body?: unknown, login = admin) {
  return fetch(base + api + path, { method, headers: { Authorization: 'Bearer ' + login.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
async function change(path: string, method: string, body?: unknown) {
  const response = await request(path, method, body)
  const data = await response.json() as any
  assert.equal(response.status, 200, JSON.stringify(data))
  return data
}
let account = a
let downloads = 0
let connected = true
const client = createManagedResourceClient({
  home, accountKey: () => account.user.id, resolveConnection: () => ({ serverUrl: base, authToken: account.access_token }),
  fetchImpl: (url: string, init: RequestInit) => {
    assert.equal(new URL(url).origin, base, 'desktop must only contact Moss Server')
    if (!connected) throw new Error('Server unreachable')
    if (url.endsWith('/download')) downloads++
    return fetch(url, init)
  },
})
const visible = async () => {
  const catalog = await client.refresh()
  assert.ok(catalog?.enabled)
  assert.equal(catalog.error, undefined)
  return catalog.resources
}
try {
  assert.equal(await client.refresh(), null)
  const skills = await change('/hub/skills?view=cards', 'GET')
  assert.equal(skills.items[0].description, '画图')
  assert.equal(skills.items[0].category, '办公工具')
  assert.deepEqual(skills.items[0].subCategories, ['文档处理'])
  assert.deepEqual(skills.categories, [{ id: 'office-tools', name: '办公工具' }])
  assert.equal((await change('/hub/skills?view=cards&category=office-tools', 'GET')).total, 1)
  assert.match(skills.items[0].icon, /^data:image\/svg\+xml;/)
  assert.match(skills.items[1].icon, /^data:image\/webp;/)
  assert.match(skills.items[2].icon, /^data:image\/webp;/)
  assert.notEqual(skills.items[1].icon, skills.items[2].icon)
  const experts = await change('/hub/experts?view=cards', 'GET')
  assert.equal(experts.items[0].category, '内容创作')
  const filtered = await change('/hub/experts?view=cards&category=custom&keyword=自定义', 'GET')
  assert.deepEqual(filtered.items.map((r: any) => r.slug), ['other'])
  assert.deepEqual(filtered.categories, experts.categories)
  assert.ok(experts.items[0].icon.startsWith('data:image/'))
  const skillIds = []
  const { resource: first } = await change('/skills/install-from-hub', 'POST', { slug: 'hub-skill' })
  skillIds.push(first.id)
  for (let i = 1; i < 12; i++) {
    const { resource } = await change('/skills/install', 'POST', { slug: 'skill-' + i, package_base64: packageBytes.toString('base64') })
    skillIds.push(resource.id)
  }
  const { resource: expert } = await change('/experts/install-from-hub', 'POST', { id: 'helper' })
  const localCopy = join(home, 'skills', 'skill-11')
  await mkdir(localCopy, { recursive: true })
  await writeFile(join(localCopy, 'SKILL.md'), 'Personal copy')
  updateSystemSettings({ resourceControl: { enforceServerManagedSkillsExperts: true } })
  assert.deepEqual((await visible()).map((r: any) => [r.id, r.categoryName]), [[expert.id, '内容创作']])
  assert.equal((await change('/users/experts/assignments', 'POST', { user_ids: [a.user.id, b.user.id] })).assigned_counts[expert.id], 2)
  await change('/users/' + a.user.id + '/skills/policy', 'PUT', { resource_ids: skillIds.slice(0, 10) })
  await change('/users/' + a.user.id + '/experts/policy', 'PUT', { resource_ids: [expert.id] })
  await change('/users/' + b.user.id + '/skills/policy', 'PUT', { resource_ids: skillIds.slice(10) })
  const directory = await change('/users', 'GET')
  assert.equal(directory.users.find((u: any) => u.id === a.user.id).departmentId, parent.id)
  assert.equal(directory.departments.find((d: any) => d.id === child.id).parentId, parent.id)
  const recipients = { user_ids: [a.user.id, b.user.id] }
  const assignments = '/users/skills/assignments'
  const delta = { ...recipients, remove: [first.id], add: [skillIds[10]] }
  assert.equal((await change(assignments, 'POST', recipients)).assigned_counts[first.id], 1)
  assert.equal((await request(assignments, 'PATCH', delta, a)).status, 403)
  assert.equal((await request(assignments, 'PATCH', { ...delta, user_ids: [a.user.id, 'missing'] })).status, 404)
  assert.equal((await request(assignments, 'PATCH', { ...delta, add: [expert.id] })).status, 400)
  assert.equal((await request(assignments, 'PATCH', { ...delta, add: [first.id] })).status, 400)
  assert.deepEqual((await change('/users/' + a.user.id + '/skills/policy', 'GET')).resource_ids, skillIds.slice(0, 10))
  for (let retry = 0; retry < 2; retry++) {
    const { assigned_counts } = await change(assignments, 'PATCH', delta)
    assert.equal(assigned_counts[first.id], undefined)
    assert.equal(assigned_counts[skillIds[10]], 2)
    assert.equal(assigned_counts[skillIds[1]], 1)
  }
  assert.deepEqual((await change('/users/' + b.user.id + '/skills/policy', 'GET')).resource_ids, skillIds.slice(10))
  await change('/users/' + a.user.id + '/skills/policy', 'PUT', { resource_ids: skillIds.slice(0, 10) })
  const resources = await visible()
  assert.deepEqual(resources.map((r: any) => r.id), [...skillIds.slice(0, 10), expert.id])
  assert.equal(await readFile(join(resources[10].source, 'assistant.md'), 'utf8'), 'Expert from the Hub')
  assert.equal(downloads, 11)
  for (const catalog of [resources, await visible()]) {
    assert.equal(catalog[0].icon, skills.items[0].icon)
    assert.equal(catalog[0].category, '办公工具')
    assert.equal(catalog[10].avatar, experts.items[0].icon)
    assert.equal(catalog[1].icon, '')
  }
  assert.equal(downloads, 11)
  assert.equal((await request('/skills', 'GET', undefined, a)).status, 403)
  assert.equal((await request('/users/' + a.user.id + '/skills/policy', 'PUT', { resource_ids: skillIds }, a)).status, 403)
  assert.equal((await request('/skill/' + skillIds[11] + '/download', 'GET', undefined, a)).status, 404)
  await change('/skills/' + first.id, 'PATCH', { enabled: false })
  assert.equal((await visible()).filter((r: any) => r.kind === 'skill').length, 9)
  assert.equal((await request('/skill/' + first.id + '/download', 'GET', undefined, a)).status, 404)
  await change('/users/' + a.user.id + '/experts/policy', 'PUT', { resource_ids: [] })
  assert.equal((await visible()).some((item: any) => item.kind === 'expert'), false)
  assert.equal((await request('/expert/' + expert.id + '/download', 'GET', undefined, a)).status, 404)
  account = b
  assert.deepEqual((await visible()).map((r: any) => r.id), [...skillIds.slice(10), expert.id])
  const updated = await new JSZip().file('SKILL.md', '# Revised').generateAsync({ type: 'nodebuffer' })
  const { resource: replacement } = await change('/skills/install', 'POST', { slug: 'skill-11', package_base64: updated.toString('base64') })
  assert.equal(replacement.id, skillIds[11])
  assert.equal(await readFile(join((await visible())[1].source, 'SKILL.md'), 'utf8'), '# Revised')
  connected = false
  assert.deepEqual((await client.refresh()).resources, [])
  connected = true
  const handlers = new Map()
  const ipc = managedResourceIpc({ handle: (method: string, callback: Function) => handlers.set(method, callback) }, client)
  ipc.handle('public-skillhub:uninstall-skill', () => 'original-local-handler')
  account = admin
  assert.equal((await handlers.get('public-skillhub:uninstall-skill')({}, {})).success, false)
  updateSystemSettings({ resourceControl: { enforceServerManagedSkillsExperts: false } })
  assert.equal(await handlers.get('public-skillhub:uninstall-skill')({}, {}), 'original-local-handler')
  connected = false
  assert.equal(await client.refresh(), null, 'the last confirmed disabled switch preserves the local mode for this account')
  assert.equal(await readFile(join(localCopy, 'SKILL.md'), 'utf8'), 'Personal copy')
} finally {
  hub.close()
  await app.stop()
  await models.close()
  await rm(root, { recursive: true, force: true })
}
