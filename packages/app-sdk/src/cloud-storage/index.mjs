import { AppServiceError, APP_ERROR_CODES } from '../protocol/index.mjs'
export const MOSS_CLOUD_STORAGE_PROTOCOL = 'moss.cloud-storage/v1'
export const CLOUD_STORAGE_HOST_METHOD_PERMISSIONS = Object.freeze({
  'status.get': 'cloud-storage:read', 'quota.get': 'cloud-storage:read',
  'files.list': 'cloud-storage:read', 'files.get': 'cloud-storage:read',
  'folders.create': 'cloud-storage:write', 'files.update': 'cloud-storage:write', 'files.delete': 'cloud-storage:delete',
  'local-files.pick': 'cloud-storage:write', 'uploads.start': 'cloud-storage:write', 'downloads.start': 'cloud-storage:read',
  'transfers.list': 'cloud-storage:read', 'transfers.get': 'cloud-storage:read',
  'transfers.pause': 'cloud-storage:read', 'transfers.resume': 'cloud-storage:read', 'transfers.cancel': 'cloud-storage:read',
})
export const CLOUD_STORAGE_HOST_METHODS = Object.freeze(Object.keys(CLOUD_STORAGE_HOST_METHOD_PERMISSIONS))
export const CLOUD_STORAGE_EVENTS = Object.freeze(['transfers.progress', 'transfers.changed', 'storage.status-changed'])
export const CLOUD_STORAGE_STATES = Object.freeze(['remote_disabled', 'unauthenticated', 'unconfigured', 'disabled', 'unsupported', 'unavailable', 'target_mismatch', 'forbidden', 'ready'])
const fields = {
  'status.get': [], 'quota.get': [], 'files.list': ['parentId', 'cursor', 'limit'], 'files.get': ['fileId'],
  'folders.create': ['parentId', 'name'], 'files.update': ['fileId', 'parentId', 'name'], 'files.delete': ['fileId'],
  'local-files.pick': [], 'uploads.start': ['handle', 'parentId', 'name'], 'downloads.start': ['fileId'],
  'transfers.list': ['cursor', 'limit'], 'transfers.get': ['transferId'], 'transfers.pause': ['transferId'], 'transfers.resume': ['transferId'], 'transfers.cancel': ['transferId'],
}
function fail(message, output = false) { throw new AppServiceError(output ? APP_ERROR_CODES.hostProtocol : APP_ERROR_CODES.invalidInput, message) }
export function validateCloudStorageHostInput(method, value = {}) {
  if (!Object.hasOwn(fields, method)) fail(`Unknown cloud storage method: ${method}`)
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected object')
  for (const key of Object.keys(value)) {
    if (!fields[method].includes(key)) fail(`Unexpected field: ${key}`)
    if (key === 'limit') { if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 200) fail('Invalid limit') }
    else if (key === 'parentId' && value[key] === null) continue
    else if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > (key === 'name' ? 255 : 128)) fail(`Invalid ${key}`)
  }
  for (const key of ['fileId', 'transferId', 'handle']) if (fields[method].includes(key) && !value[key]) fail(`Missing ${key}`)
  if (method === 'folders.create' && !value.name) fail('Missing name')
  return { ...value }
}
export function validateCloudStorageHostOutput(method, value) {
  if (!Object.hasOwn(fields, method) || !value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid cloud storage response', true)
  if (method === 'status.get' && !CLOUD_STORAGE_STATES.includes(value.state)) fail('Invalid cloud storage state', true)
  const string = v => typeof v === 'string' && v.length > 0
  const bytes = v => Number.isSafeInteger(v) && v >= 0
  const file = v => {
    if (!v || !string(v.id) || !string(v.name) || !['file','folder'].includes(v.kind) || !bytes(v.size) || !string(v.revision) || !(v.parentId === null || string(v.parentId))) fail('Invalid cloud file', true)
  }
  const transfer = v => {
    if (!v || !string(v.transferId) || !['upload','download'].includes(v.direction) || !['queued','running','paused','cancelled','completed'].includes(v.state) || !bytes(v.totalBytes) || !bytes(v.transferredBytes)) fail('Invalid cloud transfer', true)
  }
  if (method === 'quota.get' && !['usedBytes','reservedBytes','limitBytes'].every(k => bytes(value[k]))) fail('Invalid quota', true)
  if (method === 'files.list') {
    if (!Array.isArray(value.files) || value.files.length > 200) fail('Invalid file list', true)
    value.files.forEach(file)
  }
  if (['files.get','files.update','folders.create'].includes(method)) file(value)
  if (method === 'local-files.pick') {
    if (!Array.isArray(value.files) || value.files.length > 100 || value.files.some(v => !string(v.handle) || !string(v.name) || !bytes(v.size) || Object.keys(v).some(k => !['handle','name','size'].includes(k)))) fail('Invalid file handles', true)
  }
  if (method === 'transfers.list' && (!Array.isArray(value.transfers) || value.transfers.length > 200 || !(value.nextCursor === null || string(value.nextCursor)))) fail('Invalid transfers', true)
  if (method === 'transfers.list') value.transfers.forEach(transfer)
  else if (method.startsWith('transfers.')) transfer(value)
  if (['uploads.start','downloads.start'].includes(method) && typeof value.transferId !== 'string') fail('Invalid transfer ID', true)
  return value
}
export function createCloudStorageClient(host) {
  return {
    request(method, input = {}, options) { return host.request(MOSS_CLOUD_STORAGE_PROTOCOL, method, validateCloudStorageHostInput(method, input), options).then(value => validateCloudStorageHostOutput(method, value)) },
    on(name, listener) { if (!CLOUD_STORAGE_EVENTS.includes(name)) fail('Unknown event'); return host.on(MOSS_CLOUD_STORAGE_PROTOCOL, name, listener) },
  }
}
