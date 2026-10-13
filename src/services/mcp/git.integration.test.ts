import { test, expect, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { connectToServer, ensureConnectedClient, releaseMcpLifetime } from './client'
import { runWithCwdOverride } from '../../utils/cwd'
import { runWithSessionIdContext } from '../../utils/sessionIdContext'
import { asSessionId } from '../../types/ids'
import { resolveMcpLaunchConfig } from '../../../ui/src/apps/mcp-launch-config.mjs'
import type { ConnectedMCPServer, ScopedMcpServerConfig } from './types'

const integration = process.env.MOSS_TEST_GIT_MCP === '1' ? test : test.skip
const previousMacro = (globalThis as any).MACRO
;(globalThis as any).MACRO = { VERSION: 'test', BUILD_TIME: '', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' }
afterAll(() => { if (previousMacro) (globalThis as any).MACRO = previousMacro; else delete (globalThis as any).MACRO })

integration('configured official Git preserves workspace defaults, explicit public selection, all 12 tools and reconnect', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-git-config-')))
  const sessions: Array<{ dispose: () => Promise<void> }> = []
  const git = (directory: string, args: string[]) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const seed = async (name: string) => {
    const directory = path.join(root, name)
    await fs.mkdir(directory, { recursive: true }); git(directory, ['init', '-b', 'main'])
    git(directory, ['config', 'user.name', 'Moss Test']); git(directory, ['config', 'user.email', 'test@example.invalid'])
    git(directory, ['config', 'commit.gpgSign', 'false'])
    await fs.writeFile(path.join(directory, 'note.txt'), name + '\n')
    git(directory, ['add', 'note.txt']); git(directory, ['-c', 'core.hooksPath=' + os.devNull, 'commit', '-m', 'Initial fixture'])
    return directory
  }
  try {
    const a = await seed('会话 A #1'), b = await seed('Session B'), shared = await seed('Shared'), outside = await seed('Outside')
    git(a, ['branch', '-m', 'session-a']); git(b, ['branch', '-m', 'session-b'])
    const source = JSON.parse(await fs.readFile(process.env.MOSS_GIT_CONFIG || path.resolve(import.meta.dir, '../../../../moss-apps/mcp-apps/git/app.json'), 'utf8')).mcpServers.git
    const open = async (workspace = '', directories: string[] = [shared], executable = '') => {
      const id = crypto.randomUUID(), controller = new AbortController()
      const config = { ...resolveMcpLaunchConfig({ ...source, type: 'stdio', roots: { ...source.roots, directories },
        pathBindings: [{ ...source.pathBindings[0], executable }] }, { workspace: workspace || undefined }), scope: 'dynamic' } as ScopedMcpServerConfig
      const run = <T>(fn: () => T) => runWithCwdOverride(root, () => runWithSessionIdContext(asSessionId(id), null, fn, undefined, undefined, { executionEnvironment: 'desktop', mcpLifetime: { id, signal: controller.signal } }))
      const session = { dispose: async () => { controller.abort(); await releaseMcpLifetime(id) } }
      sessions.push(session)
      const connection = await run(() => connectToServer('git', config))
      expect(connection.type).toBe('connected')
      if (connection.type !== 'connected') throw new Error(JSON.stringify(connection))
      const client = connection as ConnectedMCPServer
      const call = (name: string, args: Record<string, unknown> = {}) => run(async () => {
        const connected = await ensureConnectedClient(client)
        const result = await connected.client.callTool({ name, arguments: args })
        if (result.isError) throw new Error(JSON.stringify(result))
        return (result.content as Array<{ type: string; text: string }>).filter(item => item.type === 'text').map(item => item.text).join('\n')
      })
      return { ...session, client, run, call }
    }
    const [first, second] = await Promise.all([open(a), open(b)])
    const tools = (await first.client.client.listTools()).tools
    expect(tools).toHaveLength(12)
    expect(tools[0].inputSchema.required || []).not.toContain('repo_path')
    expect(tools[0].description).toContain(a)
    expect(await first.call('git_status')).toContain('session-a')
    expect(await second.call('git_status')).toContain('session-b')
    expect(await first.call('git_status', { repo_path: shared })).toContain('main')
    await expect(first.call('git_status', { repo_path: b })).rejects.toThrow('范围')
    await expect(second.call('git_status', { repo_path: a })).rejects.toThrow('范围')
    await expect(first.call('git_status', { repo_path: outside })).rejects.toThrow('范围')
    await fs.symlink(outside, path.join(a, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(first.call('git_status', { repo_path: 'escape' })).rejects.toThrow('范围')

    await fs.writeFile(path.join(a, 'note.txt'), 'changed\n')
    expect(await first.call('git_diff_unstaged')).toContain('+changed')
    expect(await first.call('git_diff', { target: 'HEAD' })).toContain('+changed')
    await first.call('git_add', { files: ['note.txt'] })
    expect(await first.call('git_diff_staged')).toContain('+changed')
    await first.call('git_reset')
    expect(await fs.readFile(path.join(a, 'note.txt'), 'utf8')).toBe('changed\n')
    expect(git(a, ['diff', '--cached'])).toBe('')
    await first.call('git_add', { files: ['note.txt'] })
    const hook = path.join(a, '.git', 'hooks', 'pre-commit')
    await fs.writeFile(hook, '#!/bin/sh\nexit 99\n', { mode: 0o755 })
    await expect(first.call('git_commit', { message: 'Must reject the hook' })).rejects.toThrow('提交钩子')
    await fs.rm(hook)
    expect(await first.call('git_commit', { message: 'Fixture change' })).toContain('hash')
    expect(await first.call('git_log', { max_count: 1 })).toContain('Fixture change')
    expect(await first.call('git_show', { revision: 'HEAD' })).toContain('Fixture change')
    await first.call('git_create_branch', { branch_name: 'feature/test', base_branch: 'session-a' })
    expect(await first.call('git_branch', { branch_type: 'local', contains: 'HEAD' })).toContain('feature/test')
    await first.call('git_checkout', { branch_name: 'feature/test' })
    expect(git(a, ['branch', '--show-current'])).toBe('feature/test')
    await fs.writeFile(path.join(a, '-A'), 'literal path\n')
    await first.call('git_add', { files: ['-A'] })
    expect(git(a, ['diff', '--cached', '--name-only'])).toBe('-A')
    await expect(first.call('git_add', { files: [path.join(outside, 'note.txt')] })).rejects.toThrow()
    await expect(first.call('git_show', { revision: '--output=bad' })).rejects.toThrow()
    git(a, ['config', 'diff.fixture.textconv', 'must-not-execute'])
    await expect(first.call('git_diff_unstaged')).rejects.toThrow('外部 diff/textconv')
    git(a, ['config', '--unset', 'diff.fixture.textconv'])

    const empty = await open('', []), publicOnly = await open()
    expect((await empty.client.client.listTools()).tools).toHaveLength(12)
    await expect(empty.call('git_status', { repo_path: a })).rejects.toThrow('范围')
    await expect(publicOnly.call('git_status')).rejects.toThrow('没有会话工作目录')
    expect(await publicOnly.call('git_status', { repo_path: shared })).toContain('main')
    const parent = path.join(root, 'Parent'); await fs.mkdir(parent)
    await seed('Parent/Nested')
    const nested = await open(parent)
    await expect(nested.call('git_status')).rejects.toThrow('not a git repository')
    expect(await nested.call('git_status', { repo_path: 'Nested' })).toContain('main')
    const subdir = path.join(a, 'subdir'); await fs.mkdir(subdir)
    const confined = await open(subdir, [])
    await expect(confined.call('git_status')).rejects.toThrow('根目录超出')
    await first.dispose()
    const restarted = await open(a)
    expect(await restarted.call('git_status')).toContain('feature/test')
    expect(await restarted.call('git_log', { max_count: 1 })).toContain('Fixture change')
  } finally { await Promise.all(sessions.map(session => session.dispose())); await fs.rm(root, { recursive: true, force: true }) }
}, 150_000)
