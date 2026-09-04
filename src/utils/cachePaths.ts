import { join } from 'path'
import { getMossConfigHomeDir } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { djb2Hash } from './hash.js'

// All diagnostic logs live under ~/.moss/logs/, alongside moss.log, so they can
// be inspected in one place.
function logsRoot(): string {
  return join(getMossConfigHomeDir(), 'logs')
}

// Local sanitizePath using djb2Hash — NOT the shared version from
// sessionStoragePortable.ts which uses Bun.hash (wyhash) when available.
// Directory names must remain stable across upgrades so existing log data
// (error logs, MCP logs) is not orphaned.
const MAX_SANITIZED_LENGTH = 200
function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${Math.abs(djb2Hash(name)).toString(36)}`
}

function getProjectDir(cwd: string): string {
  return sanitizePath(cwd)
}

export const CACHE_PATHS = {
  baseLogs: () => join(logsRoot(), getProjectDir(getFsImplementation().cwd())),
  errors: () =>
    join(logsRoot(), getProjectDir(getFsImplementation().cwd()), 'errors'),
  messages: () =>
    join(logsRoot(), getProjectDir(getFsImplementation().cwd()), 'messages'),
  mcpLogs: (serverName: string) =>
    join(
      logsRoot(),
      getProjectDir(getFsImplementation().cwd()),
      // Sanitize server name for Windows compatibility (colons are reserved for drive letters)
      `mcp-logs-${sanitizePath(serverName)}`,
    ),
}
