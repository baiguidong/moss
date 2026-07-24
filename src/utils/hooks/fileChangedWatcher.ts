import chokidar, { type FSWatcher } from 'chokidar'
import { isAbsolute, join } from 'path'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import {
  executeCwdChangedHooks,
  executeFileChangedHooks,
  type HookOutsideReplResult,
} from '../hooks.js'
import { runWithCwdOverride } from '../cwd.js'
import { getProjectRootOverride } from '../cwdContext.js'
import {
  getSessionIdContext,
  getSessionProjectDirContext,
  runWithSessionIdContext,
} from '../sessionIdContext.js'
import { clearCwdEnvFiles } from '../sessionEnvironment.js'
import { getHooksConfigFromSnapshot } from './hooksConfigSnapshot.js'
import type { SessionId } from '../../types/ids.js'

type WatcherState = {
  watcher: FSWatcher | null
  currentCwd: string
  dynamicWatchPaths: string[]
  dynamicWatchPathsSorted: string[]
  initialized: boolean
  hasEnvHooks: boolean
  notifyCallback: ((text: string, isError: boolean) => void) | null
  sessionId: SessionId | undefined
  projectDir: string | null | undefined
  projectRoot: string | undefined
}

function createWatcherState(): WatcherState {
  return {
    watcher: null,
    currentCwd: '',
    dynamicWatchPaths: [],
    dynamicWatchPathsSorted: [],
    initialized: false,
    hasEnvHooks: false,
    notifyCallback: null,
    sessionId: undefined,
    projectDir: undefined,
    projectRoot: undefined,
  }
}

const globalWatcherState = createWatcherState()
const sessionWatcherStates = new Map<string, WatcherState>()

function getWatcherState(): WatcherState {
  const sessionId = getSessionIdContext()
  if (!sessionId) {
    return globalWatcherState
  }
  let state = sessionWatcherStates.get(sessionId)
  if (!state) {
    state = createWatcherState()
    sessionWatcherStates.set(sessionId, state)
  }
  return state
}

function runWithWatcherContext<T>(state: WatcherState, fn: () => T): T {
  if (!state.sessionId) {
    return fn()
  }
  return runWithSessionIdContext(state.sessionId, state.projectDir, () =>
    runWithCwdOverride(state.currentCwd, fn, state.projectRoot),
  )
}

export function setEnvHookNotifier(
  cb: ((text: string, isError: boolean) => void) | null,
): void {
  getWatcherState().notifyCallback = cb
}

export function initializeFileChangedWatcher(cwd: string): void {
  const state = getWatcherState()
  if (state.initialized) return
  state.initialized = true
  state.currentCwd = cwd
  state.sessionId = getSessionIdContext()
  state.projectDir = getSessionProjectDirContext()
  state.projectRoot = getProjectRootOverride()

  const config = getHooksConfigFromSnapshot()
  state.hasEnvHooks =
    (config?.CwdChanged?.length ?? 0) > 0 ||
    (config?.FileChanged?.length ?? 0) > 0

  if (state.hasEnvHooks) {
    registerCleanup(async () => dispose(state))
  }

  const paths = resolveWatchPaths(state, config)
  if (paths.length === 0) return

  startWatching(state, paths)
}

function resolveWatchPaths(
  state: WatcherState,
  config?: ReturnType<typeof getHooksConfigFromSnapshot>,
): string[] {
  const matchers =
    runWithWatcherContext(
      state,
      () => (config ?? getHooksConfigFromSnapshot())?.FileChanged,
    ) ?? []

  // Matcher field: filenames to watch in cwd, pipe-separated (e.g. ".envrc|.env")
  const staticPaths: string[] = []
  for (const m of matchers) {
    if (!m.matcher) continue
    for (const name of m.matcher.split('|').map(s => s.trim())) {
      if (!name) continue
      staticPaths.push(isAbsolute(name) ? name : join(state.currentCwd, name))
    }
  }

  // Combine static matcher paths with dynamic paths from hook output
  return [...new Set([...staticPaths, ...state.dynamicWatchPaths])]
}

