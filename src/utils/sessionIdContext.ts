import { AsyncLocalStorage } from 'async_hooks'
import type { SessionId } from '../types/ids.js'

export type TaskScope =
  | {
      kind: 'session'
      sessionId: string
      projectId?: string | null
    }
  | {
      kind: 'project'
      projectId: string
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
): T {
  return sessionIdStorage.run({ sessionId, projectDir, taskScope }, fn)
}

function runWithExistingSessionIdContext<T>(
  context: SessionIdContext,
  fn: () => T,
): T {
  return sessionIdStorage.run(context, fn)
}

export async function* runWithSessionIdContextGenerator<T, TReturn = void>(
  sessionId: SessionId,
  projectDir: string | null | undefined,
  fn: () => AsyncGenerator<T, TReturn, unknown>,
  taskScope?: TaskScope,
): AsyncGenerator<T, TReturn, unknown> {
  const context: SessionIdContext = { sessionId, projectDir, taskScope }
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
