import { contracts } from '../../../host-contracts/src/index.mjs'
import { cloudStates } from '../../../host-contracts/src/cloud.mjs'
import { validateContract } from '../host/contracts.mjs'
import { AppServiceError, APP_ERROR_CODES } from '../errors.mjs'
export const MOSS_CLOUD_STORAGE_PROTOCOL = 'moss.cloud-storage/v1'
export const CLOUD_STORAGE_HOST_METHOD_PERMISSIONS = Object.freeze(Object.fromEntries(Object.entries(contracts[MOSS_CLOUD_STORAGE_PROTOCOL].methods).map(([name, method]) => [name, method.permission])))
export const CLOUD_STORAGE_HOST_METHODS = Object.freeze(Object.keys(CLOUD_STORAGE_HOST_METHOD_PERMISSIONS))
export const CLOUD_STORAGE_EVENTS = Object.freeze(['transfers.progress', 'transfers.changed', 'storage.status-changed'])
export const CLOUD_STORAGE_STATES = Object.freeze(cloudStates)
function fail(message) { throw new AppServiceError(APP_ERROR_CODES.invalidInput, message) }
export function validateCloudStorageHostInput(method, value = {}) { return validateContract(MOSS_CLOUD_STORAGE_PROTOCOL, method, 'input', value) }
export function validateCloudStorageHostOutput(method, value) { return validateContract(MOSS_CLOUD_STORAGE_PROTOCOL, method, 'output', value) }
export function createCloudStorageClient(host) {
  return {
    request(method, input = {}, options) { return host.request(MOSS_CLOUD_STORAGE_PROTOCOL, method, validateCloudStorageHostInput(method, input), options).then(value => validateCloudStorageHostOutput(method, value)) },
    on(name, listener) { if (!CLOUD_STORAGE_EVENTS.includes(name)) fail('Unknown event'); return host.on(MOSS_CLOUD_STORAGE_PROTOCOL, name, listener) },
  }
}
