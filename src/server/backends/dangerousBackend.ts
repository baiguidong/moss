import { spawn } from 'child_process'
import { createInterface } from 'readline'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionBackend,
} from '../sessionManager.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function resolveNodeCliPath(): string {
  const configured = process.env.CLAUDE_CODE_CLI_PATH
  const candidates = [
    configured,
    path.join(process.cwd(), 'cli-node.js'),
    path.join(__dirname, 'cli-node.js'),
    path.join(__dirname, '../cli-node.js'),
    path.join(__dirname, '../../cli-node.js'),
    path.join(__dirname, '../../../cli-node.js'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0] || path.join(process.cwd(), 'cli-node.js')
}

function ensureCliExists(nodeCliPath: string): void {
  if (!fs.existsSync(nodeCliPath)) {
    throw new Error(
      `Missing ${nodeCliPath}. Run "bun run build:node" before starting the session server.`,
    )
  }
}

export class DangerousBackend implements SessionBackend {
  async spawn(options: BackendSpawnOptions): Promise<BackendHandle> {
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
      '--session-id',
      options.sessionId,
    ]

    if (options.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions')
    }

    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    if (!child.stdin || !child.stdout) {
      throw new Error('Failed to start direct-connect child process')
    }

    const stdoutListeners = new Set<(line: string) => void>()
    const exitListeners = new Set<
      (code: number | null, signal: NodeJS.Signals | null) => void
    >()

    const stdoutRl = createInterface({ input: child.stdout })
    stdoutRl.on('line', (line) => {
      const payload = `${line}\n`
      for (const listener of stdoutListeners) {
        listener(payload)
      }
    })

    if (child.stderr) {
      const stderrRl = createInterface({ input: child.stderr })
      stderrRl.on('line', (line) => {
        process.stderr.write(`[direct-connect child ${options.sessionId}] ${line}\n`)
      })
    }

    child.on('close', (code, signal) => {
      stdoutRl.close()
      for (const listener of exitListeners) {
        listener(code, signal)
      }
    })

    child.on('error', (error) => {
      process.stderr.write(
        `[direct-connect child ${options.sessionId}] spawn error: ${error.message}\n`,
      )
    })

    return {
      workDir: options.cwd,
      writeStdin(data: string) {
        if (!child.stdin?.destroyed) {
          child.stdin.write(data)
        }
      },
      onStdoutLine(listener) {
        stdoutListeners.add(listener)
        return () => {
          stdoutListeners.delete(listener)
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
}
