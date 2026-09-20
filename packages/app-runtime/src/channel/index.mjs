import {
  APP_ERROR_CODES,
  CHANNEL_BACKEND_EVENT_PERMISSIONS,
  CHANNEL_HOST_METHOD_PERMISSIONS,
  MOSS_CHANNEL_PROTOCOL,
  validateChannelBackendEventData,
  validateChannelHostInput,
} from '../../../app-sdk/src/index.mjs'
import { AppHostCapabilityRegistry } from '../capabilities/index.mjs'

export function createChannelProtocolDefinition(options = {}) {
  return {
    protocol: MOSS_CHANNEL_PROTOCOL,
    methods: Object.fromEntries(Object.entries(CHANNEL_HOST_METHOD_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (input) => validateChannelHostInput(name, input),
    }])),
    events: Object.fromEntries(Object.entries(CHANNEL_BACKEND_EVENT_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (data) => validateChannelBackendEventData(name, data),
    }])),
    handleRequest: options.handleRequest,
    errorCodes: {
      unavailable: APP_ERROR_CODES.channelUnavailable,
      protocol: APP_ERROR_CODES.channelProtocol,
    },
  }
}

export class AppChannelHost {
  constructor(options = {}) {
    this.registry = options.registry || new AppHostCapabilityRegistry({
      maxConcurrentPerInstance: options.maxConcurrentPerInstance,
      maxConcurrentTotal: options.maxConcurrentTotal,
      authorize: options.authorize,
    })
    this.disposeProtocol = this.registry.registerProtocol(createChannelProtocolDefinition({
      handleRequest: options.handleRequest,
    }))
    for (const [method, handler] of Object.entries(options.handlers || {})) this.register(method, handler)
  }

  get activeByInstance() { return this.registry.activeByInstance }
  get activeTotal() { return this.registry.activeTotal }

  register(method, handler) {
    return this.registry.registerHandler(MOSS_CHANNEL_PROTOCOL, method, handler)
  }

  listMethods() {
    return this.registry.listMethods(MOSS_CHANNEL_PROTOCOL).filter((method) =>
      this.registry.handlers.get(MOSS_CHANNEL_PROTOCOL)?.has(method))
  }

  dispatch(request) {
    return this.registry.dispatch(request)
  }

  prepareEvent(request) {
    return this.registry.prepareEvent({ ...request, protocol: MOSS_CHANNEL_PROTOCOL })
  }
}
