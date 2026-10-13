import { homedir } from 'node:os'
import path from 'node:path'

// MCP uses argv, not a shell. Keep portable paths on disk and expand only for execution.
export function expandMcpHomePath(value, homeDir = homedir()) {
  if (value === '~') return homeDir
  if (!value.startsWith('~/') && !value.startsWith('~\\')) return value
  const paths = /^[a-z]:[\\/]|^\\\\/i.test(homeDir) ? path.win32 : path.posix
  return paths.join(homeDir, value.slice(2).replaceAll('\\', '/'))
}

export function resolveMcpLaunchConfig(config, { workspace } = {}) {
  if (config.type && config.type !== 'stdio') return config
  if (workspace && !path.isAbsolute(workspace)) throw new Error('Session workspace must be an absolute path')
  const expand = value => expandMcpHomePath(value)
  return {
    ...config,
    // Runtime-only context. Never persist a session directory in shared App settings.
    // An empty value also prevents checks from inheriting a parent's session scope.
    env: { ...config.env, MOSS_SESSION_WORKSPACE: workspace || '' },
    ...(config.command ? { command: expand(config.command) } : {}),
    ...(config.args ? { args: config.args.map(arg => {
      // Also accept --output-dir=~/... without interpreting shell syntax or arbitrary values.
      const option = arg.match(/^(--[\w-]+=)(.*)$/s)
      return option ? option[1] + expand(option[2]) : expand(arg)
    }) } : {}),
  }
}
