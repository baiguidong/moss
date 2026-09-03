import { AsyncLocalStorage } from 'async_hooks'
import type { SessionId } from '../types/ids.js'

export type ScopedWorkerResources = {
  connectors: Array<{
    id: string
    mcpServerNames?: string[]
    skillCommands?: string[]
    directories?: string[]
    environment?: Record<string, string>
  }>
  skills: Array<{ id: string; command: string; directories?: string[] }>
  experts: Array<{ id: string; instructionsPath?: string | null; directories?: string[] }>
}

export type TaskScope =
  | {
      kind: 'session'
      sessionId: string
      projectId?: string | null
    }
  | {
      kind: 'project'
      projectId: string
      sessionId?: string | null
      projectResources?: ScopedWorkerResources
    }
  | {
      kind: 'team'
      teamId: string
      projectId?: string | null
      sessionId?: string | null
    }

type SessionIdContext = {
  sessionId: SessionId
  projectDir?: string | null
  taskScope?: TaskScope
  environment?: Record<string, string>
}

const sessionIdStorage = new AsyncLocalStorage<SessionIdContext>()

export function getSessionIdContext(): SessionId | undefined {
  return sessionIdStorage.getStore()?.sessionId
}

export function getSessionProjectDirContext(): string | null | undefined {
  return sessionIdStorage.getStore()?.projectDir
}

export function getTaskScopeContext(): TaskScope | undefined {
  return sessionIdStorage.getStore()?.taskScope
}

export function getSessionEnvironmentContext(): Record<string, string> | undefined {
  return sessionIdStorage.getStore()?.environment
}

export function setTaskScopeContext(taskScope: TaskScope | undefined): void {
  const context = sessionIdStorage.getStore()
  if (!context) return
  if (taskScope) {
    context.taskScope = taskScope
  } else {
    delete context.taskScope
  }
}

export function runWithSessionIdContext<T>(
  sessionId: SessionId,
  projectDir: string | null | undefined,
  fn: () => T,
  taskScope?: TaskScope,
  environment?: Record<string, string>,
): T {
  return sessionIdStorage.run({ sessionId, projectDir, taskScope, environment }, fn)
}

function runWithExistingSessionIdContext<T>(
  context: SessionIdContext,
  fn: () => T,
): T {
  return sessionIdStorage.run(context, fn)
}

async function* runGeneratorWithSessionContext<T, TReturn>(
  context: SessionIdContext,
  fn: () => AsyncGenerator<T, TReturn, unknown>,
): AsyncGenerator<T, TReturn, unknown> {
  const iterator = runWithExistingSessionIdContext(context, fn)

  try {
    while (true) {
      const result = await runWithExistingSessionIdContext(context, () =>
        iterator.next(),
      )
      if (result.done) {
        return result.value
      }
      yield result.value
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await runWithExistingSessionIdContext(context, () => iterator.return!())
    }
  }
}

export async function* runWithSessionIdContextGenerator<T, TReturn = void>(
  sessionId: SessionId,
  projectDir: string | null | undefined,
  fn: () => AsyncGenerator<T, TReturn, unknown>,
  taskScope?: TaskScope,
  environment?: Record<string, string>,
): AsyncGenerator<T, TReturn, unknown> {
  const context: SessionIdContext = { sessionId, projectDir, taskScope, environment }
  yield* runGeneratorWithSessionContext(context, fn)
}

export async function* runWithSessionContextOverridesGenerator<T, TReturn = void>(
  overrides: {
    environment: Record<string, string>
    taskScope?: TaskScope
  },
  fn: () => AsyncGenerator<T, TReturn, unknown>,
): AsyncGenerator<T, TReturn, unknown> {
  const parentContext = sessionIdStorage.getStore()
  if (!parentContext) {
    yield* fn()
    return
  }
  const context: SessionIdContext = {
    ...parentContext,
    environment: { ...overrides.environment },
    taskScope: overrides.taskScope ?? parentContext.taskScope,
  }
  yield* runGeneratorWithSessionContext(context, fn)
}
