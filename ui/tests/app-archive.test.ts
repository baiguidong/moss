import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { extractAppArchive, installAppArchive } from '../src/apps/desktop-app-runtime.mjs'

const roots: string[] = []

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-archive-'))
  roots.push(root)
  return root
}

async function writeArchive(root: string, entries: Record<string, string>) {
  const zip = new JSZip()
  for (const [name, value] of Object.entries(entries)) zip.file(name, value)
  const archive = path.join(root, 'app.zip')
  await fs.writeFile(archive, await zip.generateAsync({ type: 'nodebuffer' }))
  return archive
}

afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))))

describe('App archive extraction', () => {
  it('extracts regular package files into staging', async () => {
    const root = await temporaryRoot()
    const archive = await writeArchive(root, {
      'app.moss.json': '{"schemaVersion":2}',
      'dist/ui/index.html': '<main>ok</main>',
    })
    const destination = path.join(root, 'out')
    await extractAppArchive(archive, destination)
    expect(await fs.readFile(path.join(destination, 'dist/ui/index.html'), 'utf8')).toBe('<main>ok</main>')
  })

  it('hands an extracted package to the registry installer when provided', async () => {
    const root = await temporaryRoot()
    const archive = await writeArchive(root, {
      'wrapped/app.moss.json': '{"schemaVersion":2,"id":"example.app"}',
      'wrapped/dist/ui/index.html': '<main>registered</main>',
    })
    let installedRoot = ''
    const result = await installAppArchive({ installFromDirectory: () => { throw new Error('runtime-only install must not run') } }, archive, {
      installPackage: async (packageRoot: string) => {
        installedRoot = packageRoot
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(await fs.readFile(path.join(packageRoot, 'dist/ui/index.html'), 'utf8')).toContain('registered')
        return { id: 'example.app', currentVersion: '1.0.0' }
      },
    })
    expect(path.basename(installedRoot)).toBe('wrapped')
    expect(result).toEqual({ id: 'example.app', currentVersion: '1.0.0' })
  })

  it('rejects traversal and portable absolute paths', async () => {
    const root = await temporaryRoot()
    const traversal = await writeArchive(root, { '../outside.txt': 'unsafe' })
    await expect(extractAppArchive(traversal, path.join(root, 'traversal'))).rejects.toThrow()
    await expect(fs.stat(path.join(root, 'outside.txt'))).rejects.toMatchObject({ code: 'ENOENT' })

    const drive = await writeArchive(root, { 'C:/outside.txt': 'unsafe' })
    await expect(extractAppArchive(drive, path.join(root, 'drive'))).rejects.toThrow()
  })
})
