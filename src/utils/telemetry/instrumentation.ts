import type { Meter } from 'src/bootstrap/state.js'

export function bootstrapTelemetry(): void {
  return
}

export function parseExporterTypes(_value: string | undefined): string[] {
  return []
}

export function isTelemetryEnabled(): boolean {
  return false
}

export async function initializeTelemetry(): Promise<Meter | null> {
  return null
}

export async function flushTelemetry(): Promise<void> {
  return
}
