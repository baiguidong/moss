import fs from 'node:fs/promises'
import path from 'node:path'
import { validateAppPackage, writePackageChecksums } from '../../../packages/app-runtime/src/packages/index.mjs'
import { exportConnectorPackage, listConnectorCatalog } from '../../src/connector-hub-ipc.mjs'
const capabilities = connector => ['mcp', 'cli', 'skills'].filter(kind => connector[{ mcp: 'hasMcp', cli: 'hasCli', skills: 'hasSkills' }[kind]])
export const serviceAppName = id => id === 'feishu' ? 'feishu-cli' : id
const categoryFor = connector => {
  const text = `${connector.name} ${connector.description}`
  if (/邮箱|邮件|会议|通讯|飞书|钉钉|企微|微信/.test(text)) return 'communication'
  if (/知识库|文档|网盘|存储|PDF|资料/.test(text)) return 'knowledge'
  if (/开发|代码|部署|数据库|云函数|服务器/.test(text)) return 'development'
  return 'other'
}

export async function generateConnectorAppPackage(connector, version, destination, revision) {
  const metadata = await exportConnectorPackage(connector.id, path.join(destination, 'connector'), revision)
  if (revision && (await listConnectorCatalog()).revision !== revision) throw new Error('服务目录已变化，请刷新后重新安装')
  const manifest = {
    schemaVersion: 2, id: `moss.${serviceAppName(connector.id)}`, version,
    displayName: connector.id === 'feishu' ? '飞书工具' : connector.name,
    description: connector.description || connector.name, category: categoryFor(connector),
    keywords: [connector.id, connector.nameEn, ...capabilities(connector)].filter(Boolean).map(value => value.slice(0, 40)),
    discovery: connector.discovery || { group: 'online' },
    hostApi: '^3.15.0', publisher: { id: 'moss', name: 'Moss 连接器目录' },
    permissions: ['connector:use'], toolScope: 'session', navigation: { location: 'none' },
    connectorApp: { id: connector.id, capabilities: capabilities(connector) },
  }
  const icon = /^data:(image\/(?:svg\+xml|png|jpeg|webp));base64,(.+)$/s.exec(metadata.icon || '')
  if (icon) {
    const extension = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[icon[1]]
    manifest.icon = `icon.${extension}`
    await fs.writeFile(path.join(destination, manifest.icon), Buffer.from(icon[2], 'base64'))
  }
  await fs.writeFile(path.join(destination, 'app.moss.json'), JSON.stringify(manifest, null, 2) + '\n')
  await fs.writeFile(path.join(destination, 'README.md'), `# ${manifest.displayName}\n\n${manifest.description}\n\nMoss 托管 MCP、CLI 与随包技能。通过应用管理配置账号；在会话中选择后使用。\n`)
  await writePackageChecksums(destination)
  return validateAppPackage(destination)
}
