export interface DesktopControlSettings { version: 1; enabled: boolean; apps: Array<{ bundleId: string; name: string }> }
export function normalizeDesktopControlSettings(value?: unknown): DesktopControlSettings
export class DesktopControlSession {
  constructor(options: { getSettings(): unknown; saveSettings(value: DesktopControlSettings): unknown; requestAccess(request: any): Promise<string>; publish?(status: any): void; isCurrent?(session?: any): boolean })
  adapter?: any
  owner?: { id: string; title: string; runId: string; app?: any; action?: string; foreground?: boolean } | null
  inFlight?: boolean
  epoch: number
  suspended: boolean
  failedStop?: boolean
  sessionGrants: Map<string, Set<string>>
  blocked: Set<string>
  settings(): DesktopControlSettings
  status(): any
  changed(): void
  assertLocal(session: any): void
  guard(session: any, epoch?: number): void
  beginTurn(id: string): void
  authorize(session: any, app: { bundleId: string; name?: string }, foreground: boolean, signal: AbortSignal, epoch: number): Promise<void>
  run<T>(session: any, signal: AbortSignal | undefined, operation: (signal: AbortSignal, epoch: number) => Promise<T>): Promise<T>
  finish(id: string): Promise<void>
  stop(reason?: string, id?: string): Promise<void>
  revoke(bundleId: string): Promise<void>
  disposeSession(id: string): Promise<void>
}
