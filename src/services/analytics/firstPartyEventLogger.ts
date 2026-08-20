/**
 * No-op compatibility layer for removed first-party event logging.
 */

export type EventSamplingConfig = {
  [eventName: string]: {
    sample_rate: number
  }
}

export function getEventSamplingConfig(): EventSamplingConfig {
  return {}
}

export function shouldSampleEvent(eventName: string): number | null {
  void eventName
  return null
}

export async function shutdown1PEventLogging(): Promise<void> {
  return
}

export function is1PEventLoggingEnabled(): boolean {
  return false
}

export function logEventTo1P(
  eventName: string,
  metadata: Record<string, number | boolean | undefined> = {},
): void {
  void eventName
  void metadata
}

export function initialize1PEventLogging(): void {
  return
}

export async function reinitialize1PEventLoggingIfConfigChanged(): Promise<void> {
  return
}
