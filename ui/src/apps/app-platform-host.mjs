import { platformLimits } from '../../../packages/host-contracts/src/index.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../../../packages/app-sdk/src/errors.mjs'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_FILE_BYTES = platformLimits.fileBytes
const TRANSFER_FILE_PREFIX = '.moss-transfer-'
const FILE_FILTERS = {
  image: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'] }],
  video: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
  audio: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'amr'] }],
}

function safeName(value, fallback = 'file') {
  return path.basename(String(value || fallback))
    .replaceAll(/[^\p{L}\p{N}._ -]/gu, '_')
    .slice(0, 240) || fallback
}

function cacheRoot(context) {
  if (!context?.dataDir) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App data directory is unavailable')
  const root = path.resolve(context.dataDir, 'platform-files')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  return root
}

function inside(root, candidate) {
  const resolvedRoot = fs.realpathSync(root)
  const resolved = fs.realpathSync(path.resolve(String(candidate || '')))
  const relative = path.relative(resolvedRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'File is outside the App cache')
  return resolved
}

function mediaUrl(filePath) {
  return `moss-media://local/${encodeURIComponent(filePath)}`
}

function copyIntoCache(sourcePath, context, preferredName) {
  const source = fs.realpathSync(path.resolve(String(sourcePath || '')))
  const stat = fs.statSync(source)
  if (!stat.isFile()) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Selected path is not a file')
  if (stat.size > MAX_FILE_BYTES) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'File cannot exceed 100 MB')
  const cachedPath = path.join(cacheRoot(context), `${randomUUID()}-${safeName(preferredName || path.basename(source))}`)
  fs.copyFileSync(source, cachedPath)
  return { name: safeName(preferredName || path.basename(source)), path: cachedPath, size: stat.size, mediaUrl: mediaUrl(cachedPath) }
}

