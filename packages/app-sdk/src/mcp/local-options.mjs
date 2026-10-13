import { normalizeMcpRoots } from './directories.mjs'
import path from 'node:path'

export function normalizeMcpLocalOptions(config) {
  const result = {}
  if (config.python !== undefined) {
    const value = config.python
    if (!value || typeof value !== 'object' || Object.keys(value).some(key => key !== 'requirements')
      || !Array.isArray(value.requirements) || !value.requirements.length || value.requirements.length > 32
      || value.requirements.some(item => typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9][A-Za-z0-9.!+_-]*$/.test(item))) {
      throw new Error('Python 依赖必须使用 package==version 固定版本。')
    }
    result.python = { requirements: [...new Set(value.requirements)] }
  }
  if (config.pathBindings !== undefined) {
    const bindings = config.pathBindings
    if (!Array.isArray(bindings) || !bindings.length || bindings.length > 16
      || bindings.some(value => !value || typeof value !== 'object'
        || Object.keys(value).some(key => !['argument', 'kind', 'executable'].includes(key))
        || typeof value.argument !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.argument)
        || !['directory', 'git-repository'].includes(value.kind)
        || (value.executable !== undefined && (value.kind !== 'git-repository' || typeof value.executable !== 'string' || value.executable.length > 4096 || /[\x00\r\n]/.test(value.executable))))) {
      throw new Error('工具目录参数绑定无效。')
    }
    if (new Set(bindings.map(value => value.argument)).size !== bindings.length) throw new Error('工具目录参数不能重复绑定。')
    for (const binding of bindings) {
      const executable = binding.executable?.trim()
      if (executable && !path.posix.isAbsolute(executable) && !path.win32.isAbsolute(executable) && !/^~[\\/]/.test(executable)) throw new Error('Git 程序请填写完整路径，或留空使用 PATH。')
    }
    if (new Set(bindings.filter(value => value.kind === 'git-repository').map(value => value.executable?.trim() || '')).size > 1) throw new Error('同一服务的 Git 程序路径必须一致。')
    normalizeMcpRoots(config.roots)
    result.pathBindings = structuredClone(bindings)
  }
  if (Object.keys(result).length && config.type && config.type !== 'stdio') throw new Error('本地运行与路径绑定仅支持 stdio 服务。')
  return result
}

export function mcpMinimumHostVersion(config) {
  return config.python || config.pathBindings ? '3.11.0' : config.roots ? '3.10.0' : '3.9.0'
}
