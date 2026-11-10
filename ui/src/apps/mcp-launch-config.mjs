import path from 'node:path'
import { expandMcpHomePath } from '../../../packages/app-sdk/src/mcp/directories.mjs'
export { expandMcpHomePath }

// MCP uses argv, not a shell. Keep portable paths on disk and expand only for execution.
export function resolveMcpLaunchConfig(config, { workspace, appDataDir } = {}) {
  if (config.type && config.type !== 'stdio') return config
  if (workspace && !path.isAbsolute(workspace)) throw new Error('Session workspace must be an absolute path')
  const expand = value => {
    const expanded = expandMcpHomePath(value)
    return appDataDir ? expanded.replaceAll('${MOSS_APP_DATA_DIR}', appDataDir) : expanded
  }
  const expandEnv = value => appDataDir && typeof value === 'string'
    ? value.replaceAll('${MOSS_APP_DATA_DIR}', appDataDir)
    : value
  return {
    ...config,
    // Runtime-only context. Never persist a session directory in shared App settings.
    // An empty value also prevents checks from inheriting a parent's session scope.
    env: {
      ...Object.fromEntries(Object.entries(config.env || {}).map(([key, value]) => [key, expandEnv(value)])),
      ...(appDataDir ? { MOSS_APP_DATA_DIR: appDataDir } : {}),
      MOSS_SESSION_WORKSPACE: workspace || '',
      // App backends use the bundled Electron executable as their Node runtime.
      // MCP stdio children need the same mode or Electron starts a GUI process.
      ...(usesElectronAsNode(config.command) ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
    ...(config.command ? { command: expand(config.command) } : {}),
    ...(config.args ? { args: config.args.map(arg => {
      // Also accept --output-dir=~/... without interpreting shell syntax or arbitrary values.
      const option = arg.match(/^(--[\w-]+=)(.*)$/s)
      return option ? option[1] + expand(option[2]) : expand(arg)
    }) } : {}),
  }
}

export function usesElectronAsNode(command, executable = process.execPath, electron = Boolean(process.versions.electron)) {
  return electron && command === executable
}
