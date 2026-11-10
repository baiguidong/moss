import { isDeepStrictEqual } from 'node:util'

const object = value => value && typeof value === 'object' && !Array.isArray(value)

function merge(previous, current, next) {
  if (isDeepStrictEqual(previous, current)) return structuredClone(next)
  if (object(previous) && object(current) && object(next)) {
    return Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(current), ...Object.keys(next)])]
      .map(key => [key, merge(previous[key], current[key], next[key])])
      .filter(([, value]) => value !== undefined))
  }
  return structuredClone(current)
}

/** Update package defaults while retaining explicit user edits, including deletions. */
export function mergeMcpDefaults(previous, current, next) {
  // Transport-specific fields cannot be merged across stdio/HTTP/SSE variants.
  // A customized connection needs an explicit switch to the new transport.
  if (!isDeepStrictEqual(previous, current) && (current.type !== previous.type || next.type !== previous.type)) return structuredClone(current)
  // A packaged Python service replaces `python -I -m module` with a bundled
  // launcher. Preserve service arguments (e.g. Excel's --allow-dir) without
  // feeding old interpreter flags to Node. Explicit custom services stay intact.
  if (previous.python && !next.python && next.command === 'node'
    && /(?:^|[/\\])runtime[/\\]launch\.cjs$/.test(next.args?.[0] || '')
    && previous.args?.[0] === '-I' && previous.args?.[1] === '-m') {
    if (current.command !== previous.command || !isDeepStrictEqual(current.python, previous.python)
      || !isDeepStrictEqual(current.args?.slice(0, 3), previous.args.slice(0, 3))) return structuredClone(current)
    const result = merge(previous, current, next)
    if (!isDeepStrictEqual(current.args, previous.args)) result.args = [next.args[0], ...current.args.slice(3)]
    return result
  }
  return merge(previous, current, next)
}

/** Older App Backends used a JSON settings argument; replace their obsolete launch paths. */
export function adoptMcpSettings(current, next) {
  const result = structuredClone(next)
  for (const field of ['disabledTools', 'env', 'headers']) {
    if (current[field] !== undefined) result[field] = field === 'disabledTools' ? current[field] : { ...next[field], ...current[field] }
  }
  if (next.roots) {
    if (current.roots) result.roots = { ...next.roots, directories: current.roots.directories }
    else if (current.type === 'stdio' && current.args?.[1]) {
      let settings
      try { settings = JSON.parse(current.args[1]) } catch { /* Not a legacy directory service. */ }
      if (settings && Object.hasOwn(settings, 'directories')) {
        result.roots.directories = settings.directories
        if (current.disabledTools === undefined && settings.disabledTools !== undefined) result.disabledTools = settings.disabledTools
        for (const binding of result.pathBindings || []) {
          if (binding.kind === 'git-repository' && typeof settings.gitExecutable === 'string') binding.executable = settings.gitExecutable
        }
      }
    }
  }
  return result
}
