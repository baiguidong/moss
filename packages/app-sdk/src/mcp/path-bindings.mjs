import fs from 'node:fs/promises'
import path from 'node:path'
import { devNull } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expandMcpHomePath, resolveMcpDirectories } from './directories.mjs'
import { normalizeMcpLocalOptions } from './local-options.mjs'

const execute = promisify(execFile)
const within = (root, value) => {
  const relative = path.relative(root, value)
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
const gitBinding = config => config.pathBindings?.find(binding => binding.kind === 'git-repository')
const gitExecutable = config => expandMcpHomePath(gitBinding(config)?.executable?.trim() || config.env?.GIT_PYTHON_GIT_EXECUTABLE || 'git')

/** Match the subprocess environment used for validation and for the upstream service. */
export function mcpLocalEnvironment(config, inherited = process.env) {
  const combined = { ...inherited, ...config.env }
  if (!gitBinding(config)) return combined
  const env = Object.fromEntries(Object.entries(combined).filter(([key]) => !key.toUpperCase().startsWith('GIT_')))
  const settings = { 'core.hooksPath': devNull, 'core.fsmonitor': 'false', 'commit.gpgSign': 'false', 'color.ui': 'false' }
  Object.entries(settings).forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key; env[`GIT_CONFIG_VALUE_${index}`] = value
  })
  return { ...env, GIT_CONFIG_COUNT: String(Object.keys(settings).length), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1', GIT_PAGER: 'cat', GIT_EDITOR: 'false', GIT_PYTHON_GIT_EXECUTABLE: gitExecutable(config) }
}

async function git(config, directory, args, env, signal, optional = false) {
  try {
    return (await execute(gitExecutable(config), ['--no-pager', ...(directory ? ['-C', directory] : []), ...args], {
      env, signal, timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8',
    })).stdout.trim()
  } catch (error) {
    if (optional && error.code === 1) return ''
    throw new Error(error.code === 'ENOENT' ? '未找到 Git。请安装 Git、修正 PATH 或指定 Git 程序路径。' : error.stderr?.trim() || error.message)
  }
}

async function validateGitExternalPrograms(config, directory, tool, env, signal) {
  if (tool !== 'git_commit' && tool !== 'git_show' && !tool.startsWith('git_diff')) return
  // GitPython reads repository configuration itself when running commit hooks;
  // GIT_CONFIG_COUNT only controls its Git subprocesses. Inspect the real config.
  const original = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_CONFIG_')))
  if (tool === 'git_commit') {
    const configured = await git(config, directory, ['config', '--path', '--get', 'core.hooksPath'], original, signal, true)
    const hooks = configured ? path.resolve(directory, configured)
      : path.join(await git(config, directory, ['rev-parse', '--absolute-git-dir'], original, signal), 'hooks')
    for (const name of ['pre-commit', 'commit-msg', 'post-commit']) {
      try { await fs.access(path.join(hooks, name), fs.constants.X_OK) } catch { continue }
      throw new Error('此仓库配置了提交钩子，官方服务会直接执行钩子。请使用常规 Git 客户端提交。')
    }
  } else {
    const helpers = await git(config, directory, ['config', '--get-regexp', '^diff\\.(external|.*\\.(textconv|command))$'], original, signal, true)
    if (helpers) throw new Error('此仓库配置了外部 diff/textconv。请使用常规 Git 客户端查看差异。')
  }
}

export async function validateMcpPathSettings(config) {
  normalizeMcpLocalOptions(config)
  const directories = config.roots ? await resolveMcpDirectories(config.roots) : []
  if (!gitBinding(config)) return
  const env = mcpLocalEnvironment(config)
  if (!(await git(config, undefined, ['--version'], env)).startsWith('git version ')) throw new Error('指定的程序不是 Git。')
  for (const directory of directories) {
    const root = await fs.realpath(await git(config, directory, ['rev-parse', '--show-toplevel'], env))
    if (root !== await fs.realpath(directory)) throw new Error('请配置 Git 仓库根目录，不要填写仓库内的子目录。')
  }
}

/** Bind every tools/call at the client boundary, including direct SDK callers. */
export function installMcpPathBindings(client, config, workspace = '', environment = mcpLocalEnvironment(config)) {
  if (!config.pathBindings) return
  normalizeMcpLocalOptions(config)
  const request = client.request.bind(client), queues = new Map()
  const effectiveWorkspace = config.roots.includeWorkspace ? workspace : ''
  const description = `\nDefault directory: ${effectiveWorkspace || 'No session workspace; specify an authorized path explicitly.'}\nPublic directories: ${config.roots.directories.join(', ') || '(none)'}`
  client.request = async (message, schema, options) => {
    if (message.method === 'tools/list') {
      const result = await request(message, schema, options)
      return { ...result, tools: result.tools.map(tool => ({ ...tool, description: (tool.description || '') + description,
        inputSchema: { ...tool.inputSchema, required: tool.inputSchema.required?.filter(key => !config.pathBindings.some(binding => binding.argument === key)) } })) }
    }
    if (message.method !== 'tools/call') return request(message, schema, options)
    const args = { ...(message.params?.arguments || {}) }, bound = []
    const shared = await Promise.all((await resolveMcpDirectories(config.roots)).map(directory => fs.realpath(directory)))
    const base = effectiveWorkspace ? await fs.realpath(effectiveWorkspace) : ''
    for (const binding of config.pathBindings) {
      const value = args[binding.argument]
      if (value !== undefined && (typeof value !== 'string' || !value.trim() || /[\x00\r\n]/.test(value))) throw new Error(`目录参数 ${binding.argument} 无效。`)
      if (value === undefined && !base) throw new Error('没有会话工作目录，请显式指定已授权的仓库路径。')
      const expanded = value === undefined ? base : expandMcpHomePath(value)
      if (!path.isAbsolute(expanded) && !base) throw new Error('没有会话工作目录，请使用绝对路径。')
      let directory = await fs.realpath(path.isAbsolute(expanded) ? expanded : path.resolve(base, expanded))
      const allowed = value => Boolean(base && within(base, value)) || (binding.kind === 'git-repository' ? shared.includes(value) : shared.some(root => within(root, value)))
      if (!allowed(directory)) throw new Error('目录不在当前会话工作目录或已授权的公共目录范围内。')
      if (!(await fs.stat(directory)).isDirectory()) throw new Error('指定路径不是目录。')
      if (binding.kind === 'git-repository') {
        directory = await fs.realpath(await git(config, directory, ['rev-parse', '--show-toplevel'], environment, options?.signal))
        if (!allowed(directory)) throw new Error('Git 仓库根目录超出当前会话工作目录，请添加为公共仓库。')
        await validateGitExternalPrograms(config, directory, message.params.name, environment, options?.signal)
      }
      args[binding.argument] = directory; bound.push(directory)
    }
    const key = bound.join('\0')
    const pending = (queues.get(key) || Promise.resolve()).then(() => {
      options?.signal?.throwIfAborted()
      return request({ ...message, params: { ...message.params, arguments: args } }, schema, options)
    })
    const settled = pending.catch(() => {})
    queues.set(key, settled)
    try { return await pending } finally { if (queues.get(key) === settled) queues.delete(key) }
  }
}
