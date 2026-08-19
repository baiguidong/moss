import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'fs/promises'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const serverSrc = join(dirname(fileURLToPath(import.meta.url)), '..')
const applicationSrc = resolve(serverSrc, '..', '..', 'src')

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') result.push(...(await collectTypeScriptFiles(path)))
    } else if (entry.name.endsWith('.ts')) {
      result.push(path)
    }
  }
  return result
}

describe('server package boundary', () => {
  test('does not import application source modules', async () => {
    const violations: string[] = []
    for (const file of await collectTypeScriptFiles(serverSrc)) {
      const source = await readFile(file, 'utf8')
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]
        if (!specifier?.startsWith('.')) continue
        const target = resolve(dirname(file), specifier)
        if (target === applicationSrc || target.startsWith(`${applicationSrc}/`)) {
          violations.push(relative(serverSrc, file))
        }
      }
    }
    expect(violations).toEqual([])
  })
})
