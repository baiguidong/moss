/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */

import { randomUUID } from 'crypto'
import type WsWebSocket from 'ws'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlPermissionRequest,
  StdoutMessage,
} from '../entrypoints/sdk/controlTypes.js'
import type { MossAppEvent, MossAppEventResult } from '../Tool.js'
import type { ExternalPermissionMode } from '../types/permissions.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { getWebSocketTLSOptions } from '../utils/mtls.js'
import {
  getWebSocketProxyAgent,
  getWebSocketProxyUrl,
} from '../utils/proxy.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import {
  attachDirectConnectSession,
  DirectConnectError,
} from './createDirectConnectSession.js'

const DEFAULT_BASE_RECONNECT_DELAY_MS = 1_000
const DEFAULT_MAX_RECONNECT_DELAY_MS = 8_000
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8
const DEFAULT_PING_INTERVAL_MS = 10_000
const SUSPEND_DETECTION_THRESHOLD_MS = DEFAULT_PING_INTERVAL_MS * 3

type WebSocketState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'

type PendingControlRequest = {
  resolve: (response?: Record<string, unknown>) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export type RemoteMessageContent =
  | string
  | Array<{ type: string; [key: string]: unknown }>

export type RemotePermissionResponse =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: unknown[]
    }
  | {
      behavior: 'deny'
      message: string
    }

// Common interface between globalThis.WebSocket and ws.WebSocket
type WebSocketLike = {
  close(): void
  send(data: string): void
  ping?(): void
}

export type DirectConnectConfig = {
  serverUrl: string
  sessionId: string
  wsUrl: string
  authToken?: string
}

export type DirectConnectCallbacks = {
  onMessage: (message: SDKMessage) => void
  onPermissionRequest: (
    request: SDKControlPermissionRequest,
    requestId: string,
  ) => void
  onAppEvent?: (event: MossAppEvent) => Promise<MossAppEventResult>
  onConnected?: () => void
  onDisconnected?: () => void
  onReconnecting?: (attempt: number, maxAttempts: number) => void
  onError?: (error: Error) => void
}

function isStdoutMessage(value: unknown): value is StdoutMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

export class DirectConnectSessionManager {
  private ws: WebSocketLike | null = null
  private state: WebSocketState = 'idle'
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private pingInterval: NodeJS.Timeout | null = null
  private pongReceived = true
  private lastPingTickAt = 0
  private manuallyDisconnected = false
  private hasEverConnected = false
  private isBunWs = false
  private readonly pendingControlRequests = new Map<string, PendingControlRequest>()

  constructor(
    private config: DirectConnectConfig,
    private readonly callbacks: DirectConnectCallbacks,
  ) {}

  connect(): void {
    if (this.state === 'connected' || this.state === 'connecting') {
      return
    }
    this.manuallyDisconnected = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    void this.openSocket().catch(error => this.handleOpenFailure(error))
  }

  private async openSocket(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return
    }

    const wasReconnecting =
      this.state === 'reconnecting' || this.reconnectAttempts > 0
    this.state = wasReconnecting ? 'reconnecting' : 'connecting'

    const headers: Record<string, string> = {}
    if (this.config.authToken) {
      headers.authorization = `Bearer ${this.config.authToken}`
    }

    logForDebugging(
      `[DirectConnect] Opening ${this.config.wsUrl} (${this.state})`,
    )

    if (typeof Bun !== 'undefined') {
      // Bun's WebSocket supports headers/proxy/tls options but the DOM typings don't
      const ws = new globalThis.WebSocket(this.config.wsUrl, {
        headers,
        proxy: getWebSocketProxyUrl(this.config.wsUrl),
        tls: getWebSocketTLSOptions() || undefined,
      } as unknown as string[])
      this.ws = ws
      this.isBunWs = true

      ws.addEventListener('open', this.onBunOpen)
      ws.addEventListener('message', this.onBunMessage)
      ws.addEventListener('error', this.onBunError)
      ws.addEventListener('close', this.onBunClose)
      ws.addEventListener('pong', this.onPong)
      return
    }

    const { default: WS } = await import('ws')
    const ws = new WS(this.config.wsUrl, {
      headers,
      agent: getWebSocketProxyAgent(this.config.wsUrl),
      ...getWebSocketTLSOptions(),
    })
    this.ws = ws
    this.isBunWs = false

