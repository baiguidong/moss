import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import {
  getKeybindingsPath,
  initializeKeybindingWatcher,
  reloadKeybindings,
} from '../../keybindings/loadUserBindings.js'
import { generateKeybindingsTemplate } from '../../keybindings/template.js'
import { getErrnoCode } from '../../utils/errors.js'
import { editFileInEditor } from '../../utils/promptEditor.js'

export async function call(): Promise<{ type: 'text'; value: string }> {
  const keybindingsPath = getKeybindingsPath()

  // Write template with 'wx' flag (exclusive create) — fails with EEXIST if
  // the file already exists. Avoids a stat pre-check (TOCTOU race + extra syscall).
  let fileExists = false
  await mkdir(dirname(keybindingsPath), { recursive: true })
  try {
    await writeFile(keybindingsPath, generateKeybindingsTemplate(), {
      encoding: 'utf-8',
      flag: 'wx',
    })
  } catch (e: unknown) {
    if (getErrnoCode(e) === 'EEXIST') {
      fileExists = true
    } else {
      throw e
    }
  }

  await initializeKeybindingWatcher()

  // Open in editor
  const result = await editFileInEditor(keybindingsPath)
  await reloadKeybindings()
  const fileStatus = fileExists ? 'Found' : 'Created'
  if (result.error) {
    return {
      type: 'text',
      value: `${fileStatus} ${keybindingsPath}. Could not open in editor: ${result.error}`,
    }
  }
  if (result.content === null) {
    return {
      type: 'text',
      value: `${fileStatus} ${keybindingsPath}. No editor is available. Set VISUAL or EDITOR and run /keybindings again.`,
    }
  }
  return {
    type: 'text',
    value: fileExists
      ? `Opened ${keybindingsPath} in your editor.`
      : `Created ${keybindingsPath} with template. Opened in your editor.`,
  }
}
