import { test, expect, afterAll } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { connectToServer, ensureConnectedClient, releaseMcpLifetime } from './client'
import { runWithCwdOverride } from '../../utils/cwd'
import { runWithSessionIdContext } from '../../utils/sessionIdContext'
import { asSessionId } from '../../types/ids'
import { resolveMcpLaunchConfig } from '../../../ui/src/apps/mcp-launch-config.mjs'
import type { ConnectedMCPServer, ScopedMcpServerConfig } from './types'

// Opt in because the pinned third-party server may need its first npm download.
const integration = process.env.MOSS_TEST_FILESYSTEM_MCP === '1' ? test : test.skip
const previousMacro = (globalThis as any).MACRO
;(globalThis as any).MACRO = { VERSION: 'test', BUILD_TIME: '', FEEDBACK_CHANNEL: '', ISSUES_EXPLAINER: '', VERSION_CHANGELOG: '' }
afterAll(() => { if (previousMacro) (globalThis as any).MACRO = previousMacro; else delete (globalThis as any).MACRO })

integration('real configured Filesystem preserves session and public scope through calls, Roots notifications and reconnect', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-filesystem-')))
  const sessions: Array<{ dispose: () => Promise<void> }> = []
  try {
    const a = path.join(root, '会话 A #1'), b = path.join(root, 'B'), shared = path.join(root, 'Shared'), alias = path.join(root, 'Alias'), outside = path.join(root, 'Outside')
    for (const [directory, content] of [[a, 'A'], [b, 'B'], [shared, 'shared'], [outside, 'outside']]) {
      await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'note.txt'), content)
    }
    await fs.symlink(shared, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await fs.symlink(outside, path.join(a, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const source = JSON.parse(await fs.readFile(process.env.MOSS_FILESYSTEM_CONFIG || path.resolve(import.meta.dir, '../../../../moss-apps/artifacts/moss.filesystem/0.1.2/package/mcp.json'), 'utf8')).mcpServers.filesystem
    const open = async (workspace = '', directories: string[] = [alias]) => {
      const id = crypto.randomUUID(), controller = new AbortController()
      const config = { ...resolveMcpLaunchConfig({ ...source, roots: { ...source.roots, directories } }, { workspace: workspace || undefined }), scope: 'dynamic' } as ScopedMcpServerConfig
      const run = <T>(fn: () => T) => runWithCwdOverride(root, () => runWithSessionIdContext(asSessionId(id), null, fn, undefined, undefined, { executionEnvironment: 'desktop', mcpLifetime: { id, signal: controller.signal } }))
      const session = { dispose: async () => { controller.abort(); await releaseMcpLifetime(id) } }
      sessions.push(session)
      const connection = await run(() => connectToServer('filesystem', config))
      expect(connection.type).toBe('connected')
      const client = connection as ConnectedMCPServer
      const call = (name: string, args: Record<string, unknown> = {}) => run(async () => {
        const connected = await ensureConnectedClient(client)
        const result = await connected.client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema)
        if (result.isError) throw new Error(JSON.stringify(result))
        return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      })
      return { ...session, client, run, call }
    }
    const first = await open(a), second = await open(b)
    expect(await first.call('read_text_file', { path: 'note.txt' })).toBe('A')
    expect(await second.call('read_text_file', { path: 'note.txt' })).toBe('B')
    for (const [session, other] of [[first, b], [second, a]] as const) {
      // Core rebuilds connections on scope changes. Inject a late wire notification
      // to check that the upstream cannot replace the already-bound directory union.
      await session.run(() => session.client.client.transport!.send({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' }))
      expect(await session.call('read_text_file', { path: path.join(alias, 'note.txt') })).toBe('shared')
      await expect(session.call('read_text_file', { path: path.join(other, 'note.txt') })).rejects.toThrow()
      await expect(session.call('read_text_file', { path: path.join(outside, 'note.txt') })).rejects.toThrow()
    }
    await expect(first.call('read_text_file', { path: 'escape/note.txt' })).rejects.toThrow()
    await first.call('write_file', { path: 'new.txt', content: 'before' })
    await first.call('edit_file', { path: 'new.txt', edits: [{ oldText: 'before', newText: 'after' }], dryRun: true })
    expect(await fs.readFile(path.join(a, 'new.txt'), 'utf8')).toBe('before')
    await first.call('move_file', { source: 'new.txt', destination: 'moved.txt' })
    expect(await first.call('search_files', { path: '.', pattern: '**/moved.txt' })).toContain('moved.txt')
    const check = await open('', []), sharedCheck = await open()
    expect(await check.call('list_allowed_directories')).toBe('Allowed directories:\n')
    await expect(check.call('list_directory', { path: root })).rejects.toThrow()
    expect(await sharedCheck.call('read_text_file', { path: 'note.txt' })).toBe('shared')
    await first.dispose()
    const restarted = await open(a)
    expect(await restarted.call('read_text_file', { path: 'moved.txt' })).toBe('before')
    expect((await restarted.client.client.listTools()).tools).toHaveLength(14)
  } finally { await Promise.all(sessions.map(session => session.dispose())); await fs.rm(root, { recursive: true, force: true }) }
}, 90_000)
