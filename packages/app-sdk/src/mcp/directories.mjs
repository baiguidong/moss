import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

export function expandMcpHomePath(value, homeDir = homedir()) {
  if (value === '~') return homeDir
  if (!value.startsWith('~/') && !value.startsWith('~\\')) return value
  const paths = /^[a-z]:[\\/]|^\\\\/i.test(homeDir) ? path.win32 : path.posix
  return paths.join(homeDir, value.slice(2).replaceAll('\\', '/'))
}

export function normalizeMcpRoots(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['directories', 'includeWorkspace', 'delivery'].includes(key))
    || typeof value.includeWorkspace !== 'boolean' || !['roots', 'arguments'].includes(value.delivery)
    || !Array.isArray(value.directories) || value.directories.length > 32
    || value.directories.some(item => typeof item !== 'string' || !item.trim() || item.length > 4096 || /[\x00\r\n]/.test(item))) {
    throw new Error('目录配置无效：请填写最多 32 个目录路径。')
  }
  const directories = [...new Set(value.directories.map(item => item.trim()))]
  if (directories.some(item => !path.posix.isAbsolute(item) && !path.win32.isAbsolute(item) && !/^~([\\/]|$)/.test(item))) {
    throw new Error('目录请使用绝对路径或 ~/ 开头的路径。')
  }
  return { includeWorkspace: value.includeWorkspace, delivery: value.delivery, directories }
}

/** Resolve once per connection; shared settings never contain a session workspace. */
export async function resolveMcpDirectories(value, workspace = '') {
  const config = normalizeMcpRoots(value)
  const directories = []
  for (const value of [...(config.includeWorkspace && workspace ? [workspace] : []), ...config.directories]) {
    const expanded = expandMcpHomePath(value)
    if (!path.isAbsolute(expanded)) throw new Error(`当前系统不支持此目录路径：${value}`)
    const absolute = path.normalize(expanded)
    try {
      const canonical = await fs.realpath(absolute)
      if (!(await fs.stat(canonical)).isDirectory()) throw new Error('Not a directory')
    } catch { throw new Error(`目录不存在或不可访问：${value}`) }
    if (!directories.includes(absolute)) directories.push(absolute)
  }
  return directories
}

export async function prepareMcpDirectoryLaunch(config, workspace = '') {
  if (!config.roots) return null
  const directories = await resolveMcpDirectories(config.roots, workspace)
  return {
    args: [...(config.args || []), ...(config.roots.delivery === 'arguments' ? directories : [])],
    // Argument-based servers already have their complete scope at initialization.
    // Do not let a later roots/list request replace it with the Host's cwd.
    roots: config.roots.delivery === 'arguments' ? [] : directories.map(directory => ({ uri: pathToFileURL(directory).href })),
  }
}
