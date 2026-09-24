/**
 * App IPC handlers and storage utilities
 *
 * This module contains all app-related business logic:
 * - App list/build/publish/version event handling
 * - MossTool event handler for agent runtime
 */

import electron from 'electron';
const { ipcMain } = electron;
import fsp from 'node:fs/promises';
import * as path from 'node:path'
import * as fs from 'node:fs'
import os from 'node:os';
import {
  buildAppFromWorkspace,
  extractAppToWorkspace,
  getAppWorkspaceBuildDir,
  listAppsFromRegistry,
  listAppVersions,
  publishAppFromBuild,
  readAppManifestFromDir,
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
 * @property {'app_build'} type
 * @property {Object} input
 */
/** @type {MossAppEvent[]} */
const MossAppEventTypes = [
  'app_build',
  'app_preview',
  'app_publish',
  'app_launch',
  'app_update',
  'app_extract_to_workspace',
  'app_get_versions',
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

  const requireWorkspaceBuildDir = (sessionRecord, input = {}) => {
    if (!sessionRecord?.workspace) {
      throw new Error('Session workspace is required for App build directory access')
    }
    const buildDir = input.buildDir
      ? path.resolve(sessionRecord.workspace, input.buildDir)
      : getAppWorkspaceBuildDir(sessionRecord.workspace, input.name)
    const relativePath = path.relative(sessionRecord.workspace, buildDir)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('App buildDir must stay inside the current session workspace')
    }
    return buildDir
  }

  const slugifyAppId = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  const requireBuildManifestForName = (buildDir, name) => {
    const manifest = readAppManifestFromDir(buildDir)
    const requestedId = slugifyAppId(name)
    if (requestedId && manifest.id !== requestedId) {
      throw new Error(`App build id "${manifest.id}" does not match requested name "${name}"`)
    }
    return manifest
  }

  const findRegisteredApp = (name) => {
    const normalizedName = String(name || '').trim()
    const normalizedId = slugifyAppId(normalizedName)
    return listAppsFromRegistry().find(entry =>
      entry.name === normalizedName ||
      entry.id === normalizedName ||
      entry.id === normalizedId
    )
  }

  return async (event, sessionRecord = null) => {
    try {
      switch (event.type) {
        case 'app_build': {
          if (!sessionRecord?.workspace) {
            throw new Error('Session workspace is required for App build')
          }
          return await buildAppFromWorkspace(sessionRecord.workspace, event.input.name)
        }

        case 'app_preview': {
          const buildDir = requireWorkspaceBuildDir(sessionRecord, event.input)
          readAppManifestFromDir(buildDir)
          await windows.previewAppBuild(buildDir)
          return { ok: true, buildDir }
        }

        case 'app_publish': {
          const buildDir = requireWorkspaceBuildDir(sessionRecord, event.input)
          requireBuildManifestForName(buildDir, event.input.name)
          const app = await publishAppFromBuild(buildDir, {
            description: event.input.description,
            reason: event.input.reason,
          })
          await events.emitAppsChanged({ action: 'created', app })
          return { ok: true, app }
        }

        case 'app_launch': {
          const app = findRegisteredApp(event.input.name)
          if (!app) throw new Error(`Unknown App: ${event.input.name}`)
          windows.launchApp?.(app.id)
          return { ok: true, app }
        }

        case 'app_update': {
          const buildDir = requireWorkspaceBuildDir(sessionRecord, event.input)
          requireBuildManifestForName(buildDir, event.input.name)
          const app = await publishAppFromBuild(buildDir, {
            description: event.input.description,
            reason: event.input.reason || 'updated',
          })
          await events.emitAppsChanged({ action: 'updated', app })
          return { ok: true, app }
        }

        case 'app_extract_to_workspace': {
          if (!sessionRecord) {
            throw new Error('Session context is required for app_extract_to_workspace')
          }
          const app = findRegisteredApp(event.input.name)
          if (!app) throw new Error(`Unknown App: ${event.input.name}`)
          const extracted = await extractAppToWorkspace(app.id, sessionRecord, event.input.versionId)
          return {
            ok: true,
            app: extracted.app,
            metadataPath: extracted.metadataPath,
            htmlPath: extracted.htmlPath,
          }
        }

        case 'app_get_versions': {
          const app = findRegisteredApp(event.input.name)
          return { ok: true, versions: app ? listAppVersions(app.id) : [] }
        }

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
