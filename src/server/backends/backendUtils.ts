import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import {
  MOSS_HOME,
} from '../../utils/skills/localSkillDirectories.js'
import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionRuntimeInfo,
} from '../sessionManager.js'
import { getSystemSettings } from '../systemSettings.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function resolveScodeCliPath(configPath?: string): string {
  if (configPath && fs.existsSync(configPath)) {
    return configPath
  }

  const defaultRelativePath = path.join(process.cwd(), '../sudocode/scode')
  if (fs.existsSync(defaultRelativePath)) {
    return defaultRelativePath
  }

  return 'scode'
}

export function buildSessionEnv(
  options: BackendSpawnOptions,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const settings = getSystemSettings()

  let fileApiKey = ''
  let fileBaseUrl = ''
  try {
    const settingsPath = path.join(os.homedir(), '.moss', 'settings.json')
    if (fs.existsSync(settingsPath)) {
      const content = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      fileApiKey = content.env?.ANTHROPIC_AUTH_TOKEN || content.env?.ANTHROPIC_API_KEY || content.apiKey || ''
      fileBaseUrl = content.env?.ANTHROPIC_BASE_URL || content.url || ''
    }
  } catch {
    // Ignore read errors
  }

  const apiKey = fileApiKey
    || settings.apiKey
    || process.env.ANTHROPIC_API_KEY
    || process.env.ANTHROPIC_AUTH_TOKEN

  // Document Center: in-container scode talks back to moss-server through
  // the `wiki` CLI. The CLI refuses to run unless these two env vars are
  // set. MOSS_SERVER_URL defaults to the local moss process; SESSION_TOKEN
  // is provided by the caller (RuntimeService / WikiJobExecutor) via the
  // `overrides` map — buildSessionEnv itself does not sign tokens.
  const inferredServerUrl =
    process.env.MOSS_SERVER_URL
      || (settings as { serverUrl?: string }).serverUrl
      || ''

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MOSS_HOME,
    ...(apiKey ? { ANTHROPIC_AUTH_TOKEN: apiKey } : {}),
    ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    ...(apiKey ? { PROXY_AUTH_TOKEN: apiKey } : {}),
    ANTHROPIC_BASE_URL: fileBaseUrl
      || settings.url
      || process.env.ANTHROPIC_BASE_URL
      || 'https://hk.sudorouter.ai/v1',
    ...(options.userId ? { MOSS_SESSION_USER_ID: options.userId } : {}),
    ...(options.orgId ? { MOSS_SESSION_ORG_ID: options.orgId } : {}),
    ...(options.role ? { MOSS_SESSION_ROLE: options.role } : {}),
    ...(options.scopes
      ? { MOSS_SESSION_SCOPES: options.scopes.join(',') }
      : {}),
    ...(options.assistantName
      ? { MOSS_ASSISTANT_NAME: options.assistantName }
      : {}),
    ...(inferredServerUrl ? { MOSS_SERVER_URL: inferredServerUrl } : {}),
    MOSS_DEFAULT_MODEL: settings.model || process.env.MOSS_DEFAULT_MODEL || 'gemini-3-flash-preview',
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined),
    ),
  }

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

  const stdoutListeners = new Set<(line: string) => void>()
  const stderrListeners = new Set<(line: string) => void>()
  const exitListeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >()

  const stdoutRl = createInterface({ input: child.stdout })
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