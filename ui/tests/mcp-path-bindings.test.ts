import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { mcpLocalEnvironment, validateMcpPathSettings, installMcpPathBindings } from '../../packages/app-sdk/src/mcp/path-bindings.mjs'
import { normalizeMcpLocalOptions } from '../../packages/app-sdk/src/mcp/local-options.mjs'

test('public repositories require a repository root and an executable Git; inherited Git redirects are removed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-git-settings-'))
  const config = { type: 'stdio' as const, roots: { directories: [root], includeWorkspace: true, delivery: 'roots' as const }, pathBindings: [{ argument: 'repo_path', kind: 'git-repository' as const, executable: '' }] }
  try {
    await expect(validateMcpPathSettings(config)).rejects.toThrow('not a git repository')
    execFileSync('git', ['init', '-q', root])
    await validateMcpPathSettings(config)
    const subdir = path.join(root, 'subdir'); await fs.mkdir(subdir)
    await expect(validateMcpPathSettings({ ...config, roots: { ...config.roots, directories: [subdir] } })).rejects.toThrow('根目录')
    await expect(validateMcpPathSettings({ ...config, pathBindings: [{ ...config.pathBindings[0], executable: path.join(root, 'missing') }] })).rejects.toThrow('未找到 Git')
    const env = mcpLocalEnvironment(config, { PATH: '/fixture', GIT_DIR: '/outside/.git', GIT_WORK_TREE: '/outside', GIT_CONFIG_COUNT: '8' })
    expect(env.GIT_DIR).toBeUndefined(); expect(env.GIT_WORK_TREE).toBeUndefined()
    expect(env.PATH).toBe('/fixture'); expect(env.GIT_PYTHON_GIT_EXECUTABLE).toBe('git')
    expect(() => normalizeMcpLocalOptions({ python: { requirements: ['--target=/tmp'] } })).toThrow('固定版本')
    expect(() => normalizeMcpLocalOptions({ ...config, type: 'http' })).toThrow('stdio')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('directory parameter defaults never fall back to public roots and checks happen before sending', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-binding-'))
  try {
    const calls: any[] = []
    const client = { request: async (...args: any[]) => { calls.push(args[0]); return {} } }
    const config = { roots: { directories: [root], includeWorkspace: true, delivery: 'roots' as const }, pathBindings: [{ argument: 'path', kind: 'directory' as const }] }
    installMcpPathBindings(client, config)
    await expect(client.request({ method: 'tools/call', params: { name: 'read' } })).rejects.toThrow('没有会话工作目录')
    expect(calls).toHaveLength(0)
    await client.request({ method: 'tools/call', params: { name: 'read', arguments: { path: root } } })
    expect(calls[0].params.arguments.path).toBe(await fs.realpath(root))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
