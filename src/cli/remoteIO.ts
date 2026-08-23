import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { PassThrough } from 'stream'
import { URL } from 'url'
import { getSessionId } from '../bootstrap/state.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'
import { getSessionIngressAuthToken } from '../utils/sessionIngressAuth.js'
import { StructuredIO } from './structuredIO.js'
import { getTransportForUrl } from './transports/transportUtils.js'

/**
 * Bidirectional streaming for SDK mode with session tracking
 * Supports WebSocket transport
 */
export class RemoteIO extends StructuredIO {
  private url: URL
  private transport: ReturnType<typeof getTransportForUrl>
  private inputStream: PassThrough

  constructor(
    streamUrl: string,
    initialPrompt?: AsyncIterable<string>,
    replayUserMessages?: boolean,
  ) {
    const inputStream = new PassThrough({ encoding: 'utf8' })
    super(inputStream, replayUserMessages)
    this.inputStream = inputStream
    this.url = new URL(streamUrl)

    // Prepare headers with session token if available
    const headers: Record<string, string> = {}
    const sessionToken = getSessionIngressAuthToken()
    if (sessionToken) {
      headers['Authorization'] = `Bearer ${sessionToken}`
    } else {
      logForDebugging('[remote-io] No session ingress token available', {
        level: 'error',
      })
    }

    // Add environment runner version if available (set by Environment Manager)
    const erVersion = process.env.CLAUDE_CODE_ENVIRONMENT_RUNNER_VERSION
    if (erVersion) {
      headers['x-environment-runner-version'] = erVersion
    }

    // Provide a callback that re-reads the session token dynamically.
    // When the parent process refreshes the token (via token file or env var),
    // the transport can pick it up on reconnection.
    const refreshHeaders = (): Record<string, string> => {
      const h: Record<string, string> = {}
      const freshToken = getSessionIngressAuthToken()
      if (freshToken) {
        h['Authorization'] = `Bearer ${freshToken}`
      }
      const freshErVersion = process.env.CLAUDE_CODE_ENVIRONMENT_RUNNER_VERSION
      if (freshErVersion) {
        h['x-environment-runner-version'] = freshErVersion
      }
      return h
    }

    // Get appropriate transport based on URL protocol
    this.transport = getTransportForUrl(
      this.url,
      headers,
      getSessionId(),
      refreshHeaders,
    )

    // Set up data callback
    this.transport.setOnData((data: string) => {
      this.inputStream.write(data)
    })

    // Set up close callback to handle connection failures
    this.transport.setOnClose(() => {
      // End the input stream to trigger graceful shutdown
      this.inputStream.end()
    })

    // Start connection only after all callbacks are wired.
    void this.transport.connect()

    // Register for graceful shutdown cleanup
    registerCleanup(async () => this.close())

    // If initial prompt is provided, send it through the input stream
    if (initialPrompt) {
      // Convert the initial prompt to the input stream format.
      // Chunks from stdin may already contain trailing newlines, so strip
      // them before appending our own to avoid double-newline issues that
      // cause structuredIO to parse empty lines. String() handles both
      // string chunks and Buffer objects from process.stdin.
      const stream = this.inputStream
      void (async () => {
        for await (const chunk of initialPrompt) {
          stream.write(String(chunk).replace(/\n$/, '') + '\n')
        }
      })()
    }
  }

  async write(message: StdoutMessage): Promise<void> {
    await this.transport.write(message)
  }

  /**
   * Clean up connections gracefully
   */
  close(): void {
    this.transport.close()
    this.inputStream.end()
  }
}
