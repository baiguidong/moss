import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('collaborative mailbox renderer boundary', () => {
  test('exposes list and delete without send or reply IPC', async () => {
    const [mainSource, preloadSource, pollerSource] = await Promise.all([
      Bun.file(path.join(uiRoot, 'src/main.mjs')).text(),
      Bun.file(path.join(uiRoot, 'src/preload.mjs')).text(),
      Bun.file(path.join(uiRoot, 'src/agent-mail-poller.mjs')).text(),
    ])

    expect(mainSource).toContain("ipcMain.handle('agent-mail:list'")
    expect(mainSource).toContain("ipcMain.handle('agent-mail:delete'")
    expect(preloadSource).toContain("ipcRenderer.invoke('agent-mail:list'")
    expect(preloadSource).toContain("ipcRenderer.invoke('agent-mail:delete'")
    expect(mainSource).not.toContain("ipcMain.handle('agent-mail:reply'")
    expect(preloadSource).not.toContain("ipcRenderer.invoke('agent-mail:reply'")
    expect(preloadSource).not.toContain("ipcRenderer.invoke('agent-mail:send'")
    expect(mainSource).toContain('resetRuntimeBeforePrompt: fixedSession')
    expect(mainSource).toContain('agentMailStore.getThreadContext(mailboxKey, threadId)')
    expect(mainSource).toContain('buildAgentMailMailboxKey(connection)')
    expect(mainSource).toContain('mailConnection: context.mailConnection || null')
    expect(mainSource).toContain('retryEncryptedContentOnce: true')
    expect(pollerSource).toContain("store.finish(activeConnection.mailboxKey, record.messageId, 'failed', message)")
  })
})
