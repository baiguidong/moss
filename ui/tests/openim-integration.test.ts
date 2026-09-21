import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOpenIMIntegration, migrateLegacyOpenIMData } from '../src/openim/openim-integration.mjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function fixture(root: string, shared: { sendCalls: any[]; initCalls?: any[]; loginCalls?: any[] }) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const permissions: Array<{ permission: string; channel: string }> = []
  const sinks: any[] = []
  let loginStatus = 1
  const sdk = {
    initSDK: async (config: any) => { shared.initCalls?.push(config); return true },
    getLoginStatus: async () => ({ data: loginStatus }),
    getSelfUserInfo: async () => ({ data: { userID: 'self' } }),
    login: async (input: any) => { shared.loginCalls?.push(input); loginStatus = 3 },
    logout: async () => { loginStatus = 1 },
    getAllConversationList: async () => ({ data: [] }),
    createTextMessage: async (text: string) => ({ data: { clientMsgID: 'generated', textElem: { content: text } } }),
    sendMessage: async (input: any) => {
      shared.sendCalls.push(input)
      return { data: { ...input.message, serverMsgID: `server-${shared.sendCalls.length}` } }
    },
  }
  const integration = createOpenIMIntegration({
    app: { isPackaged: false },
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    desktopCapturer: { getSources: async () => [] },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
    nativeImage: { createThumbnailFromPath: async () => ({ toPNG: () => Buffer.alloc(0) }), createFromDataURL: () => ({ toPNG: () => Buffer.alloc(0) }) },
    screen: { getPrimaryDisplay: () => ({ id: 1, size: { width: 100, height: 100 }, scaleFactor: 1 }) },
    shell: { openExternal: async (url: string) => url },
    systemPreferences: { getMediaAccessStatus: () => 'granted' },
    mossHome: root,
    allowMediaRoot: () => {},
    resolveMossServerConnection: async () => ({ serverUrl: 'https://moss.test', authToken: 'token' }),
    authorizeClient: (_event: unknown, permission: string, channel: string) => permissions.push({ permission, channel }),
    log: () => {},
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        userID: 'self', imToken: 'im-token', expiresIn: 3600,
        apiAddr: 'https://im.test', wsAddr: 'wss://im.test',
      }),
    }),
    createSdkMain: () => ({
      sdk,
      webContents: [],
      addWebContent(value: unknown) { this.webContents.push(value); sinks.push(value) },
    }),
  })
  return { integration, handlers, permissions, sinks }
}

