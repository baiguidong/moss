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
  buildPluginAppFromWorkspace,
  extractPluginAppToWorkspace,
  getPluginAppWorkspaceBuildDir,
  listPluginAppsFromRegistry,
  listPluginAppVersions,
  publishPluginAppFromBuild,
  readPluginAppManifestFromDir,
} from './app-platform.mjs'

// ============================================================================
// Image generation by provider
// ============================================================================

async function generateImageWithProvider({
  provider,
  prompt,
  aspect_ratio,
  subject_reference,
  sourcePath,
  operation = 'generate',
  apiKey,
  url,
  model,
}) {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : 'minimax'
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : ''
  const normalizedUrl = typeof url === 'string' ? url.trim() : ''
  const normalizedModel = typeof model === 'string' ? model.trim() : ''

  if (normalizedProvider === 'minimax') {
    if (operation !== 'generate') {
      throw new Error('MiniMax image editing is not supported by the Moss image handler yet')
    }
    return generateMinimaxImage({ prompt, aspect_ratio, subject_reference, apiKey: normalizedApiKey, url: normalizedUrl, model: normalizedModel })
  }

  if (normalizedProvider === 'openai') {
    if (Array.isArray(subject_reference) && subject_reference.length > 0) {
      throw new Error('OpenAI image generation does not support subject_reference; use image_edit with source_path for image-guided edits')
    }
    return generateOpenAIImage({
      prompt,
      aspect_ratio,
      sourcePath,
      operation,
      apiKey: normalizedApiKey,
      url: normalizedUrl,
      model: normalizedModel,
    })
  }

  throw new Error(`Unsupported image provider: ${provider}`)
}

function openAIImageSizeFromAspectRatio(aspectRatio) {
  switch (aspectRatio) {
    case '16:9':
    case '4:3':
    case '3:2':
    case '21:9':
      return '1536x1024'
    case '9:16':
    case '3:4':
    case '2:3':
      return '1024x1536'
    case '1:1':
    default:
      return '1024x1024'
  }
}

function openAIImageEndpoint(url, operation) {
  const segment = operation === 'edit' ? 'edits' : 'generations'
  const oppositeSegment = operation === 'edit' ? 'generations' : 'edits'
  const base = (url || 'https://api.openai.com/v1').replace(/\/+$/, '')
  if (base.endsWith(`/images/${segment}`)) return base
  if (base.endsWith(`/images/${oppositeSegment}`)) {
    return `${base.slice(0, -oppositeSegment.length)}${segment}`
  }
  if (base.endsWith('/images')) return `${base}/${segment}`
  return `${base}/images/${segment}`
}

async function extractOpenAIImageBase64(payload) {
  if (payload?.error) {
    const message =
      typeof payload.error.message === 'string'
        ? payload.error.message
        : JSON.stringify(payload.error)
    throw new Error(`OpenAI image request failed: ${message}`)
  }

  const data = Array.isArray(payload?.data) ? payload.data : []
  const images = []
  for (const item of data) {
    if (typeof item?.b64_json === 'string' && item.b64_json) {
      images.push(item.b64_json)
      continue
    }
    if (typeof item?.url === 'string' && item.url) {
      const response = await fetch(item.url)
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`OpenAI image download failed: ${response.status} ${detail}`)
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      images.push(bytes.toString('base64'))
    }
  }

  if (images.length === 0) {
    throw new Error('OpenAI image request returned no images')
  }

  return images
}

async function generateOpenAIImage({ prompt, aspect_ratio, sourcePath, operation, apiKey, url, model }) {
  if (!model) {
    throw new Error('Image model is not configured in desktop settings (image.model)')
  }
  if (!apiKey) {
    throw new Error('Image API key is not configured in desktop settings (image.apiKey)')
  }

  const size = openAIImageSizeFromAspectRatio(aspect_ratio || '1:1')
  const endpoint = openAIImageEndpoint(url, operation)
  let response

  if (operation === 'edit') {
    if (!sourcePath) {
      throw new Error('sourcePath is required for OpenAI image editing')
    }
    const sourceBytes = await fsp.readFile(sourcePath)
    const sourceExt = path.extname(sourcePath).toLowerCase()
    const sourceMime =
      sourceExt === '.jpg' || sourceExt === '.jpeg'
        ? 'image/jpeg'
        : sourceExt === '.webp'
          ? 'image/webp'
          : 'image/png'
    const form = new FormData()
    form.append('image', new Blob([sourceBytes], { type: sourceMime }), path.basename(sourcePath))
    form.append('prompt', prompt)
    form.append('model', model)
    form.append('n', '1')
    form.append('size', size)

    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    })
  } else {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
      }),
    })
  }

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`OpenAI image request failed: ${response.status} ${detail}`)
  }

  return extractOpenAIImageBase64(await response.json())
}

