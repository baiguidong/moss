import { describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

describe('App Builder deployment target guidance', () => {
  it('defaults Backend Apps to Desktop and makes Server support explicit', async () => {
    const promptPath = path.resolve(import.meta.dir, '../../assistants/app-builder/assistant.md')
    const prompt = await fs.readFile(promptPath, 'utf8')

    expect(prompt).toContain('`backend.targets`')
    expect(prompt).toContain('默认使用 `"targets": ["desktop"]`')
    expect(prompt).toContain('不能为了预留能力默认加入 `server`')
    expect(prompt).toContain('Server 是可选部署目标，不是 App Runtime 的默认依赖')
    expect(prompt).toContain('带 UI 的 App 必须包含 `desktop`')
  })

  it('keeps the Skill conversion Backend template Desktop-only by default', async () => {
    const referencePath = path.resolve(
      import.meta.dir,
      '../../skills/convert-skill-to-app/references/backend-generation.md',
    )
    const reference = await fs.readFile(referencePath, 'utf8')

    expect(reference).toContain('"targets": ["desktop"]')
    expect(reference).toContain('Add `server` only for an explicit remote')
    expect(reference).not.toContain('"targets": ["desktop", "server"]')
  })
})
