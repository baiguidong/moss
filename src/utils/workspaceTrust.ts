import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Explicit CLI trust is scoped to this invocation, never read from a repository. */
export function isWorkspaceTrustedByDirectories(cwd: string, directories: string[]): boolean {
  const workspace = realpathSync(cwd)
  return directories.map(directory => {
    const root = realpathSync(resolve(cwd, directory))
    if (!statSync(root).isDirectory()) throw new Error(`Not a directory: ${directory}`)
    return root
  }).some(root => {
    const child = relative(root, workspace)
    return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
  })
}
