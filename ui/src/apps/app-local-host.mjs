import fs from 'node:fs/promises'
import path from 'node:path'

export const LOCAL_FILES_PROTOCOL = 'moss.local-files/v1'
export const RUNTIMES_PROTOCOL = 'moss.runtimes/v1'

function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown field: ${key}`)
  return value
}
function fileInput(value) {
  record(value, ['path'])
  if (typeof value.path !== 'string' || !path.isAbsolute(value.path) || value.path.includes('\0')) throw new Error('An absolute file path is required')
  return value
}
export function createLocalFilesProtocolDefinition() {
  return { protocol: LOCAL_FILES_PROTOCOL, methods: {
    pick: { permission: 'local-files:pick', validateInput(value) {
      record(value, ['kind', 'multiple'])
      if (value.kind !== undefined && !['file', 'directory'].includes(value.kind)) throw new Error('Invalid picker kind')
      if (value.multiple !== undefined && typeof value.multiple !== 'boolean') throw new Error('Invalid multiple flag')
      return value
    } },
    open: { permission: 'local-files:open', validateInput: fileInput },
    reveal: { permission: 'local-files:open', validateInput: fileInput },
  } }
}
export function createRuntimesProtocolDefinition() {
  return { protocol: RUNTIMES_PROTOCOL, methods: {
    'python.get': { validateInput: value => record(value, []) },
  } }
}
async function appFile(input, context) {
  if (!context?.dataDir) throw new Error('App data directory is unavailable')
  const root = await fs.realpath(context.dataDir)
  const file = await fs.realpath(input.path)
  const relative = path.relative(root, file)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('File is outside the App data directory')
  if (!(await fs.stat(file)).isFile()) throw new Error('Expected a file')
  return file
}
export function createLocalAppHostHandlers({ dialog, shell, getManagedRuntimeStatus }) {
  return {
    [RUNTIMES_PROTOCOL]: {
      'python.get': () => {
        const python = getManagedRuntimeStatus().python
        return { available: python.installed === true, path: python.installed ? python.path : null, version: python.version || null }
      },
    },
    [LOCAL_FILES_PROTOCOL]: {
      async pick(input) {
        const result = await dialog.showOpenDialog({ properties: [input.kind === 'directory' ? 'openDirectory' : 'openFile', ...(input.multiple === false ? [] : ['multiSelections'])] })
        return { paths: result.canceled ? [] : result.filePaths }
      },
      async open(input, context) {
        const error = await shell.openPath(await appFile(input, context))
        if (error) throw new Error(error)
        return { opened: true }
      },
      async reveal(input, context) {
        shell.showItemInFolder(await appFile(input, context))
        return { revealed: true }
      },
    },
  }
}
