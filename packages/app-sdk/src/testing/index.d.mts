import type { EventEmitter } from 'node:events'
import type { AppBackendClient, AppActionHandler } from '../index.mjs'
export function createBackendTestHarness(actions?: Record<string, AppActionHandler>): {
  client: AppBackendClient; received: unknown[]; host: EventEmitter; send(message: unknown): void
}
