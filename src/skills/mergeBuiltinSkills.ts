import path from 'node:path'
import type { Command } from '../types/command.js'

/** A local customization takes precedence over the same shipped skill. */
export function mergeBuiltinSkills(bundled: Command[], local: Command[], bundleDirectory = process.env.MOSS_BUNDLED_SKILLS_DIR): Command[] {
  const isResource = (command: Command) => command.type === 'prompt' && !!command.skillRoot && !!bundleDirectory && path.dirname(path.resolve(command.skillRoot)) === path.resolve(bundleDirectory)
  const customNames = new Set(local.filter(command => !isResource(command)).map(command => command.name))
  const visibleLocal = local.filter(command => !isResource(command) || !customNames.has(command.name))
  const localNames = new Set(visibleLocal.map(command => command.name))
  return [...bundled.filter(command => !localNames.has(command.name)), ...visibleLocal]
}
