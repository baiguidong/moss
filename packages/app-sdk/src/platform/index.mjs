import { validateContract } from '../host/contracts.mjs'
import { contracts, platformLimits } from '../../../host-contracts/src/index.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../errors.mjs'

export const MOSS_PLATFORM_PROTOCOL = 'moss.platform/v1'
export const MAX_INLINE_FILE_BASE64_LENGTH = platformLimits.inlineBase64Length

export const PLATFORM_PERMISSIONS = Object.freeze({
  files: 'platform:files',
  screenCapture: 'platform:screen-capture',
  externalLinks: 'platform:external-links',
  media: 'platform:media',
})

export const PLATFORM_HOST_METHOD_PERMISSIONS = Object.freeze(Object.fromEntries(Object.entries(contracts[MOSS_PLATFORM_PROTOCOL].methods).map(([name, method]) => [name, method.permission])))

export const PLATFORM_HOST_METHODS = Object.freeze(Object.keys(PLATFORM_HOST_METHOD_PERMISSIONS))

export function validatePlatformHostMethod(method) {
  if (!Object.hasOwn(PLATFORM_HOST_METHOD_PERMISSIONS, method)) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Unknown Platform method')
  return method
}
export function validatePlatformHostInput(method, value = {}) { return validateContract(MOSS_PLATFORM_PROTOCOL, method, 'input', value) }
export function validatePlatformHostOutput(method, value) { return validateContract(MOSS_PLATFORM_PROTOCOL, method, 'output', value) }
