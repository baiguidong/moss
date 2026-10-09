import { contracts } from '../../../host-contracts/src/index.mjs'
import * as validators from '../../../host-contracts/src/generated-validators.mjs'
import { AppServiceError, APP_ERROR_CODES } from '../errors.mjs'

export function validateContract(protocol, name, direction, value) {
  const key = validators.validatorKeys[JSON.stringify([protocol, name, direction])]
  const validate = key && validators[key]
  if (!validate) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `Unsupported ${protocol} ${name}`)
  if (!validate(value)) throw new AppServiceError(direction === 'input' ? APP_ERROR_CODES.invalidInput : APP_ERROR_CODES.hostProtocol,
    `Invalid ${name} ${direction}: ${validate.errors.map(error => `${error.instancePath || '/'}${error.params?.missingProperty ? '/' + error.params.missingProperty : ''} ${error.message}`).join('; ')}`, validate.errors)
  return value
}

export function contractDefinition(protocol) {
  const definition = contracts[protocol]
  return {
    protocol,
    methods: Object.fromEntries(Object.entries(definition.methods).map(([name, method]) => [name, {
      permission: method.permission, surfaces: method.surfaces, limits: method.limits, apps: method.apps,
      validateInput: value => validateContract(protocol, name, 'input', value),
      validateOutput: value => validateContract(protocol, name, 'output', value),
    }])),
    events: Object.fromEntries(Object.entries(definition.events).map(([name, event]) => [name, {
      permission: event.permission, validateInput: value => validateContract(protocol, name, 'event', value),
    }])),
  }
}
