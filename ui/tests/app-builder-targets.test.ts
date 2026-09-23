import { describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

describe('App Builder deployment target guidance', () => {
  it('defaults Backend Apps to Desktop and makes Server support explicit', async () => {
    const promptPath = path.resolve(import.meta.dir, '../../assistants/app-builder/assistant.md')
    const prompt = await fs.readFile(promptPath, 'utf8')

    expect(prompt).toContain('`backend.targets`')
    expect(prompt).toContain('默认使用 `"targets": ["desktop"]`')
    expect(prompt).toContain('不能为了预留能力默认加入 `server`')
    expect(prompt).toContain('Server 是可选部署目标，不是 App Runtime 的默认依赖')
    expect(prompt).toContain('互斥的候选运行位置')
    expect(prompt).toContain('一个 App instance 同一时刻只能在一个位置 active')
    expect(prompt).toContain('UI 与 Backend placement 独立')
    expect(prompt).toContain('有 UI 不等于 Backend 必须包含 `desktop`')
    expect(prompt).toContain('`persistent` 只表示在当前 Host 内常驻')
    expect(prompt).toContain('不表示启动两个 Backend')
    expect(prompt).toContain('需求含糊时固定选择 `desktop`')
    expect(prompt).toContain('`backend.protocols` 必须按 target 声明')
  })

  it('keeps the Skill conversion Backend template Desktop-only by default', async () => {
    const referencePath = path.resolve(
      import.meta.dir,
      '../../skills/convert-skill-to-app/references/backend-generation.md',
    )
    const reference = await fs.readFile(referencePath, 'utf8')

    expect(reference).toContain('"targets": ["desktop"]')
    expect(reference).toContain('Add `server` only for an explicit always-on')
    expect(reference).toContain('One App instance is active on Desktop or Server at a time')
    expect(reference).toContain('UI presence does not require a Desktop Backend')
    expect(reference).toContain('does not mean two processes')
    expect(reference).toContain('Declare `backend.protocols` per target')
    expect(reference).not.toContain('"targets": ["desktop", "server"]')
  })

  it('accepts a Desktop UI with a Server-only Backend', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-server-only-app-'))
    try {
      await fs.mkdir(path.join(root, 'dist/ui'), { recursive: true })
      await fs.mkdir(path.join(root, 'dist/backend'), { recursive: true })
      await fs.writeFile(path.join(root, 'dist/ui/index.html'), '<main>Server-backed App</main>')
      await fs.writeFile(path.join(root, 'dist/backend/main.mjs'), 'export default {}')
      await fs.writeFile(path.join(root, 'app.moss.json'), JSON.stringify({
        schemaVersion: 2,
        id: 'server-backed-ui',
        version: '1.0.0',
        displayName: 'Server-backed UI',
        hostApi: '^2.0.0',
        ui: { entry: 'dist/ui/index.html' },
        backend: {
          entry: 'dist/backend/main.mjs',
          runtime: 'node',
          apiVersion: 1,
          lifecycle: 'persistent',
          instanceMode: 'multiple',
          targets: ['server'],
          protocols: { server: ['moss.agent/v1'] },
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

  it('rejects Desktop-only protocols for a Server Backend', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-invalid-server-app-'))
    try {
      await fs.mkdir(path.join(root, 'dist/backend'), { recursive: true })
      await fs.writeFile(path.join(root, 'dist/backend/main.mjs'), 'export default {}')
      await fs.writeFile(path.join(root, 'app.moss.json'), JSON.stringify({
        schemaVersion: 2,
        id: 'invalid-server-app',
        version: '1.0.0',
        displayName: 'Invalid Server App',
        hostApi: '^2.0.0',
        backend: {
          entry: 'dist/backend/main.mjs',
          runtime: 'node',
          apiVersion: 1,
          lifecycle: 'persistent',
          instanceMode: 'multiple',
          targets: ['server'],
          protocols: { server: ['moss.desktop/v1'] },
          actions: [],
        },
        permissions: [],
      }))

      const validator = path.resolve(
        import.meta.dir,
        '../../skills/convert-skill-to-app/scripts/validate_app.py',
      )
      const process = Bun.spawn(['python3', validator, root], { stdout: 'pipe', stderr: 'pipe' })
      const [exitCode, stdout] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
      ])
      expect(exitCode).toBe(1)
      expect(JSON.parse(stdout).errors).toContain(
        'Server Backend cannot declare Desktop-only protocols: moss.desktop/v1',
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