async function generateMinimaxImage({ prompt, aspect_ratio, subject_reference, apiKey, url, model }) {
  if (!model) {
    throw new Error('Image model is not configured in desktop settings (image.model)')
  }
  if (!apiKey) {
    throw new Error('Image API key is not configured in desktop settings (image.apiKey)')
  }
  if (!url) {
    throw new Error('Image URL is not configured in desktop settings (image.url)')
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      aspect_ratio: aspect_ratio || '1:1',
      subject_reference,
      response_format: 'base64',
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Image generation failed: ${response.status} ${detail}`)
  }

  const payload = await response.json()
  const images = Array.isArray(payload?.data?.image_base64)
    ? payload.data.image_base64
    : []
  if (images.length === 0) {
    throw new Error('Image generation returned no images')
  }

  return images
}

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

const MOSS_HOME = path.join(os.homedir(), '.moss')
export function listAllStoredApps() {
  const pluginApps = listPluginAppsFromRegistry()
  return pluginApps.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
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
      message: '连接器授权已完成。当前会话将在本轮结束后刷新 MCP 工具；不要再次发起授权，请让用户在下一条消息继续原请求。',
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
  const getSettings = typeof options.getSettings === 'function'
    ? options.getSettings
    : () => ({})
  const allowMediaRoot = typeof options.allowMediaRoot === 'function'
    ? options.allowMediaRoot
    : () => {}
  const setupConnectorCli = typeof options.setupConnectorCli === 'function'
    ? options.setupConnectorCli
    : null
  const authenticateConnectorMcp = typeof options.authenticateConnectorMcp === 'function'
    ? options.authenticateConnectorMcp
    : null

  const requireWorkspaceBuildDir = (sessionRecord, input = {}) => {
    if (!sessionRecord?.workspace) {
      throw new Error('Session workspace is required for App build directory access')
    }
    const buildDir = input.buildDir
      ? path.resolve(sessionRecord.workspace, input.buildDir)
      : getPluginAppWorkspaceBuildDir(sessionRecord.workspace, input.name)
    const relativePath = path.relative(sessionRecord.workspace, buildDir)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('App buildDir must stay inside the current session workspace')
    }
    return buildDir
  }

  const slugifyPluginAppId = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  const requireBuildManifestForName = (buildDir, name) => {
    const manifest = readPluginAppManifestFromDir(buildDir)
    const requestedId = slugifyPluginAppId(name)
    if (requestedId && manifest.id !== requestedId) {
      throw new Error(`App build id "${manifest.id}" does not match requested name "${name}"`)
    }
    return manifest
  }

  const findRegisteredPluginApp = (name) => {
    const normalizedName = String(name || '').trim()
    const normalizedId = slugifyPluginAppId(normalizedName)
    return listPluginAppsFromRegistry().find(entry =>
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
          return await buildPluginAppFromWorkspace(sessionRecord.workspace, event.input.name)
        }

        case 'app_preview': {
          const buildDir = requireWorkspaceBuildDir(sessionRecord, event.input)
          readPluginAppManifestFromDir(buildDir)
          windows.previewPluginAppBuild(buildDir)
          return { ok: true, buildDir }
        }

        case 'app_publish': {
          const buildDir = requireWorkspaceBuildDir(sessionRecord, event.input)
          requireBuildManifestForName(buildDir, event.input.name)
          const app = await publishPluginAppFromBuild(buildDir, {
            description: event.input.description,
            reason: event.input.reason,
          })
          events.emitAppsChanged({ action: 'created', app })
          return { ok: true, app }
        }

        case 'app_launch': {
          const app = findRegisteredPluginApp(event.input.name)
          if (!app) throw new Error(`Unknown App: ${event.input.name}`)
          windows.launchPluginApp?.(app.id)
          return { ok: true, app }
        }

        case 'app_update': {
          const buildDir = requireWorkspaceBuildDir(sessionRecord, event.input)
          requireBuildManifestForName(buildDir, event.input.name)
          const app = await publishPluginAppFromBuild(buildDir, {
            description: event.input.description,
            reason: event.input.reason || 'updated',
          })
          events.emitAppsChanged({ action: 'updated', app })
          return { ok: true, app }
        }

        case 'app_extract_to_workspace': {
          if (!sessionRecord) {
            throw new Error('Session context is required for app_extract_to_workspace')
          }
          const app = findRegisteredPluginApp(event.input.name)
          if (!app) throw new Error(`Unknown App: ${event.input.name}`)
          const extracted = await extractPluginAppToWorkspace(app.id, sessionRecord, event.input.versionId)
          return {
            ok: true,
            app: extracted.app,
            metadataPath: extracted.metadataPath,
            htmlPath: extracted.htmlPath,
          }
        }

        case 'app_get_versions': {
          const app = findRegisteredPluginApp(event.input.name)
          return { ok: true, versions: app ? listPluginAppVersions(app.id) : [] }
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
          windows.openBrowser?.({
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
          const result = await authenticateConnectorMcp(target, {
            sessionId: sessionRecord?.id || null,
          })
          const toolResult = buildConnectorMcpAuthToolResult(result)
          return {
            ok: true,
            ...toolResult,
          }
        }

        case 'image_generate':
        case 'image_edit': {
          const { prompt, aspect_ratio, subject_reference, source_path, out_path } =
            event.input || {}

          if (!prompt || typeof prompt !== 'string') {
            throw new Error(`${event.type} requires a prompt string`)
          }
          if (!sessionRecord?.workspace) {
            throw new Error(`Session context is required for ${event.type}`)
          }
          if (sessionRecord.agentMode === 'remote-direct') {
            throw new Error('Remote Direct mode does not support writing generated images to the remote workspace yet.')
          }
          if (!out_path || typeof out_path !== 'string') {
            throw new Error(`${event.type} requires out_path`)
          }
          if (
            event.type === 'image_edit' &&
            (!source_path || typeof source_path !== 'string')
          ) {
            throw new Error('image_edit requires source_path')
          }

          const resolveWorkspaceFile = (inputPath, label) => {
            const resolvedPath = path.resolve(sessionRecord.workspace, inputPath)
            const relativePath = path.relative(sessionRecord.workspace, resolvedPath)
            if (
              relativePath.startsWith('..') ||
              path.isAbsolute(relativePath)
            ) {
              throw new Error(
                `${event.type} ${label} must stay inside the current session workspace`,
              )
            }
            return resolvedPath
          }

          const resolvedOutputPath = resolveWorkspaceFile(out_path, 'out_path')
          const resolvedSourcePath =
            event.type === 'image_edit'
              ? resolveWorkspaceFile(source_path, 'source_path')
              : ''
          if (event.type === 'image_edit' && !fs.existsSync(resolvedSourcePath)) {
            throw new Error(`image_edit source_path does not exist: ${source_path}`)
          }

          const settings = getSettings() || {}
          const imageSettings =
            settings.image && typeof settings.image === 'object'
              ? settings.image
              : {}

          const imageProvider =
            typeof imageSettings.provider === 'string'
              ? imageSettings.provider.trim()
              : 'minimax'

          const images = await generateImageWithProvider({
            provider: imageProvider,
            prompt,
            aspect_ratio,
            subject_reference,
            sourcePath: resolvedSourcePath,
            operation: event.type === 'image_edit' ? 'edit' : 'generate',
            apiKey: imageSettings.apiKey,
            url: imageSettings.url,
            model: imageSettings.model,
          })

          allowMediaRoot(sessionRecord.workspace)
          await fsp.mkdir(path.dirname(resolvedOutputPath), { recursive: true })

          const parsedPath = path.parse(resolvedOutputPath)
          const ext = parsedPath.ext || '.jpeg'
          const basePath = path.join(parsedPath.dir, parsedPath.name)
          const filePaths = []

          const mimeMap = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp',
            '.svg': 'image/svg+xml',
            '.avif': 'image/avif',
            '.tif': 'image/tiff',
            '.tiff': 'image/tiff',
          }

          for (let i = 0; i < images.length; i += 1) {
            const filePath =
              images.length === 1
                ? resolvedOutputPath
                : `${basePath}-${i}${ext}`
            await fsp.writeFile(filePath, Buffer.from(images[i], 'base64'))
            filePaths.push(filePath)
          }

          const firstPath = filePaths[0]
          const previewUrl = `moss-media://local/${encodeURIComponent(firstPath)}`
          const previewMarkdown = `![${event.type === 'image_edit' ? 'edited' : 'generated'} image](${previewUrl})`
          const mediaType =
            mimeMap[path.extname(firstPath).toLowerCase()] || 'image/jpeg'

          return {
            ok: true,
            fileKind: 'image',
            filePath: firstPath,
            filePaths,
            previewUrl,
            previewMarkdown,
            mediaType,
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

// Export for type checking
export const emitAppsChanged = () => {}

// Placeholder for backward compatibility - actual emitAppsChanged is in main.mjs
export function noop() {}
