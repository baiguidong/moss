import { text, count, boolean, string, nullable, array, record, method } from './shared.mjs'
export const platformLimits = Object.freeze({ fileBytes: 100 * 1024 * 1024, inlineBase64Length: 512 * 1024, pickedFiles: 100, imageDimension: 4096 })
const file = record({ name: text(300), path: text(), size: { ...count, maximum: platformLimits.fileBytes }, mediaUrl: text(16384) })
const http = { ...text(), pattern: '^https?://[^\\s/]+(?:[/?#][^\\s]*)?$' }
const absolutePath = { ...text(), pattern: '^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)' }
const dimension = { type: 'integer', minimum: 1, maximum: platformLimits.imageDimension }
const empty = record({})
export const localTypes = { PlatformFile: file }
export const localContracts = {
  'moss.local-files/v1': { types: 'LocalFiles', methods: {
    pick: method('local-files:pick', record({ kind: { enum: ['file', 'directory'] }, multiple: boolean }, []), record({ paths: array(text(), 100) })),
    open: method('local-files:open', record({ path: absolutePath }), record({ opened: { const: true } })),
    preview: method('local-files:open', record({ path: absolutePath }), record({ opened: { const: true } })),
    reveal: method('local-files:open', record({ path: absolutePath }), record({ revealed: { const: true } })),
  }, events: {} },
  'moss.runtimes/v1': { types: 'Runtimes', methods: {
    'python.get': method(null, empty, record({ available: boolean, path: nullable(text()), version: nullable(string) })),
  }, events: {} },
  'moss.platform/v1': { types: 'Platform', methods: {
    'file.pick': method('platform:files', record({ kind: { enum: ['image','video','audio','file'] }, multiple: boolean }, []), record({ files: array(file, platformLimits.pickedFiles) }), { limits: platformLimits }),
    'file.materialize': method('platform:files', record({ fileName: text(300), dataBase64: { ...text(platformLimits.inlineBase64Length), pattern: '^[A-Za-z0-9+/]+={0,2}$' }, transferId: { ...text(128), pattern: '^[a-zA-Z0-9_-]+$' }, offset: { ...count, maximum: platformLimits.fileBytes }, complete: boolean }, ['fileName','dataBase64']), { anyOf: [file, record({ transferId: text(128), complete: { const: false }, size: { ...count, maximum: platformLimits.fileBytes } })] }, { limits: platformLimits, offsetUnit: 'byte' }),
    'file.thumbnail': method('platform:files', record({ path: text(), width: dimension, height: dimension }, ['path']), record({ path: text(), mediaUrl: text(16384) })),
    'file.download': method('platform:files', record({ url: http, fileName: text(300) }), { anyOf: [record({ canceled: { const: true } }), record({ canceled: { const: false }, filePath: text() })] }, { limits: { fileBytes: platformLimits.fileBytes } }),
    'screen.capture': method('platform:screen-capture', empty, file),
    'shell.open-external': method('platform:external-links', record({ url: http }), record({ opened: { const: true } })),
  }, events: {} },
  'moss.session-source/v1': { types: 'SessionSource', methods: {
    'session.list': method('session-source:read', empty, record({ sessions: array(record({ id: text(4000), revision: text(1024), updatedAt: count, historyLength: count, busy: boolean }), 10000) })),
    'session.export': method('session-source:read', record({ sessionId: text(4000) }), record({ sessionId: text(4000), revision: text(1024), fileName: text(100) })),
    'session.open': method('session-source:open', record({ sessionId: text(4000), toolUseId: text(4000) }, ['sessionId']), record({ opened: { const: true } })),
  }, events: {} },
  'moss.trace/v1': { types: 'Trace', methods: {
    status: method('trace:capture', empty, record({ enabled: boolean, queuedBytes: count, droppedRecords: count, error: nullable(string) })),
  }, events: {} },
}

for (const protocol of ['moss.trace/v1']) for (const entry of Object.values(localContracts[protocol].methods)) entry.apps = [protocol.split('/')[0]]
