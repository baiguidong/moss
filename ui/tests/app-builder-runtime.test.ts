import { describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

describe('App Builder runtime guidance', () => {
  it('describes automatic App startup without location concepts', async () => {
    const prompt = await fs.readFile(
      path.resolve(import.meta.dir, '../../assistants/app-builder/assistant.md'),
      'utf8',
    )

    expect(prompt).toContain('App 安装后自动启用')
    expect(prompt).toContain('`backend.protocols` 数组')
  })

  it('keeps the Skill conversion template free of location concepts', async () => {
    const reference = await fs.readFile(path.resolve(
      import.meta.dir,
      '../../skills/convert-skill-to-app/references/backend-generation.md',
    ), 'utf8')

    expect(reference).toContain('starts after installation')
    expect(reference).toContain('Declare required Host protocols as a flat array')
  })

  it('accepts the Backend shape', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-local-app-'))
    try {
      await fs.mkdir(path.join(root, 'dist/backend'), { recursive: true })
      await fs.writeFile(path.join(root, 'dist/backend/main.mjs'), 'export default {}')
      await fs.writeFile(path.join(root, 'app.moss.json'), JSON.stringify({
        schemaVersion: 2,
        id: 'example-app',
        version: '1.0.0',
        displayName: 'Example App',
        hostApi: '^2.1.0',
        backend: {
          entry: 'dist/backend/main.mjs',
          runtime: 'node',
          apiVersion: 1,
          lifecycle: 'persistent',

          protocols: ['moss.platform/v1'],
          actions: [],
        },
        permissions: [],
      }))

      const validator = path.resolve(
        import.meta.dir,
        '../../skills/convert-skill-to-app/scripts/validate_app.py',
      )
      const process = Bun.spawn(['python3', validator, root], { stdout: 'pipe', stderr: 'pipe' })
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      expect(JSON.parse(stdout).ok).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('ignores unused manifest fields', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-invalid-app-'))
    try {
      await fs.mkdir(path.join(root, 'dist/backend'), { recursive: true })
      await fs.writeFile(path.join(root, 'dist/backend/main.mjs'), 'export default {}')
      await fs.writeFile(path.join(root, 'app.moss.json'), JSON.stringify({
        schemaVersion: 2,
        id: 'invalid-app',
        version: '1.0.0',
        displayName: 'Invalid App',
        hostApi: '^2.1.0',
        backend: {
          entry: 'dist/backend/main.mjs',
          runtime: 'node',
          apiVersion: 1,
          lifecycle: 'persistent',

          unused: true,
          actions: [],
        },
        permissions: [],
      }))

      const validator = path.resolve(
        import.meta.dir,
        '../../skills/convert-skill-to-app/scripts/validate_app.py',
      )
      const process = Bun.spawn(['python3', validator, root], { stdout: 'pipe' })
      const [exitCode, stdout] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
      ])
      expect(exitCode).toBe(0)
      expect(JSON.parse(stdout).ok).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
