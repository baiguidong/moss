import { text, count, boolean, string, nullable, array, record, method } from './shared.mjs'
export const cloudStates = ['remote_disabled','unauthenticated','unconfigured','disabled','unsupported','unavailable','target_mismatch','forbidden','ready']
const id = text(128), name = text(255), empty = record({}), cursor = nullable(id)
const page = { cursor: id, limit: { type: 'integer', minimum: 1, maximum: 200 } }
const status = record({ state: { enum: cloudStates }, version: count }, ['state'])
const file = record({ id, parentId: nullable(id), name, kind: { enum: ['file','folder'] }, size: count, revision: id, createdAt: count, updatedAt: count })
const transfer = record({ id, transferId: id, direction: { enum: ['upload','download'] }, name, fileId: nullable(id), state: { enum: ['queued','running','paused','cancelled','completed'] }, totalBytes: count, transferredBytes: count, error: nullable(string), createdAt: count, updatedAt: count })
const accessCode = nullable({ type: 'string', pattern: '^[a-zA-Z0-9]{4,12}$' })
const share = record({ id, fileId: id, name, size: count, url: { ...text(16384), pattern: '^https?://' }, accessCode, createdAt: count, expiresAt: nullable(count), revokedAt: nullable(count), state: { enum: ['active','expired','revoked','unavailable'] } })
export const cloudTypes = { CloudFile: file, CloudTransfer: transfer, CloudShare: share, CloudStorageStatus: status }
const read = (input, output) => method('cloud-storage:read', input, output)
const write = (input, output) => method('cloud-storage:write', input, output)
export const cloudContracts = { 'moss.cloud-storage/v1': { types: 'CloudStorage', methods: {
  'status.get': read(empty, status), 'quota.get': read(empty, record({ usedBytes: count, reservedBytes: count, limitBytes: count })),
  'files.list': read(record({ parentId: nullable(id), ...page }, []), record({ files: array(file), nextCursor: cursor })),
  'files.get': read(record({ fileId: id }), file),
  'folders.create': write(record({ name, parentId: nullable(id) }, ['name']), file),
  'files.update': write(record({ fileId: id, name, parentId: nullable(id) }, ['fileId']), file),
  'files.delete': method('cloud-storage:delete', record({ fileId: id }), record({ ok: { const: true } })),
  'local-files.pick': write(empty, record({ files: array(record({ handle: id, name, size: count }), 100) })),
  'uploads.start': write(record({ handle: id, name, parentId: nullable(id) }, ['handle']), record({ transferId: id })),
  'downloads.start': read(record({ fileId: id }), record({ transferId: id })),
  'transfers.list': read(record(page, []), record({ transfers: array(transfer), nextCursor: cursor })),
  ...Object.fromEntries(['get','pause','resume','cancel'].map(action => ['transfers.'+action, read(record({ transferId: id }), transfer)])),
  'shares.create': method('cloud-storage:share', record({ fileId: id, requestKey: id, expiresAt: nullable({ ...count, minimum: 1 }), accessCode }, ['fileId','requestKey','expiresAt']), share, { idempotency: 'requestKey' }),
  'shares.list': method('cloud-storage:share', record({ fileId: id, ...page }, []), record({ shares: array(share), nextCursor: cursor })),
  'shares.revoke': method('cloud-storage:share', record({ shareId: id }), share),
}, events: {
  'transfers.progress': { permission: 'cloud-storage:read', input: transfer },
  'transfers.changed': { permission: 'cloud-storage:read', input: transfer },
  'storage.status-changed': { permission: 'cloud-storage:read', input: status },
} } }
