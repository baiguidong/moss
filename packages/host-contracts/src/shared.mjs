export const text = (maxLength = 4096) => ({ type: 'string', minLength: 1, maxLength, pattern: '^[^\\u0000]*\\S[^\\u0000]*$' })
export const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
export const boolean = { type: 'boolean' }
export const string = { type: 'string' }
export const nullable = schema => ({ anyOf: [schema, { type: 'null' }] })
export const array = (items, maxItems = 200) => ({ type: 'array', items, maxItems })
export const record = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
export const errors = ['APP_INVALID_ACTION_INPUT', 'APP_PERMISSION_DENIED', 'APP_HOST_UNAVAILABLE', 'APP_HOST_PROTOCOL_ERROR', 'APP_NOT_FOUND', 'APP_CONFLICT', 'APP_RESOURCE_EXHAUSTED', 'APP_ACTION_CANCELED', 'APP_HOST_TIMEOUT']
export const method = (permission, input, output, extra = {}) => ({ permission, input, output, surfaces: ['ui', 'backend'], errors, ...extra })