export function createAppPlatformHandlers({
  desktopCapturer,
  dialog,
  nativeImage,
  screen,
  shell,
  systemPreferences,
  allowMediaFile = () => {},
  fetchImpl = fetch,
}) {
  const authorize = (file) => {
    allowMediaFile(file.path)
    return file
  }
  return {
    async 'file.pick'(input, context) {
      context?.assertCurrent?.()
      context?.signal?.throwIfAborted()
      const kind = String(input.kind || 'file')
      const response = await dialog.showOpenDialog({
        properties: ['openFile', ...(input.multiple === false ? [] : ['multiSelections'])],
        ...(FILE_FILTERS[kind] ? { filters: FILE_FILTERS[kind] } : {}),
      })
      context?.assertCurrent?.()
      context?.signal?.throwIfAborted()
      if (response.canceled) return { files: [] }
      if (response.filePaths.length > platformLimits.pickedFiles) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Too many selected files')
      return { files: response.filePaths.map((filePath) => authorize(copyIntoCache(filePath, context))) }
    },

    'file.materialize'(input, context) {
      context?.assertCurrent?.()
      context?.signal?.throwIfAborted()
      let buffer
      try { buffer = Buffer.from(input.dataBase64, 'base64') } catch { throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'File data is invalid') }
      if (!buffer.length) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'File data cannot be empty')
      const name = safeName(input.fileName, `file-${Date.now()}`)
      const root = cacheRoot(context)
      const transferId = String(input.transferId || randomUUID())
      const transferPath = path.join(root, `${TRANSFER_FILE_PREFIX}${transferId}`)
      const offset = Number(input.offset || 0)
      const currentSize = fs.existsSync(transferPath) ? fs.statSync(transferPath).size : 0
      if (currentSize !== offset) throw new AppServiceError(APP_ERROR_CODES.conflict, `File transfer offset mismatch: expected ${currentSize}, received ${offset}`)
      if (currentSize + buffer.length > MAX_FILE_BYTES) {
        fs.rmSync(transferPath, { force: true })
        throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'File cannot exceed 100 MB')
      }
      fs.appendFileSync(transferPath, buffer, { mode: 0o600 })
      const size = currentSize + buffer.length
      if (input.complete === false) return { transferId, complete: false, size }
      const cachedPath = path.join(root, `${randomUUID()}-${name}`)
      fs.renameSync(transferPath, cachedPath)
      return authorize({ name, path: cachedPath, size, mediaUrl: mediaUrl(cachedPath) })
    },

    async 'file.thumbnail'(input, context) {
      context?.assertCurrent?.()
      context?.signal?.throwIfAborted()
      const root = cacheRoot(context)
      const source = inside(root, input.path)
      const cachedPath = path.join(root, `${randomUUID()}.png`)
      let image
      try {
        image = await nativeImage.createThumbnailFromPath(source, {
          width: input.width || 640,
          height: input.height || 360,
        })
      } catch {
        image = nativeImage.createFromDataURL(
          'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#171717"/><path d="M270 105l130 75-130 75z" fill="#fff"/></svg>',
          ),
        )
      }
      context?.assertCurrent?.()
      context?.signal?.throwIfAborted()
      fs.writeFileSync(cachedPath, image.toPNG(), { mode: 0o600 })
      authorize({ path: cachedPath })
      return { path: cachedPath, mediaUrl: mediaUrl(cachedPath) }
    },

    async 'screen.capture'(_input, context) {
      context?.assertCurrent?.()
      context?.signal?.throwIfAborted()
      const permission = process.platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('screen')
        : 'granted'
      if (permission === 'denied' || permission === 'restricted') {
        if (process.platform === 'darwin') {
          await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
        }
        throw new AppServiceError(APP_ERROR_CODES.permissionDenied, permission === 'restricted'
          ? '系统限制了屏幕录制权限，请联系设备管理员'
          : '已打开屏幕录制权限设置，授权 Moss 后请重新截图')
      }
      const display = screen.getPrimaryDisplay()
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.min(platformLimits.imageDimension, Math.max(1, Math.round(display.size.width * display.scaleFactor))),
          height: Math.min(platformLimits.imageDimension, Math.max(1, Math.round(display.size.height * display.scaleFactor))),
        },
        fetchWindowIcons: false,
      })
      const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0]
      context?.assertCurrent?.()
      context?.signal?.throwIfAborted()
      if (!source || source.thumbnail.isEmpty()) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, '未找到可截图的显示器')
      const buffer = source.thumbnail.toPNG()
      const name = `screenshot-${Date.now()}.png`
      const cachedPath = path.join(cacheRoot(context), `${randomUUID()}-${name}`)
      fs.writeFileSync(cachedPath, buffer, { mode: 0o600 })
      return authorize({ name, path: cachedPath, size: buffer.length, mediaUrl: mediaUrl(cachedPath) })
    },

    async 'file.download'(input, context = {}) {
      const { signal } = context
      signal?.throwIfAborted()
      const selected = await dialog.showSaveDialog({ defaultPath: safeName(input.fileName, 'download') })
      signal?.throwIfAborted()
      if (selected.canceled || !selected.filePath) return { canceled: true }
      const response = await fetchImpl(input.url, { signal })
      let temporaryDir
      let file
      const reader = response.body?.getReader()
      // A body may fail before the first read (for example while opening the file).
      reader?.closed.catch(() => {})
      const cancelBody = () => { void reader?.cancel(signal?.reason).catch(() => {}) }
      signal?.addEventListener('abort', cancelBody, { once: true })
      try {
        signal?.throwIfAborted()
        if (!response.ok) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, `下载失败 (${response.status})`)
        if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) {
          throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Download cannot exceed 100 MB')
        }
        // The temporary file shares the destination filesystem so commit is atomic.
        temporaryDir = fs.mkdtempSync(path.join(path.dirname(selected.filePath), '.moss-download-'))
        const temporaryFile = path.join(temporaryDir, 'download')
        file = await fsp.open(temporaryFile, 'wx', 0o600)
        let size = 0
        while (reader) {
          signal?.throwIfAborted()
          const { done, value } = await reader.read()
          signal?.throwIfAborted()
          if (done) break
          size += value.byteLength
          if (size > MAX_FILE_BYTES) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Download cannot exceed 100 MB')
          await file.writeFile(value)
        }
        await file.close()
        file = null
        context.assertCurrent?.()
        signal?.throwIfAborted()
        fs.renameSync(temporaryFile, selected.filePath)
        return { canceled: false, filePath: selected.filePath }
      } finally {
        signal?.removeEventListener('abort', cancelBody)
        await reader?.cancel().catch(() => {})
        reader?.releaseLock()
        try {
          await file?.close()
        } finally {
          if (temporaryDir) fs.rmSync(temporaryDir, { recursive: true, force: true })
        }
      }
    },

    async 'shell.open-external'(input, context = {}) {
      context.signal?.throwIfAborted()
      const url = new URL(input.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Only HTTP and HTTPS links are supported')
      await shell.openExternal(url.href)
      return { opened: true }
    },
  }
}

export function isAllowedAppMediaPermission({ state, runtime, permission, mediaTypes } = {}) {
  if (permission !== 'media' || !state?.id || state.runtime !== runtime || state.source?.mode === 'preview') return false
  const requested = Array.isArray(mediaTypes) ? mediaTypes : []
  if (requested.some((type) => !['audio', 'video'].includes(type))) return false
  const installation = runtime?.installations?.get?.(state.id)
  const hasEnabledInstance = runtime?.instances?.list?.(state.id)
    ?.some((instance) => instance.enabled === true) === true
  return Boolean(
    installation?.enabled
    && hasEnabledInstance
    && state.manifest?.permissions?.includes('platform:media')
    && installation.grants?.includes('platform:media')
  )
}