function startWatching(state: WatcherState, paths: string[]): void {
  logForDebugging(`FileChanged: watching ${paths.length} paths`)
  state.watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    ignorePermissionErrors: true,
  })
  state.watcher.on('change', p => handleFileEvent(state, p, 'change'))
  state.watcher.on('add', p => handleFileEvent(state, p, 'add'))
  state.watcher.on('unlink', p => handleFileEvent(state, p, 'unlink'))
}

function handleFileEvent(
  state: WatcherState,
  path: string,
  event: 'change' | 'add' | 'unlink',
): void {
  logForDebugging(`FileChanged: ${event} ${path}`)
  void runWithWatcherContext(state, () => executeFileChangedHooks(path, event))
    .then(({ results, watchPaths, systemMessages }) => {
      if (watchPaths.length > 0) {
        updateWatchPathsForState(state, watchPaths)
      }
      for (const msg of systemMessages) {
        state.notifyCallback?.(msg, false)
      }
      for (const r of results) {
        if (!r.succeeded && r.output) {
          state.notifyCallback?.(r.output, true)
        }
      }
    })
    .catch(e => {
      const msg = errorMessage(e)
      logForDebugging(`FileChanged hook failed: ${msg}`, {
        level: 'error',
      })
      state.notifyCallback?.(msg, true)
    })
}

export function updateWatchPaths(paths: string[]): void {
  updateWatchPathsForState(getWatcherState(), paths)
}

function updateWatchPathsForState(state: WatcherState, paths: string[]): void {
  if (!state.initialized) return
  const sorted = paths.slice().sort()
  if (
    sorted.length === state.dynamicWatchPathsSorted.length &&
    sorted.every((p, i) => p === state.dynamicWatchPathsSorted[i])
  ) {
    return
  }
  state.dynamicWatchPaths = paths
  state.dynamicWatchPathsSorted = sorted
  restartWatching(state)
}

function restartWatching(state: WatcherState): void {
  if (state.watcher) {
    void state.watcher.close()
    state.watcher = null
  }
  const paths = resolveWatchPaths(state)
  if (paths.length > 0) {
    startWatching(state, paths)
  }
}

export async function onCwdChangedForHooks(
  oldCwd: string,
  newCwd: string,
): Promise<void> {
  if (oldCwd === newCwd) return
  const state = getWatcherState()

  // Re-evaluate from the current snapshot so mid-session hook changes are picked up
  const config = getHooksConfigFromSnapshot()
  const currentHasEnvHooks =
    (config?.CwdChanged?.length ?? 0) > 0 ||
    (config?.FileChanged?.length ?? 0) > 0
  if (!currentHasEnvHooks) return
  state.currentCwd = newCwd

  await clearCwdEnvFiles()
  const hookResult = await executeCwdChangedHooks(oldCwd, newCwd).catch(e => {
    const msg = errorMessage(e)
    logForDebugging(`CwdChanged hook failed: ${msg}`, {
      level: 'error',
    })
    state.notifyCallback?.(msg, true)
    return {
      results: [] as HookOutsideReplResult[],
      watchPaths: [] as string[],
      systemMessages: [] as string[],
    }
  })
  state.dynamicWatchPaths = hookResult.watchPaths
  state.dynamicWatchPathsSorted = hookResult.watchPaths.slice().sort()
  for (const msg of hookResult.systemMessages) {
    state.notifyCallback?.(msg, false)
  }
  for (const r of hookResult.results) {
    if (!r.succeeded && r.output) {
      state.notifyCallback?.(r.output, true)
    }
  }

  // Re-resolve matcher paths against the new cwd
  if (state.initialized) {
    restartWatching(state)
  }
}

function dispose(state: WatcherState): void {
  if (state.watcher) {
    void state.watcher.close()
    state.watcher = null
  }
  state.dynamicWatchPaths = []
  state.dynamicWatchPathsSorted = []
  state.initialized = false
  state.hasEnvHooks = false
  state.notifyCallback = null
  if (state.sessionId) {
    sessionWatcherStates.delete(state.sessionId)
  }
}

export function resetFileChangedWatcherForTesting(): void {
  dispose(globalWatcherState)
  for (const state of Array.from(sessionWatcherStates.values())) {
    dispose(state)
  }
  sessionWatcherStates.clear()
}

export function discardSessionFileChangedWatcher(sessionId: string): void {
  const state = sessionWatcherStates.get(sessionId)
  if (!state) {
    return
  }
  dispose(state)
}
