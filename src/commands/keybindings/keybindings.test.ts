import { expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let keybindingsPath = ''

mock.module('../../keybindings/loadUserBindings.js', () => ({
  getKeybindingsPath: () => keybindingsPath,
  initializeKeybindingWatcher: async () => {},
  reloadKeybindings: async () => {},
}))

mock.module('../../utils/promptEditor.js', () => ({
  editFileInEditor: () => ({ content: null }),
}))

const { call } = await import('./keybindings.js')

test('reports an unavailable editor without claiming the file was opened', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'moss-keybindings-command-'))
  keybindingsPath = join(configDir, 'keybindings.json')

  try {
    const result = await call()

    expect(result.value).toContain(`Created ${keybindingsPath}`)
    expect(result.value).toContain('No editor is available')
    expect(result.value).toContain('VISUAL or EDITOR')
    expect(result.value).not.toContain('Opened')
    expect(await readFile(keybindingsPath, 'utf-8')).toContain('"bindings"')
  } finally {
    await rm(configDir, { recursive: true, force: true })
  }
})
