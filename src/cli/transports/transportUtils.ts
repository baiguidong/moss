import { URL } from 'url'
import { WebSocketTransport } from './WebSocketTransport.js'

/**
 * Helper function to get the appropriate transport for a URL.
 *
 * Supports the websocket transport used by SDK remote IO.
 */
export function getTransportForUrl(
  url: URL,
  headers: Record<string, string> = {},
  sessionId?: string,
  refreshHeaders?: () => Record<string, string>,
): WebSocketTransport {
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return new WebSocketTransport(url, headers, sessionId, refreshHeaders)
  } else {
    throw new Error(`Unsupported protocol: ${url.protocol}`)
  }
}
