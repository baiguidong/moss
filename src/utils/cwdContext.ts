import { AsyncLocalStorage } from 'async_hooks'

// Leaf module (depends only on node:async_hooks) holding the per-async-context
// working-directory override. Split out of cwd.ts so that bootstrap/state.ts
// can read the projectRoot override without creating an import cycle
// (cwd.ts imports bootstrap/state.ts for its global fallbacks).
export type CwdOverrideContext = {
  cwd: string
  originalCwd: string
  // Per-session project root for the embedded multi-session runtime.
  // Optional: CLI paths run without it and fall back to the global state.
  projectRoot?: string
}

export const cwdOverrideStorage = new AsyncLocalStorage<CwdOverrideContext>()

export function getProjectRootOverride(): string | undefined {
  return cwdOverrideStorage.getStore()?.projectRoot
}

export function getOriginalCwdOverride(): string | undefined {
  return cwdOverrideStorage.getStore()?.originalCwd
}

export function setCurrentProjectRootOverride(root: string): boolean {
  const context = cwdOverrideStorage.getStore()
  if (!context) {
    return false
  }
  context.projectRoot = root
  return true
}

export function hasCwdOverrideContext(): boolean {
  return cwdOverrideStorage.getStore() !== undefined
}

export function setCurrentOriginalCwdOverride(originalCwd: string): boolean {
  const context = cwdOverrideStorage.getStore()
  if (!context) {
    return false
  }
  context.originalCwd = originalCwd.normalize('NFC')
  return true
}
