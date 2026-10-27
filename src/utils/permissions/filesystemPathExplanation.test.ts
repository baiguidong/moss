import { expect, test } from 'bun:test'
import { mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getPathsForPermissionCheck,
} from '../fsOperations.js'
import {
  pathForPermissionMessage,
  permissionPathDetails,
} from './filesystem.js'

test('symlink permission explanations expose the canonical target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-permission-path-'))
  const target = await mkdtemp(join(tmpdir(), 'moss-permission-target-'))
  const link = join(root, 'linked.txt')
  await symlink(join(target, 'target.txt'), link)
  const paths = getPathsForPermissionCheck(link)

  expect(paths[0]).toBe(link)
  expect(paths.some(path => path.includes('moss-permission-target-'))).toBe(true)
  expect(pathForPermissionMessage(link, paths)).toContain('resolves to')
  expect(permissionPathDetails(link, paths, paths.at(-1))).toEqual({
    displayPath: link,
    resolvedPath: paths.at(-1),
    decisionPath: paths.at(-1),
  })
})

