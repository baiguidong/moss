import {
  getApiKeyFromFd,
  setApiKeyFromFd,
} from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { errorMessage, isENOENT } from './errors.js'
import { getFsImplementation } from './fsOperations.js'

/**
 * Reads a token from an explicitly configured file path.
 * File-not-found is treated as "no token"; other errors are debug logged.
 */
export function readTokenFromFile(
  path: string,
  tokenName: string,
): string | null {
  try {
    const fsOps = getFsImplementation()
    // eslint-disable-next-line custom-rules/no-sync-fs -- explicit auth file read, one-shot at startup, caller is sync
    const token = fsOps.readFileSync(path, { encoding: 'utf8' }).trim()
    if (!token) {
      return null
    }
    logForDebugging(`Read ${tokenName} from file ${path}`)
    return token
  } catch (error) {
    if (!isENOENT(error)) {
      logForDebugging(
        `Failed to read ${tokenName} from ${path}: ${errorMessage(error)}`,
        { level: 'debug' },
      )
    }
    return null
  }
}

/**
 * Shared file-descriptor credential reader.
 *
 * Priority order:
 *  1. File descriptor env var. The pipe is drained on first read.
 *
 * Returns null if no descriptor has a credential. Cached in global state.
 */
function getCredentialFromFd({
  envVar,
  label,
  getCached,
  setCached,
}: {
  envVar: string
  label: string
  getCached: () => string | null | undefined
  setCached: (value: string | null) => void
}): string | null {
  const cached = getCached()
  if (cached !== undefined) {
    return cached
  }

  const fdEnv = process.env[envVar]
  if (!fdEnv) {
    setCached(null)
    return null
  }

  const fd = parseInt(fdEnv, 10)
  if (Number.isNaN(fd)) {
    logForDebugging(
      `${envVar} must be a valid file descriptor number, got: ${fdEnv}`,
      { level: 'error' },
    )
    setCached(null)
    return null
  }

  try {
    // Use /dev/fd on macOS/BSD, /proc/self/fd on Linux
    const fsOps = getFsImplementation()
    const fdPath =
      process.platform === 'darwin' || process.platform === 'freebsd'
        ? `/dev/fd/${fd}`
        : `/proc/self/fd/${fd}`

    // eslint-disable-next-line custom-rules/no-sync-fs -- legacy FD path, read once at startup, caller is sync
    const token = fsOps.readFileSync(fdPath, { encoding: 'utf8' }).trim()
    if (!token) {
      logForDebugging(`File descriptor contained empty ${label}`, {
        level: 'error',
      })
      setCached(null)
      return null
    }
    logForDebugging(`Successfully read ${label} from file descriptor ${fd}`)
    setCached(token)
    return token
  } catch (error) {
    logForDebugging(
      `Failed to read ${label} from file descriptor ${fd}: ${errorMessage(error)}`,
      { level: 'error' },
    )
    setCached(null)
    return null
  }
}

/**
 * Get an API key passed via file descriptor.
 * Env var: CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR.
 */
export function getApiKeyFromFileDescriptor(): string | null {
  return getCredentialFromFd({
    envVar: 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
    label: 'API key',
    getCached: getApiKeyFromFd,
    setCached: setApiKeyFromFd,
  })
}
