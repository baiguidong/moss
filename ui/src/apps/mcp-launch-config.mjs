import { homedir } from 'node:os'
import path from 'node:path'

// MCP uses argv, not a shell. Keep portable paths on disk and expand only for execution.
export function expandMcpHomePath(value, homeDir = homedir()) {
  if (value === '~') return homeDir
  if (!value.startsWith('~/') && !value.startsWith('~\\')) return value
  const paths = /^[a-z]:[\\/]|^\\\\/i.test(homeDir) ? path.win32 : path.posix
  return paths.join(homeDir, value.slice(2).replaceAll('\\', '/'))
}

export function resolveMcpLaunchConfig(config) {
  if (config.type && config.type !== 'stdio') return config
  const expand = value => expandMcpHomePath(value)
  return {
    ...config,
    ...(config.command ? { command: expand(config.command) } : {}),
    ...(config.args ? { args: config.args.map(arg => {
      // Also accept --output-dir=~/... without interpreting shell syntax or arbitrary values.
      const option = arg.match(/^(--[\w-]+=)(.*)$/s)
      return option ? option[1] + expand(option[2]) : expand(arg)
    }) } : {}),
  }
}
