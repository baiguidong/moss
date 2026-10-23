import { contractDefinition } from '../../../packages/app-sdk/src/host/contracts.mjs'
import { AppServiceError, APP_ERROR_CODES } from '../../../packages/app-sdk/src/errors.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { openAppFilePreview } from './app-file-preview.mjs'

export const LOCAL_FILES_PROTOCOL = 'moss.local-files/v1'
export const RUNTIMES_PROTOCOL = 'moss.runtimes/v1'

export function createLocalFilesProtocolDefinition() { return contractDefinition(LOCAL_FILES_PROTOCOL) }
export function createRuntimesProtocolDefinition() { return contractDefinition(RUNTIMES_PROTOCOL) }
async function appFile(input, context) {
  if (!context?.dataDir) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App data directory is unavailable')
  let root, file
  try {
  root = await fs.realpath(context.dataDir)
  file = await fs.realpath(input.path)
  } catch (error) { throw new AppServiceError(error.code === 'ENOENT' ? APP_ERROR_CODES.notFound : APP_ERROR_CODES.hostUnavailable, 'App file is unavailable') }
  const relative = path.relative(root, file)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'File is outside the App data directory')
  if (!(await fs.stat(file)).isFile()) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Expected a file')
  return file
}
export function createLocalAppHostHandlers({ dialog, shell, BrowserWindow, getManagedRuntimeStatus, ensurePython, preview }) {
  return {
    [RUNTIMES_PROTOCOL]: {
      'python.get': async () => {
        await ensurePython?.()
        const python = getManagedRuntimeStatus().python
        return { available: python.installed === true, path: python.installed ? python.path : null, version: python.version || null }
      },
    },
    [LOCAL_FILES_PROTOCOL]: {
      async preview(input, context) {
        const file = await appFile(input, context)
        if (!/\.html?$/i.test(file)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Preview requires an HTML file')
        context.assertCurrent?.()
        context.signal?.throwIfAborted()
        await (preview ? preview(file) : openAppFilePreview(BrowserWindow, file))
        return { opened: true }
      },
      async pick(input, context) {
        context?.assertCurrent?.()
        context?.signal?.throwIfAborted()
        const result = await dialog.showOpenDialog({ ...(dialog.web ? { title: `${context?.appId || 'App'} 请求选择${input.kind === 'directory' ? '云电脑目录' : '文件'}`, signal: context?.signal } : {}), properties: [input.kind === 'directory' ? 'openDirectory' : 'openFile', ...(input.multiple === false ? [] : ['multiSelections'])] })
        context?.assertCurrent?.()
        context?.signal?.throwIfAborted()
        if (result.filePaths.length > 100) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Too many selected paths')
        return { paths: result.canceled ? [] : result.filePaths }
      },
      async open(input, context) {
        const file = await appFile(input, context)
        context.assertCurrent?.()
        context.signal?.throwIfAborted()
        const error = await shell.openPath(file)
        if (error) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, error)
        return { opened: true }
      },
      async reveal(input, context) {
        const file = await appFile(input, context)
        context.assertCurrent?.()
        context.signal?.throwIfAborted()
        const revealed = await shell.showItemInFolder(file)
        if (dialog.web && !revealed) throw new AppServiceError(APP_ERROR_CODES.actionCanceled, '查看文件已取消')
        return { revealed: true }
      },
    },
  }
}
