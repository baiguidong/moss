import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeMcpRoots, prepareMcpDirectoryLaunch, resolveMcpDirectories } from '../../packages/app-sdk/src/mcp/directories.mjs'

test('directory launch keeps workspace first, supports aliases, and never changes shared settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-roots-'))
  try {
    const a = path.join(root, '会话 A #1'), b = path.join(root, 'B'), shared = path.join(root, 'Shared'), alias = path.join(root, 'Alias')
    await Promise.all([a, b, shared].map(dir => fs.mkdir(dir)))
    await fs.symlink(shared, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const config = { args: ['server'], roots: { directories: [alias, alias], includeWorkspace: true, delivery: 'arguments' } }
    expect(await prepareMcpDirectoryLaunch(config, a)).toEqual({ args: ['server', a, alias], roots: [] })
    expect(await prepareMcpDirectoryLaunch(config, b)).toEqual({ args: ['server', b, alias], roots: [] })
    expect(config.roots.directories).toEqual([alias, alias])
    expect(await prepareMcpDirectoryLaunch(config)).toEqual({ args: ['server', alias], roots: [] })
    expect(await prepareMcpDirectoryLaunch({ ...config, roots: { ...config.roots, directories: [] } })).toEqual({ args: ['server'], roots: [] })
    expect((await prepareMcpDirectoryLaunch({ ...config, roots: { ...config.roots, delivery: 'roots' } }, a))?.roots).toEqual([{ uri: pathToFileURL(a).href }, { uri: pathToFileURL(alias).href }])
    await expect(resolveMcpDirectories({ ...config.roots, directories: [path.join(root, 'missing')] })).rejects.toThrow('目录不存在')
    expect(() => normalizeMcpRoots({ ...config.roots, directories: ['../outside'] })).toThrow('绝对路径')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
