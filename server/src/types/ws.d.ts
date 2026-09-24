declare module 'ws' {
  import type http from 'http'
  import type { Duplex } from 'stream'
  import { EventEmitter } from 'events'

  export class WebSocket extends EventEmitter {
    readonly OPEN: number
    readonly readyState: number
    send(data: string | Buffer): void
    close(code?: number, reason?: string | Buffer): void
    terminate(): void
    on(event: 'message', listener: (data: string | Buffer) => void): this
    on(event: 'close' | 'error', listener: () => void): this
  }

  export class WebSocketServer extends EventEmitter {
    readonly clients: Set<WebSocket>
    constructor(options: { noServer: boolean })
    handleUpgrade(
      request: http.IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (ws: WebSocket) => void,
    ): void
    close(callback?: (error?: Error) => void): void
  }
}
