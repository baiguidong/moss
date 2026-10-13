import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import fingerprints from './retired-app-authoring-resources.json' with { type: 'json' }

/** Recognize only unchanged former system copies. Never delete user files. */
export function isRetiredAppAuthoringResource(directory, mossHome = process.env.MOSS_HOME || process.env.MOSS_CONFIG_DIR || path.join(os.homedir(), '.moss')) {
  try {
    const root = fs.realpathSync(mossHome), resolved = fs.realpathSync(directory)
    const relative = path.relative(root, resolved).split(path.sep)
    if (relative.length !== 2 && !(relative.length === 3 && relative[1] === 'system')) return false
    const expected = fingerprints[`${relative[0]}/${relative.at(-1)}`]
    if (!expected) return false
    const actual = {}
    function visit(current, prefix = '') {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name === '__pycache__') continue
        const name = prefix + entry.name, file = path.join(current, entry.name)
        if (entry.isSymbolicLink()) throw new Error('Modified resource')
        if (entry.isDirectory()) visit(file, `${name}/`)
        else if (entry.isFile()) actual[name] = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      }
    }
    visit(resolved)
    return Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([name, hash]) => actual[name] === hash)
  } catch { return false }
}
