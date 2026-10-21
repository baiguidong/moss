export const APP_CAPABILITIES_PROTOCOL = 'moss.app-capabilities/v1'

export function createAppCapabilitiesClient(host) {
  return Object.freeze({
    list(input = {}, options) {
      return host.request(APP_CAPABILITIES_PROTOCOL, 'providers.list', input, options)
    },
    async invoke(providerRef, method, input = {}, options) {
      const response = await host.request(APP_CAPABILITIES_PROTOCOL, 'provider.invoke', { providerRef, method, input }, options)
      return response.value
    },
    read(resourceRef, offset, limit, options) {
      return host.request(APP_CAPABILITIES_PROTOCOL, 'resource.read', { resourceRef, offset, limit }, options)
    },
    listTools(input, options) {
      return host.request(APP_CAPABILITIES_PROTOCOL, 'tools.list', input, options)
    },
    async invokeTool(toolRef, args = {}, options) {
      const response = await host.request(APP_CAPABILITIES_PROTOCOL, 'tool.invoke', { toolRef, arguments: args }, options)
      return response.result
    },
  })
}
