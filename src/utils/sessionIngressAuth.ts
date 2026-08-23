import {
  getSessionIngressToken,
  setSessionIngressToken,
} from '../bootstrap/state.js'
import { readTokenFromFile } from './authFileDescriptor.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { getFsImplementation } from './fsOperations.js'

/**
 * Read token via file descriptor, falling back to well-known file.
 * Uses global state to cache the result since file descriptors can only be read once.
 */
function getTokenFromFileDescriptor(): string | null {
  // Check if we've already attempted to read the token
  const cachedToken = getSessionIngressToken()
  if (cachedToken !== undefined) {
    return cachedToken
  }

  const fdEnv = process.env.CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR
  if (!fdEnv) {
    const path = process.env.CLAUDE_SESSION_INGRESS_TOKEN_FILE
    const fromFile = path
      ? readTokenFromFile(path, 'session ingress token')
      : null
    setSessionIngressToken(fromFile)
    return fromFile
  }

  const fd = parseInt(fdEnv, 10)
  if (Number.isNaN(fd)) {
    logForDebugging(
      `CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR must be a valid file descriptor number, got: ${fdEnv}`,
      { level: 'error' },
    )
    setSessionIngressToken(null)
    return null
  }

  try {
    // Read from the file descriptor
    // Use /dev/fd on macOS/BSD, /proc/self/fd on Linux
    const fsOps = getFsImplementation()
    const fdPath =
      process.platform === 'darwin' || process.platform === 'freebsd'
        ? `/dev/fd/${fd}`
        : `/proc/self/fd/${fd}`

    const token = fsOps.readFileSync(fdPath, { encoding: 'utf8' }).trim()
    if (!token) {
      logForDebugging('File descriptor contained empty token', {
        level: 'error',
      })
      setSessionIngressToken(null)
      return null
    }
    logForDebugging(`Successfully read token from file descriptor ${fd}`)
    setSessionIngressToken(token)
    return token
  } catch (error) {
    logForDebugging(
      `Failed to read token from file descriptor ${fd}: ${errorMessage(error)}`,
      { level: 'error' },
    )
    const path = process.env.CLAUDE_SESSION_INGRESS_TOKEN_FILE
    const fromFile = path
      ? readTokenFromFile(path, 'session ingress token')
      : null
    setSessionIngressToken(fromFile)
    return fromFile
  }
}

/**
 * Get session ingress authentication token.
 *
 * Priority order:
 *  1. Environment variable (CLAUDE_CODE_SESSION_ACCESS_TOKEN) — set at spawn time,
 *     updated in-process via updateSessionIngressAuthToken or
 *     update_environment_variables stdin message from the parent controller.
 *  2. File descriptor — CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR,
 *     read once and cached.
 *  3. Explicit token file — CLAUDE_SESSION_INGRESS_TOKEN_FILE.
 */
export function getSessionIngressAuthToken(): string | null {
  // 1. Check environment variable
  const envToken = process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
  if (envToken) {
    return envToken
  }

  // 2. Check file descriptor (legacy path), with file fallback
  return getTokenFromFileDescriptor()
}

/**
 * Build auth headers for the current session token.
 * Session keys (sk-ant-sid) use Cookie auth + X-Organization-Uuid;
 * JWTs use Bearer auth.
 */
export function getSessionIngressAuthHeaders(): Record<string, string> {
  const token = getSessionIngressAuthToken()
  if (!token) return {}
  if (token.startsWith('sk-ant-sid')) {
    const headers: Record<string, string> = {
      Cookie: `sessionKey=${token}`,
    }
    const orgUuid = process.env.CLAUDE_CODE_ORGANIZATION_UUID
    if (orgUuid) {
      headers['X-Organization-Uuid'] = orgUuid
    }
    return headers
  }
  return { Authorization: `Bearer ${token}` }
}

/**
 * Update the session ingress auth token in-process by setting the env var.
 * Used by the remote worker controller to inject a fresh token after reconnection
 * without restarting the process.
 */
export function updateSessionIngressAuthToken(token: string): void {
  process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = token
}