    ws.on('open', this.onNodeOpen)
    ws.on('message', this.onNodeMessage)
    ws.on('error', this.onNodeError)
    ws.on('close', this.onNodeClose)
    ws.on('pong', this.onPong)
  }

  private onBunOpen = () => {
    this.handleOpen()
  }

  private onBunMessage = (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? event.data : String(event.data)
    this.handleIncomingText(data)
  }

  private onBunError = () => {
    this.callbacks.onError?.(new Error('WebSocket connection error'))
  }

  private onBunClose = (event: CloseEvent) => {
    logForDebugging(
      `[DirectConnect] Closed: code=${event.code} reason=${event.reason}`,
    )
    this.handleSocketClose(event.code)
  }

  private onNodeOpen = () => {
    this.handleOpen()
  }

  private onNodeMessage = (data: Buffer) => {
    this.handleIncomingText(data.toString())
  }

  private onNodeError = (error: Error) => {
    this.callbacks.onError?.(error)
  }

  private onNodeClose = (code: number, reason: Buffer) => {
    logForDebugging(
      `[DirectConnect] Closed: code=${code} reason=${reason.toString()}`,
    )
    this.handleSocketClose(code)
  }

  private onPong = () => {
    this.pongReceived = true
  }

  private handleOpen(): void {
    const wasReconnecting = this.hasEverConnected

    this.state = 'connected'
    this.hasEverConnected = true
    this.reconnectAttempts = 0
    this.pongReceived = true
    this.lastPingTickAt = Date.now()

    this.startPingInterval()
    if (wasReconnecting) {
      logForDebugging(
        `[DirectConnect] Reattached to session ${this.config.sessionId}`,
      )
    } else {
      logForDebugging(
        `[DirectConnect] Connected to session ${this.config.sessionId}`,
      )
    }

    this.callbacks.onConnected?.()
  }

  private handleOpenFailure(error: unknown): void {
    const err =
      error instanceof Error ? error : new Error(`Failed to open socket: ${String(error)}`)
    this.callbacks.onError?.(err)

    if (!this.hasEverConnected && this.state !== 'reconnecting') {
      this.finalizeDisconnect(err)
      return
    }

    this.scheduleReconnect(err)
  }

  private handleIncomingText(data: string): void {
    this.pongReceived = true

    const lines = data.split('\n').filter((line: string) => line.trim())
    for (const line of lines) {
      let raw: unknown
      try {
        raw = jsonParse(line)
      } catch {
        continue
      }

      if (!isStdoutMessage(raw)) {
        continue
      }
      const parsed = raw

      if (parsed.type === 'control_request') {
        const request = parsed.request as {
          subtype?: string
          event?: unknown
        }
        if (parsed.request.subtype === 'can_use_tool') {
          this.callbacks.onPermissionRequest(parsed.request, parsed.request_id)
        } else if (request.subtype === 'moss_app_event') {
          void this.handleAppEventRequest(parsed.request_id, request.event)
        } else {
          logForDebugging(
            `[DirectConnect] Unsupported control request subtype: ${request.subtype ?? 'unknown'}`,
          )
          this.sendErrorResponse(
            parsed.request_id,
            `Unsupported control request subtype: ${request.subtype ?? 'unknown'}`,
          )
        }
        continue
      }

      if (parsed.type === 'control_response') {
        const response = parsed.response as {
          subtype?: string
          request_id?: string
          error?: string
          response?: unknown
        }
        const requestId = response.request_id
        const pending = requestId
          ? this.pendingControlRequests.get(requestId)
          : undefined
        if (requestId && pending) {
          clearTimeout(pending.timeout)
          this.pendingControlRequests.delete(requestId)
          if (response.subtype === 'success') {
            pending.resolve(
              typeof response.response === 'object' && response.response !== null
                ? response.response as Record<string, unknown>
                : undefined,
            )
          } else {
            pending.reject(new Error(response.error || 'Remote control request failed.'))
          }
        }
        continue
      }

      if (
        parsed.type !== 'control_response' &&
        parsed.type !== 'keep_alive' &&
        parsed.type !== 'control_cancel_request' &&
        parsed.type !== 'streamlined_text' &&
        parsed.type !== 'streamlined_tool_use_summary' &&
        !(parsed.type === 'system' && parsed.subtype === 'post_turn_summary')
      ) {
        this.callbacks.onMessage(parsed)
      }
    }
  }

  private handleSocketClose(closeCode?: number): void {
    const previousState = this.state

    this.stopPingInterval()
    this.rejectPendingControlRequests('Remote session disconnected.')
    this.disposeSocket()

    if (this.manuallyDisconnected || this.state === 'closed') {
      this.state = 'closed'
      return
    }

    const canReconnect =
      this.hasEverConnected ||
      previousState === 'reconnecting' ||
      this.reconnectAttempts > 0

    if (!canReconnect) {
      this.finalizeDisconnect(
        closeCode != null
          ? new Error(`WebSocket closed before connecting (code ${closeCode})`)
          : new Error('WebSocket closed before connecting'),
      )
      return
    }

    this.scheduleReconnect(
      closeCode != null
        ? new Error(`WebSocket closed with code ${closeCode}`)
        : new Error('WebSocket closed'),
    )
  }

  private scheduleReconnect(reason: Error): void {
    if (this.manuallyDisconnected || this.state === 'closed') {
      return
    }

    if (this.reconnectAttempts >= DEFAULT_MAX_RECONNECT_ATTEMPTS) {
      this.finalizeDisconnect(reason)
      return
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.state = 'reconnecting'
    this.reconnectAttempts++

    const baseDelay = Math.min(
      DEFAULT_BASE_RECONNECT_DELAY_MS *
        2 ** (this.reconnectAttempts - 1),
      DEFAULT_MAX_RECONNECT_DELAY_MS,
    )
    const jitter = baseDelay * 0.25 * (2 * Math.random() - 1)
    const delay = Math.max(0, Math.round(baseDelay + jitter))

    logForDebugging(
      `[DirectConnect] Reconnecting to session ${this.config.sessionId} in ${delay}ms (${this.reconnectAttempts}/${DEFAULT_MAX_RECONNECT_ATTEMPTS}): ${reason.message}`,
    )

    this.callbacks.onReconnecting?.(
      this.reconnectAttempts,
      DEFAULT_MAX_RECONNECT_ATTEMPTS,
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.reattachAndReconnect().catch(error => {
        const err =
          error instanceof Error
            ? error
            : new Error(`Reconnect failed: ${String(error)}`)
        this.callbacks.onError?.(err)

        if (this.isPermanentReconnectError(error)) {
          this.finalizeDisconnect(err)
          return
        }

        this.scheduleReconnect(err)
      })
    }, delay)
  }

  private async reattachAndReconnect(): Promise<void> {
    const attached = await attachDirectConnectSession({
      serverUrl: this.config.serverUrl,
      sessionId: this.config.sessionId,
      authToken: this.config.authToken,
    })

    if (attached.session.desiredState !== 'active') {
      throw new DirectConnectError(
        `Session ${this.config.sessionId} is no longer active (${attached.session.status})`,
      )
    }

    this.config = attached.config
    await this.openSocket()
  }

  private isPermanentReconnectError(error: unknown): boolean {
    if (!(error instanceof DirectConnectError)) {
      return false
    }
    return (
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      error.statusCode === 404
    )
  }

  private sendLine(line: string): boolean {
    if (!this.ws || this.state !== 'connected') {
      return false
    }

    try {
      this.ws.send(line)
      return true
    } catch (error) {
      const err = new Error(
        `Failed to send WebSocket message: ${errorMessage(error)}`,
      )
      this.callbacks.onError?.(err)
      this.handleSocketClose()
      return false
    }
  }

  sendMessage(
    content: RemoteMessageContent,
    opts?: { uuid?: string },
  ): boolean {
    const uuid = opts?.uuid ?? randomUUID()
    const line = jsonStringify({
      type: 'user',
      message: {
        role: 'user',
        content,
      },
      parent_tool_use_id: null,
      session_id: '',
      uuid,
    })

    if (this.state !== 'connected') {
      logForDebugging(
        `[DirectConnect] Rejected user message ${uuid} while socket state=${this.state}`,
      )
      return false
    }

    return this.sendLine(line)
  }

  respondToPermissionRequest(
    requestId: string,
    result: RemotePermissionResponse,
  ): void {
    if (!this.ws || this.state !== 'connected') {
      return
    }

    const line = jsonStringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: result.behavior,
          ...(result.behavior === 'allow'
            ? {
                updatedInput: result.updatedInput,
                updatedPermissions: result.updatedPermissions,
              }
            : { message: result.message }),
        },
      },
    })
    this.sendLine(line)
  }

  private async handleAppEventRequest(
    requestId: string,
    event: unknown,
  ): Promise<void> {
    if (!this.callbacks.onAppEvent) {
      this.sendErrorResponse(
        requestId,
        'Moss app event bridge is not available in this direct-connect session.',
      )
      return
    }
    if (
      typeof event !== 'object' ||
      event === null ||
      typeof (event as { type?: unknown }).type !== 'string'
    ) {
      this.sendErrorResponse(requestId, 'Invalid Moss app event request.')
      return
    }

    try {
      const result = await this.callbacks.onAppEvent(event as MossAppEvent)
      this.sendSuccessResponse(requestId, result as Record<string, unknown>)
    } catch (error) {
      this.sendErrorResponse(
        requestId,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private sendSuccessResponse(
    requestId: string,
    response?: Record<string, unknown>,
  ): void {
    if (!this.ws || this.state !== 'connected') {
      return
    }

    const line = jsonStringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response,
      },
    })
    this.sendLine(line)
  }

  sendInterrupt(): Promise<{ interrupted?: boolean }> {
    if (!this.ws || this.state !== 'connected') {
      return Promise.reject(new Error('Remote session is not connected.'))
    }

    const requestId = randomUUID()
    const line = jsonStringify({
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'interrupt',
      },
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingControlRequests.delete(requestId)
        reject(new Error('Timed out while interrupting the remote turn.'))
      }, 10_000)
      this.pendingControlRequests.set(requestId, {
        resolve: response => resolve(
          typeof response?.interrupted === 'boolean'
            ? { interrupted: response.interrupted }
            : {},
        ),
        reject,
        timeout,
      })
      if (!this.sendLine(line)) {
        clearTimeout(timeout)
        this.pendingControlRequests.delete(requestId)
        reject(new Error('Failed to interrupt the remote turn.'))
      }
    })
  }

  setPermissionMode(mode: ExternalPermissionMode): Promise<void> {
    if (!this.ws || this.state !== 'connected') {
      return Promise.reject(new Error('Remote session is not connected.'))
    }

    const requestId = randomUUID()
    const line = jsonStringify({
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'set_permission_mode',
        mode,
      },
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingControlRequests.delete(requestId)
        reject(new Error('Timed out while changing remote permission mode.'))
      }, 10_000)
      this.pendingControlRequests.set(requestId, {
        resolve: () => resolve(),
        reject,
        timeout,
      })
      if (!this.sendLine(line)) {
        clearTimeout(timeout)
        this.pendingControlRequests.delete(requestId)
        reject(new Error('Failed to change remote permission mode.'))
      }
    })
  }

  private sendErrorResponse(requestId: string, error: string): void {
    if (!this.ws || this.state !== 'connected') {
      return
    }

    const line = jsonStringify({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error,
      },
    })
    this.sendLine(line)
  }

  private rejectPendingControlRequests(message: string): void {
    for (const pending of this.pendingControlRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(message))
    }
    this.pendingControlRequests.clear()
  }

  disconnect(): void {
    this.manuallyDisconnected = true
    this.state = 'closed'

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.stopPingInterval()
    this.rejectPendingControlRequests('Remote session disconnected.')
    this.disposeSocket()
  }

  isConnected(): boolean {
    return this.state === 'connected'
  }

  private finalizeDisconnect(error: Error): void {
    logForDebugging(
      `[DirectConnect] Giving up on session ${this.config.sessionId}: ${error.message}`,
    )
    this.state = 'closed'
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopPingInterval()
    this.disposeSocket()
    this.callbacks.onDisconnected?.()
  }

  private removeWsListeners(ws: WebSocketLike): void {
    if (this.isBunWs) {
      const socket = ws as unknown as globalThis.WebSocket
      socket.removeEventListener('open', this.onBunOpen)
      socket.removeEventListener('message', this.onBunMessage)
      socket.removeEventListener('error', this.onBunError)
      socket.removeEventListener('close', this.onBunClose)
      socket.removeEventListener('pong' as 'message', this.onPong)
      return
    }

    const socket = ws as unknown as WsWebSocket
    socket.off('open', this.onNodeOpen)
    socket.off('message', this.onNodeMessage)
    socket.off('error', this.onNodeError)
    socket.off('close', this.onNodeClose)
    socket.off('pong', this.onPong)
  }

  private disposeSocket(): void {
    if (!this.ws) {
      return
    }

    const ws = this.ws
    this.ws = null
    this.removeWsListeners(ws)

    try {
      ws.close()
    } catch {}
  }

  private startPingInterval(): void {
    this.stopPingInterval()
    this.pongReceived = true
    this.lastPingTickAt = Date.now()

    this.pingInterval = setInterval(() => {
      if (this.state !== 'connected' || !this.ws) {
        return
      }

      const now = Date.now()
      const gap = now - this.lastPingTickAt
      this.lastPingTickAt = now

      if (gap > SUSPEND_DETECTION_THRESHOLD_MS) {
        logForDebugging(
          `[DirectConnect] ${Math.round(gap / 1000)}s ping gap detected, forcing reconnect`,
        )
        this.handleSocketClose()
        return
      }

      if (!this.pongReceived) {
        logForDebugging(
          '[DirectConnect] Ping timeout, forcing reconnect',
        )
        this.handleSocketClose()
        return
      }

      this.pongReceived = false
      try {
        this.ws.ping?.()
      } catch (error) {
        this.callbacks.onError?.(
          new Error(`WebSocket ping failed: ${errorMessage(error)}`),
        )
      }
    }, DEFAULT_PING_INTERVAL_MS)
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }
}
