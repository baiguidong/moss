import { hostIpc as ipcMain } from './host/ipc.mjs';
/**
 * App IPC handlers and storage utilities
 *
 * This module contains all app-related business logic:
 * - App list/build/publish/version event handling
 * - MossTool event handler for agent runtime
 */

import electron from 'electron';

import fsp from 'node:fs/promises';
import * as path from 'node:path'
import * as fs from 'node:fs'
import os from 'node:os';
import {
  listAppsFromRegistry,
} from './app-platform.mjs'
import { MOSS_HOME } from './moss-home.mjs'

// ============================================================================
// Generic JSON file CRUD IPC
// ============================================================================

export function registerJsonFileIpc(name, filePath, options = {}) {
  const {
    idField = 'id',
    rootKey = null,
    idPrefix = '',
  } = options;

  const resolvedPath = filePath.startsWith('~/')
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;

  // Serialize read-modify-write mutations so concurrent IPC calls can't interleave
  // and clobber each other's writes (lost updates).
  let writeQueue = Promise.resolve();
  function withLock(fn) {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function readData() {
    try {
      const raw = await fsp.readFile(resolvedPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (rootKey) {
        return parsed[rootKey] || [];
      }
      return Array.isArray(parsed) ? parsed : (parsed.data || []);
    } catch {
      return [];
    }
  }

  async function writeData(data) {
    if (rootKey) {
      const existing = await readRawFile().catch(() => ({}));
      const obj = { ...existing, [rootKey]: data };
      await fsp.writeFile(resolvedPath, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
    } else {
      await fsp.writeFile(resolvedPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    }
  }

  async function readRawFile() {
    const raw = await fsp.readFile(resolvedPath, 'utf-8');
    return JSON.parse(raw);
  }

  ipcMain.handle(`${name}:list`, async () => {
    return await readData();
  });

  ipcMain.handle(`${name}:get`, async (_event, { id }) => {
    const data = await readData();
    return data.find(item => item[idField] === id) || null;
  });

  ipcMain.handle(`${name}:add`, async (_event, { item }) => withLock(async () => {
    const data = await readData();
    const newItem = {
      ...item,
      [idField]: item[idField] || `${idPrefix}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
    data.push(newItem);
    await writeData(data);
    return newItem;
  }));

  ipcMain.handle(`${name}:update`, async (_event, { id, updates }) => withLock(async () => {
    const data = await readData();
    const index = data.findIndex(item => item[idField] === id);
    if (index === -1) return null;
    data[index] = { ...data[index], ...updates };
    await writeData(data);
    return data[index];
  }));

  ipcMain.handle(`${name}:delete`, async (_event, { id }) => withLock(async () => {
    const data = await readData();
    const filtered = data.filter(item => item[idField] !== id);
    await writeData(filtered);
    return { ok: true };
  }));
}

export function listAllStoredApps() {
  const apps = listAppsFromRegistry()
  return apps.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

// ============================================================================
// MossTool Event Handler (for agent runtime)
// ============================================================================

/**
 * @typedef {Object} MossAppEvent
 * @property {string} type
 * @property {Object} input
 */
/** @type {MossAppEvent[]} */
const MossAppEventTypes = [
  'browser_open',
  'connector_cli_setup',
  'connector_mcp_authenticate',
  'image_generate',
  'image_edit',
]

export function buildConnectorMcpAuthToolResult(result) {
  const sourceAuth = result?.auth || result
  const auth = sourceAuth && typeof sourceAuth === 'object' && !Array.isArray(sourceAuth)
    ? Object.fromEntries(
      Object.entries(sourceAuth).filter(([key]) => key !== 'authorizationUrl'),
    )
    : sourceAuth
  const status = typeof sourceAuth?.status === 'string' ? sourceAuth.status : ''

  if (status === 'authenticated') {
    return {
      auth,
      message: sourceAuth?.connectorAttached
        ? '连接器授权已完成并已加入当前会话。当前会话将在本轮结束后刷新 MCP 工具；不要再次发起授权，请让用户在下一条消息继续原请求。'
        : '连接器授权已完成。当前会话将在本轮结束后刷新 MCP 工具；不要再次发起授权，请让用户在下一条消息继续原请求。',
    }
  }
  if (status === 'authorization_url_opened') {
    return {
      auth,
      message: '连接器授权页已打开，请等待用户完成授权；不要重复发起授权。',
    }
  }
  return {
    auth,
    message: '连接器 MCP 授权流程已处理。',
  }
}

/**
 * @typedef {Object} MossAppEventResult
 * @property {boolean} ok
 * @property {StoredApp} [app]
 * @property {string} [filePath]
 * @property {string[]} [filePaths]
 * @property {AppVersion[]} [versions]
 * @property {string} [error]
 */

export function createMossAppEventHandler(windows, events, options = {}) {
  const setupConnectorCli = typeof options.setupConnectorCli === 'function'
    ? options.setupConnectorCli
    : null
  const authenticateConnectorMcp = typeof options.authenticateConnectorMcp === 'function'
    ? options.authenticateConnectorMcp
    : null
  const attachConnectorToSession = typeof options.attachConnectorToSession === 'function'
    ? options.attachConnectorToSession
    : null

  return async (event, sessionRecord = null) => {
    try {
      switch (event.type) {
        case 'browser_open': {
          const directUrl = typeof event.input?.url === 'string'
            ? event.input.url.trim()
            : ''
          const query = typeof event.input?.query === 'string'
            ? event.input.query.trim()
            : ''
          if (!directUrl && !query) {
            throw new Error('browser_open requires url or query')
          }
          const engine = typeof event.input?.engine === 'string'
            ? event.input.engine
            : 'baidu'
          const encoded = encodeURIComponent(query)
          const url = directUrl || (engine === 'google'
            ? `https://www.google.com/search?q=${encoded}`
            : engine === 'bing'
              ? `https://www.bing.com/search?q=${encoded}`
              : `https://www.baidu.com/s?wd=${encoded}`)
          await windows.openBrowser?.({
            url,
            sessionId: sessionRecord?.id || null,
          })
          return { ok: true, previewUrl: url }
        }

        case 'connector_cli_setup': {
          const connectorId = typeof event.input?.connector_id === 'string'
            ? event.input.connector_id.trim()
            : ''
          if (!connectorId) {
            throw new Error('connector_cli_setup requires connector_id')
          }
          if (!setupConnectorCli) {
            throw new Error('Connector CLI setup is not available in this context')
          }
          const result = await setupConnectorCli(connectorId, {
            sessionId: sessionRecord?.id || null,
          })
          return {
            ok: true,
            ...result,
          }
        }

        case 'connector_mcp_authenticate': {
          const connectorId = typeof event.input?.connector_id === 'string'
            ? event.input.connector_id.trim()
            : ''
          const serverName = typeof event.input?.server_name === 'string'
            ? event.input.server_name.trim()
            : ''
          const target = serverName || connectorId
          if (!target) {
            throw new Error('connector_mcp_authenticate requires connector_id or server_name')
          }
          if (!authenticateConnectorMcp) {
            throw new Error('Connector MCP authentication is not available in this context')
          }
          let result = await authenticateConnectorMcp(target, {
            sessionId: sessionRecord?.id || null,
          })
          const authenticatedConnectorId = typeof result?.auth?.connectorId === 'string'
            ? result.auth.connectorId.trim()
            : ''
          if (
            result?.auth?.status === 'authenticated'
            && authenticatedConnectorId
            && sessionRecord?.id
            && attachConnectorToSession
          ) {
            await attachConnectorToSession(authenticatedConnectorId, {
              sessionId: sessionRecord.id,
            })
            result = {
              ...result,
              auth: {
                ...result.auth,
                connectorAttached: true,
              },
            }
          }
          const toolResult = buildConnectorMcpAuthToolResult(result)
          return {
            ok: true,
            ...toolResult,
          }
        }

        default:
          return { ok: false, error: `Unknown event type: ${event.type}` }
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }
}