describe('OpenIM native integration', () => {
  it('copies legacy SDK data once and records a verified migration marker', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    fs.mkdirSync(path.join(root, 'openim', 'sdk', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(root, 'openim', 'sdk', 'nested', 'history.db'), 'history')
    const target = path.join(root, 'apps-data', 'moss.openim', 'instances', 'default', 'openim')
    expect(migrateLegacyOpenIMData(root, target)).toMatchObject({ migrated: true, copied: ['sdk'] })
    expect(fs.readFileSync(path.join(target, 'sdk', 'nested', 'history.db'), 'utf8')).toBe('history')
    expect(migrateLegacyOpenIMData(root, target)).toMatchObject({ migrated: false })
  })

  it('keeps background delivery idempotent across concurrent calls and restarts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const shared = { sendCalls: [] as any[] }
    const first = fixture(root, shared)
    const input = {
      recipientId: 'peer-1',
      conversationId: 'openim-user:self/direct:peer-1',
      text: 'hello',
      idempotencyKey: 'turn-1',
    }
    const [left, right] = await Promise.all([
      first.integration.sendText(input),
      first.integration.sendText(input),
    ])
    expect(left).toEqual(right)
    expect(shared.sendCalls).toHaveLength(1)
    expect(shared.sendCalls[0].message.clientMsgID).not.toBe('generated')

    const restarted = fixture(root, shared)
    await expect(restarted.integration.sendText(input)).resolves.toMatchObject({ duplicate: true })
    expect(shared.sendCalls).toHaveLength(1)
    await expect(restarted.integration.sendText({
      ...input,
      conversationId: 'openim-user:other/direct:peer-1',
      idempotencyKey: 'turn-other-account',
    })).rejects.toThrow(/active account/)
    expect(shared.sendCalls).toHaveLength(1)
  })

  it('coalesces UI and Backend session setup through the Host-owned SDK login', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const shared = { sendCalls: [] as any[], initCalls: [] as any[], loginCalls: [] as any[] }
    const built = fixture(root, shared)
    const createSession = built.handlers.get('openim:create-session')!

    await expect(Promise.all([
      createSession({ sender: { id: 1 } }),
      createSession({ sender: { id: 2 } }),
    ])).resolves.toEqual([
      expect.objectContaining({ userID: 'self', imToken: 'im-token' }),
      expect.objectContaining({ userID: 'self', imToken: 'im-token' }),
    ])
    expect(shared.initCalls).toHaveLength(1)
    expect(shared.loginCalls).toEqual([{ userID: 'self', token: 'im-token' }])
  })

  it('forwards native events and exposes only permission-scoped helper IPC', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const shared = { sendCalls: [] as any[], initCalls: [] as any[] }
    const built = fixture(root, shared)
    const events: Array<[string, unknown]> = []
    const rendererEvents: Array<[string, unknown, unknown]> = []
    built.integration.onEvent((name: string, value: unknown) => events.push([name, value]))
    built.integration.attach({
      id: 7,
      isDestroyed: () => false,
      once: () => {},
      send: (channel: string, name: unknown, value: unknown) => rendererEvents.push([channel, name, value]),
    })
    built.sinks[0].send('openim-sdk-ipc-event', 'OnConnectSuccess', { ok: true })
    expect(events).toEqual([['OnConnectSuccess', { ok: true }]])
    built.sinks[1].send('openim-sdk-ipc-event', 'OnRecvNewMessage', { id: 1 })
    expect(rendererEvents).toEqual([['openim-sdk-ipc-event', 'OnRecvNewMessage', { id: 1 }]])
    expect(built.permissions.at(-1)).toEqual({ permission: 'openim:client', channel: 'openim-sdk-ipc-event' })

    const materialize = built.handlers.get('openim:materialize-file')!
    const file = materialize({ sender: {} }, { fileName: '../note.txt', data: new TextEncoder().encode('hello').buffer })
    expect(file.name).toBe('note.txt')
    expect(fs.readFileSync(file.path, 'utf8')).toBe('hello')
    expect(path.dirname(file.path)).toBe(path.join(
      root, 'apps-data', 'moss.openim', 'instances', 'moss.openim--default', 'openim', 'media',
    ))
    expect(built.permissions.at(-1)).toEqual({ permission: 'openim:files', channel: 'openim:materialize-file' })

    const openExternal = built.handlers.get('openim:open-external')!
    expect(() => openExternal({ sender: {} }, 'javascript:alert(1)')).toThrow(/HTTP/)
    await expect(openExternal({ sender: {} }, 'https://example.com/path')).resolves.toBe('https://example.com/path')
    expect(built.permissions.at(-1)).toEqual({ permission: 'openim:client', channel: 'openim:open-external' })

    const sdkCall = built.handlers.get('openim:sdk-call')!
    const createSession = built.handlers.get('openim:create-session')!
    await createSession({ sender: {} })
    await sdkCall({ sender: {} }, 'initSDK', {
      platformID: 999,
      apiAddr: 'https://attacker.invalid',
      wsAddr: 'wss://attacker.invalid',
      dataDir: '/private',
      logFilePath: '/private',
    })
    expect(shared.initCalls[0]).toMatchObject({
      apiAddr: 'https://im.test',
      wsAddr: 'wss://im.test',
      dataDir: path.join(root, 'apps-data', 'moss.openim', 'instances', 'moss.openim--default', 'openim', 'sdk'),
    })
    await sdkCall({ sender: {} }, 'getAllConversationList')
    expect(built.permissions.at(-1)).toEqual({ permission: 'openim:client', channel: 'openim:sdk-call' })
    await expect(sdkCall({ sender: {} }, 'readFile', '/private/file')).rejects.toThrow(/not available/)
    await expect(sdkCall({ sender: {} }, 'createFileMessageFromFullPath', {
      filePath: '/private/file', fileName: 'file',
    })).rejects.toThrow(/未通过用户选择/)

    const prepareLocalFiles = built.handlers.get('openim:prepare-local-files')!
    expect(() => prepareLocalFiles({ sender: {} }, { files: [{ path: '/private/file' }] })).toThrow(/必须通过文件选择器/)
  })
})
