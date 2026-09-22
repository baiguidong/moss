import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_FILE_BYTES = 100 * 1024 * 1024
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
  if (!context?.dataDir) throw new Error('App data directory is unavailable')
  const root = path.resolve(context.dataDir, 'platform-files')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  return root
}

function inside(root, candidate) {
  const resolvedRoot = fs.realpathSync(root)
  const resolved = fs.realpathSync(path.resolve(String(candidate || '')))
  const relative = path.relative(resolvedRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('File is outside the App cache')
  return resolved
}

function mediaUrl(filePath) {
  return `moss-media://local/${encodeURIComponent(filePath)}`
}

function copyIntoCache(sourcePath, context, preferredName) {
  const source = fs.realpathSync(path.resolve(String(sourcePath || '')))
  const stat = fs.statSync(source)
  if (!stat.isFile()) throw new Error('Selected path is not a file')
  if (stat.size > MAX_FILE_BYTES) throw new Error('File cannot exceed 100 MB')
  const target = path.join(cacheRoot(context), `${randomUUID()}-${safeName(preferredName || path.basename(source))}`)
  fs.copyFileSync(source, target)
  return { name: safeName(preferredName || path.basename(source)), path: target, size: stat.size, mediaUrl: mediaUrl(target) }
}

export function createDesktopPlatformHandlers({
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
      const kind = String(input.kind || 'file')
      const response = await dialog.showOpenDialog({
        properties: ['openFile', ...(input.multiple === false ? [] : ['multiSelections'])],
        ...(FILE_FILTERS[kind] ? { filters: FILE_FILTERS[kind] } : {}),
      })
      if (response.canceled) return { files: [] }
      return { files: response.filePaths.map((filePath) => authorize(copyIntoCache(filePath, context))) }
    },

    'file.materialize'(input, context) {
      let buffer
      try { buffer = Buffer.from(input.dataBase64, 'base64') } catch { throw new Error('File data is invalid') }
      if (!buffer.length) throw new Error('File data cannot be empty')
      const name = safeName(input.fileName, `file-${Date.now()}`)
      const root = cacheRoot(context)
      const transferId = String(input.transferId || randomUUID())
      const transferPath = path.join(root, `${TRANSFER_FILE_PREFIX}${transferId}`)
      const offset = Number(input.offset || 0)
      const currentSize = fs.existsSync(transferPath) ? fs.statSync(transferPath).size : 0
      if (currentSize !== offset) throw new Error(`File transfer offset mismatch: expected ${currentSize}, received ${offset}`)
      if (currentSize + buffer.length > MAX_FILE_BYTES) {
        fs.rmSync(transferPath, { force: true })
        throw new Error('File cannot exceed 100 MB')
      }
      fs.appendFileSync(transferPath, buffer, { mode: 0o600 })
      const size = currentSize + buffer.length
      if (input.complete === false) return { transferId, complete: false, size }
      const target = path.join(root, `${randomUUID()}-${name}`)
      fs.renameSync(transferPath, target)
      return authorize({ name, path: target, size, mediaUrl: mediaUrl(target) })
    },

    async 'file.thumbnail'(input, context) {
      const root = cacheRoot(context)
      const source = inside(root, input.path)
      const target = path.join(root, `${randomUUID()}.png`)
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
      fs.writeFileSync(target, image.toPNG(), { mode: 0o600 })
      authorize({ path: target })
      return { path: target, mediaUrl: mediaUrl(target) }
    },

    async 'screen.capture'(_input, context) {
      const permission = process.platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('screen')
        : 'granted'
      if (permission === 'denied' || permission === 'restricted') {
        if (process.platform === 'darwin') {
          await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
        }
        throw new Error(permission === 'restricted'
          ? '系统限制了屏幕录制权限，请联系设备管理员'
          : '已打开屏幕录制权限设置，授权 Moss 后请重新截图')
      }
      const display = screen.getPrimaryDisplay()
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.min(4096, Math.max(1, Math.round(display.size.width * display.scaleFactor))),
          height: Math.min(4096, Math.max(1, Math.round(display.size.height * display.scaleFactor))),
        },
        fetchWindowIcons: false,
      })
      const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0]
      if (!source || source.thumbnail.isEmpty()) throw new Error('未找到可截图的显示器')
      const buffer = source.thumbnail.toPNG()
      const name = `screenshot-${Date.now()}.png`
      const target = path.join(cacheRoot(context), `${randomUUID()}-${name}`)
      fs.writeFileSync(target, buffer, { mode: 0o600 })
      return authorize({ name, path: target, size: buffer.length, mediaUrl: mediaUrl(target) })
    },

    async 'file.download'(input) {
      const selected = await dialog.showSaveDialog({ defaultPath: safeName(input.fileName, 'download') })
      if (selected.canceled || !selected.filePath) return { canceled: true }
      const response = await fetchImpl(input.url)
      if (!response.ok) throw new Error(`下载失败 (${response.status})`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > MAX_FILE_BYTES) throw new Error('Download cannot exceed 100 MB')
      fs.writeFileSync(selected.filePath, buffer)
      return { canceled: false, filePath: selected.filePath }
    },

    async 'shell.open-external'(input) {
      const url = new URL(input.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links are supported')
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
    && state.manifest?.permissions?.includes('desktop:media')
    && installation.grants?.includes('desktop:media')
  )
}
