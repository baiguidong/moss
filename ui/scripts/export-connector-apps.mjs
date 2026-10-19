// One-time source conversion. Never reads or migrates the user's Moss profile.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const target = path.resolve(process.argv[2] || fileURLToPath(new URL('../../../moss-apps', import.meta.url)))
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-connector-source-'))
process.env.MOSS_HOME = path.join(temporary, 'home')
const hub = await import('../src/connector-hub-ipc.mjs')
const { generateConnectorAppPackage, serviceAppName } = await import('./lib/connector-app-package.mjs')
const platforms = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64']
const json = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n')
try {
  await hub.initializeBundledConnectorCatalog(Object.fromEntries([
    ['bundledCatalogPath', 'workbuddy-connectors-config.zip'], ['bundledMcpOverridesPath', 'connector-mcp-overrides.json'],
    ['bundledCliOverridesPath', 'connector-cli-overrides.json'], ['bundledCloudAuthPath', 'cloud-auth-providers.json'],
  ].map(([key, name]) => [key, fileURLToPath(new URL(`../resources/connectors/${name}`, import.meta.url))])))
  const catalog = await hub.listConnectorCatalog()
  for (const connector of catalog.connectors) {
    const name = serviceAppName(connector.id)
    const destination = path.join(target, 'apps', name)
    await fs.mkdir(destination) // Refuse to replace edited source or existing Apps.
    const pkg = await generateConnectorAppPackage(connector, '0.1.0', destination)
    const manifest = { ...pkg.manifest, publisher: { id: 'moss', name: 'Moss' } }
    if (manifest.icon) {
      await fs.mkdir(path.join(destination, 'assets'))
      await fs.rename(path.join(destination, manifest.icon), path.join(destination, 'assets', manifest.icon))
      manifest.icon = `assets/${manifest.icon}`
    }
    await json(path.join(destination, 'app.moss.json'), manifest)
    await fs.rm(path.join(destination, 'checksums.json'))
    await json(path.join(destination, 'package.json'), { name: `@moss/${name}`, version: '0.1.0', private: true, type: 'module',
      scripts: { check: 'node ../../packages/connector-app-build/build.mjs', build: 'node ../../packages/connector-app-build/build.mjs' },
      devDependencies: { '@moss/connector-app-build': 'workspace:*', '@moss/app-runtime': 'workspace:*' } })
    await json(path.join(destination, 'marketplace.json'), { schemaVersion: 1, appId: manifest.id,
      summary: manifest.description.slice(0, 160), description: manifest.description, platforms,
      homepage: `https://github.com/baiguidong/moss-apps/tree/main/apps/${name}`,
      repository: 'https://github.com/baiguidong/moss-apps', featured: false })
    await fs.writeFile(path.join(destination, 'README.md'), `# ${manifest.displayName}\n\n${manifest.description}\n\n从 Moss 应用市场安装，在 Apps → 管理中配置账号；在会话中选择后使用。\n\n分类：在线服务。认证：${manifest.discovery.authMethods?.join(' / ') || '按服务要求配置'}。\n\n本目录包含 MCP、CLI 和技能定义，由 Moss Host 管理运行。构建校验：\`bun run check\`；通过仓库的标准签名、源码随包和市场发布流程交付。\n`)
    console.log(manifest.id)
  }
  console.log(JSON.stringify({ sourceApps: catalog.connectors.length, target, userDataMigrated: false }))
} finally { await fs.rm(temporary, { recursive: true, force: true }) }
