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

function fixture(root: string, shared: {
  sendCalls: any[];
  markReadCalls?: any[];
  initCalls?: any[];
  loginCalls?: any[];
  logoutCalls?: any[];
  fetchCalls?: any[];
  sessionProfiles?: any[];
  connection?: { serverUrl: string; authToken: string; userId?: string; orgId?: string };
  loginError?: unknown;
}) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const permissions: Array<{ permission: string; channel: string }> = []
  const sinks: any[] = []
  let loginStatus = 1
  const sdk = {
    initSDK: async (config: any) => { shared.initCalls?.push(config); return true },
    getLoginStatus: async () => ({ data: loginStatus }),
    getSelfUserInfo: async () => ({ data: { userID: 'self' } }),
    login: async (input: any) => {
      shared.loginCalls?.push(input)
      if (shared.loginError) throw shared.loginError
      loginStatus = 3
    },
    logout: async () => { shared.logoutCalls?.push({}); loginStatus = 1 },
    getAllConversationList: async () => ({ data: [] }),
    getOneConversation: async ({ sourceID }: any) => ({ data: { conversationID: `si_${sourceID}_self` } }),
    markConversationMessageAsRead: async (conversationID: string) => { shared.markReadCalls?.push(conversationID) },
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
    resolveMossServerConnection: async () => shared.connection || ({
      serverUrl: 'https://moss.test', authToken: 'token', userId: 'user-self', orgId: 'org-one',
    }),
    authorizeClient: (_event: unknown, permission: string, channel: string) => permissions.push({ permission, channel }),
    log: () => {},
    fetchImpl: async (url: string, options: unknown) => {
      shared.fetchCalls?.push({ url, options })
      const profile = shared.sessionProfiles?.shift() || {
        userID: 'self', imToken: 'im-token', expiresIn: 3600,
        apiAddr: 'https://im.test', wsAddr: 'wss://im.test',
      }
      return { ok: true, json: async () => profile }
    },
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
      extension: 'app-defined-message-kind',
    }
    const [left, right] = await Promise.all([
      first.integration.sendText(input),
      first.integration.sendText(input),
    ])
    expect(left).toEqual(right)
    expect(shared.sendCalls).toHaveLength(1)
    expect(shared.sendCalls[0].message.clientMsgID).not.toBe('generated')
    expect(shared.sendCalls[0].message.ex).toBe('app-defined-message-kind')

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

  it('marks only a conversation owned by the active OpenIM account as read', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const shared = { sendCalls: [] as any[], markReadCalls: [] as any[] }
    const built = fixture(root, shared)

    await expect(built.integration.markConversationRead({
      conversationId: 'openim-user:self/direct:peer-1',
    })).resolves.toEqual({
      read: true,
      conversationId: 'openim-user:self/direct:peer-1',
    })
    expect(shared.markReadCalls).toEqual(['si_peer-1_self'])
    await expect(built.integration.markConversationRead({
      conversationId: 'openim-user:other/direct:peer-1',
    })).rejects.toThrow(/active account/)
  })

  it('coalesces UI and Backend session setup through the Host-owned SDK login', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const shared = {
      sendCalls: [] as any[], initCalls: [] as any[], loginCalls: [] as any[], fetchCalls: [] as any[],
    }
    const built = fixture(root, shared)
    const createSession = built.handlers.get('openim:create-session')!
    const sdkCall = built.handlers.get('openim:sdk-call')!

    const profiles = await Promise.all([
      createSession({ sender: { id: 1 } }),
      createSession({ sender: { id: 2 } }),
    ])
    expect(profiles).toEqual([
      expect.objectContaining({ userID: 'self', imToken: 'im-token' }),
      expect.objectContaining({ userID: 'self', imToken: 'im-token' }),
    ])
    expect(shared.initCalls).toHaveLength(1)
    expect(shared.loginCalls).toEqual([{ userID: 'self', token: 'im-token' }])
    // The renderer initializes its proxy after the Host and performs a
    // logout/login cycle with the already-issued credentials.
    await sdkCall({ sender: { id: 1 } }, 'logout')
    await sdkCall({ sender: { id: 1 } }, 'login', {
      userID: profiles[0].userID,
      token: profiles[0].imToken,
    })
    await expect(createSession({ sender: { id: 3 } })).resolves.toMatchObject({
      userID: 'self', imToken: 'im-token',
    })
    expect(shared.fetchCalls).toHaveLength(1)
    expect(shared.loginCalls).toHaveLength(2)
  })

  it('reuses the OpenIM token when the access token rotates for the same Moss identity', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const shared = {
      sendCalls: [] as any[],
      loginCalls: [] as any[],
      logoutCalls: [] as any[],
      fetchCalls: [] as any[],
      connection: {
        serverUrl: 'https://moss.test', authToken: 'token-one', userId: 'user-self', orgId: 'org-one',
      },
      sessionProfiles: [
        { userID: 'self', imToken: 'im-token-one', expiresIn: 3600, apiAddr: 'https://im.test', wsAddr: 'wss://im.test' },
      ],
    }
    const built = fixture(root, shared)
    const createSession = built.handlers.get('openim:create-session')!

    await createSession({ sender: {} })
    shared.connection.authToken = 'token-two'
    await expect(createSession({ sender: {} })).resolves.toMatchObject({ imToken: 'im-token-one' })

    expect(shared.fetchCalls).toHaveLength(1)
    expect(shared.logoutCalls).toHaveLength(0)
    expect(shared.loginCalls).toEqual([{ userID: 'self', token: 'im-token-one' }])
  })

  it('issues a new OpenIM token when the Moss Server identity changes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const shared = {
      sendCalls: [] as any[], loginCalls: [] as any[], logoutCalls: [] as any[], fetchCalls: [] as any[],
      connection: {
        serverUrl: 'https://moss.test', authToken: 'token-one', userId: 'user-one', orgId: 'org-one',
      },
      sessionProfiles: [
        { userID: 'self', imToken: 'im-token-one', expiresIn: 3600, apiAddr: 'https://im.test', wsAddr: 'wss://im.test' },
        { userID: 'self', imToken: 'im-token-two', expiresIn: 3600, apiAddr: 'https://im.test', wsAddr: 'wss://im.test' },
      ],
    }
    const built = fixture(root, shared)
    const createSession = built.handlers.get('openim:create-session')!

    await createSession({ sender: {} })
    shared.connection.userId = 'user-two'
    shared.connection.authToken = 'token-two'
    await expect(createSession({ sender: {} })).resolves.toMatchObject({ imToken: 'im-token-two' })

    expect(shared.fetchCalls).toHaveLength(2)
    expect(shared.logoutCalls).toHaveLength(1)
    expect(shared.loginCalls).toHaveLength(2)
  })

  it('issues a new OpenIM token after an explicit SDK logout', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const shared = {
      sendCalls: [] as any[], loginCalls: [] as any[], fetchCalls: [] as any[],
      sessionProfiles: [
        { userID: 'self', imToken: 'im-token-one', expiresIn: 3600, apiAddr: 'https://im.test', wsAddr: 'wss://im.test' },
        { userID: 'self', imToken: 'im-token-two', expiresIn: 3600, apiAddr: 'https://im.test', wsAddr: 'wss://im.test' },
      ],
    }
    const built = fixture(root, shared)
    const createSession = built.handlers.get('openim:create-session')!
    const sdkCall = built.handlers.get('openim:sdk-call')!

    await createSession({ sender: {} })
    await sdkCall({ sender: {} }, 'logout')
    await expect(createSession({ sender: {} })).resolves.toMatchObject({ imToken: 'im-token-two' })

    expect(shared.fetchCalls).toHaveLength(2)
    expect(shared.loginCalls).toEqual([
      { userID: 'self', token: 'im-token-one' },
      { userID: 'self', token: 'im-token-two' },
    ])
  })

  it('recreates native SDK directories deleted while the Host is still running', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const built = fixture(root, { sendCalls: [] })
    const sdkDirectory = path.join(
      root, 'apps-data', 'moss.openim', 'instances', 'moss.openim--default', 'openim', 'sdk',
    )
    fs.rmSync(sdkDirectory, { recursive: true, force: true })

    await built.handlers.get('openim:create-session')!({ sender: {} })

    expect(fs.statSync(sdkDirectory).isDirectory()).toBe(true)
  })

  it('normalizes native SDK object rejections before they cross Electron IPC', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-openim-test-'))
    temporaryDirectories.push(root)
    const built = fixture(root, {
      sendCalls: [],
      loginError: { errCode: 10006, errMsg: 'unable to open database file' },
    })

    await expect(built.handlers.get('openim:create-session')!({ sender: {} }))
      .rejects.toThrow('unable to open database file')
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
