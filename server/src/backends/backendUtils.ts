import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import fs from 'fs'
import path from 'path'
import { MOSS_HOME, MOSS_SERVER_HOME } from '../lib/env.js'
import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionRuntimeInfo,
} from '../backendTypes.js'

export function resolveNodeCliPath(): string {
  const candidates = [
    path.join(MOSS_SERVER_HOME, 'bin', 'cli-node.js'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return path.join(MOSS_SERVER_HOME, 'bin', 'cli-node.js')
}

export function ensureCliExists(nodeCliPath: string): void {
  if (!fs.existsSync(nodeCliPath)) {
    throw new Error(
      `Missing ${nodeCliPath}. Build or install cli-node.js to ${path.join(MOSS_SERVER_HOME, 'bin')}.`,
    )
  }
}

export function buildSessionEnv(
  options: BackendSpawnOptions,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MOSS_SERVER_HOME,
    MOSS_HOME,
    ...(options.userId ? { MOSS_SESSION_USER_ID: options.userId } : {}),
    ...(options.orgId ? { MOSS_SESSION_ORG_ID: options.orgId } : {}),
    ...(options.role ? { MOSS_SESSION_ROLE: options.role } : {}),
    ...(options.scopes
      ? { MOSS_SESSION_SCOPES: options.scopes.join(',') }
      : {}),
    ...(options.assistantName
      ? { MOSS_ASSISTANT_NAME: options.assistantName }
      : {}),
    ...(options.autoMemory
      ? { MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify(options.autoMemory) }
      : {}),
    ...(options.sessionMemory
      ? {
          MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify(
            options.sessionMemory,
          ),
        }
      : {}),
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined),
    ),
  }
  if (!options.autoMemory) {
    delete env.MOSS_RUNTIME_AUTO_MEMORY_SETTINGS
  }
  if (!options.sessionMemory) {
    delete env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS
  }
  delete env.MOSS_SERVER_URL
  delete env.MOSS_SERVER_AUTH_TOKEN
  return env
}

export function createStreamBackendHandle(
  child: ChildProcess,
  options: BackendSpawnOptions,
  runtime: SessionRuntimeInfo,
): BackendHandle {
  if (!child.stdin || !child.stdout) {
    throw new Error('Failed to start direct-connect child process')
  }
  const stdin = child.stdin
  const stdout = child.stdout

  const stdoutListeners = new Set<(line: string) => void>()
  const stderrListeners = new Set<(line: string) => void>()
  const exitListeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >()

  const stdoutRl = createInterface({ input: stdout })
  stdoutRl.on('line', line => {
    const payload = `${line}\n`
    for (const listener of stdoutListeners) {
      listener(payload)
    }
  })

  if (child.stderr) {
    const stderrRl = createInterface({ input: child.stderr })
    stderrRl.on('line', line => {
      const payload = `${line}\n`
      for (const listener of stderrListeners) {
        listener(payload)
      }
      process.stderr.write(
        `[direct-connect child ${options.sessionId}] ${line}\n`,
      )
    })
  }

  child.on('close', (code, signal) => {
    stdoutRl.close()
    for (const listener of exitListeners) {
      listener(code, signal)
    }
  })

  child.on('error', error => {
    process.stderr.write(
      `[direct-connect child ${options.sessionId}] spawn error: ${error.message}\n`,
    )
  })

  return {
    workDir: options.cwd,
    runtime,
    writeStdin(data: string) {
      if (!stdin.destroyed) {
        stdin.write(data)
      }
    },
    interrupt() {
      if (child.killed) return
      try {
        process.kill(child.pid!, 'SIGINT')
      } catch {}
    },
    onStdoutLine(listener) {
      stdoutListeners.add(listener)
      return () => {
        stdoutListeners.delete(listener)
      }
    },
    onStderrLine(listener) {
      stderrListeners.add(listener)
      return () => {
        stderrListeners.delete(listener)
      }
    },
    onExit(listener) {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    },
    destroy(force = false) {
      if (child.killed) {
        return
      }
      if (process.platform === 'win32') {
        child.kill()
        return
      }
      child.kill(force ? 'SIGKILL' : 'SIGTERM')
    },
  }
}

export function spawnLocalCliProcess(
  options: BackendSpawnOptions,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const nodeCliPath = resolveNodeCliPath()
  ensureCliExists(nodeCliPath)

  const args = [
    nodeCliPath,
    '--print',
    '--verbose',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--permission-prompt-tool',
    'stdio',
  ]

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId)
  } else {
    args.push('--session-id', options.sessionId)
  }

  if (options.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  return spawn(process.execPath, args, {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}
