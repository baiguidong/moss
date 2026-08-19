import { homedir } from 'os'
import { isAbsolute, join, normalize, resolve } from 'path'
import { createHash } from 'crypto'

export function expandPath(input: string, baseDir = process.cwd()): string {
  const trimmed = input.trim()
  if (!trimmed) return normalize(baseDir).normalize('NFC')
  if (trimmed === '~') return homedir().normalize('NFC')
  if (trimmed.startsWith('~/')) {
    return join(homedir(), trimmed.slice(2)).normalize('NFC')
  }
  return (isAbsolute(trimmed) ? normalize(trimmed) : resolve(baseDir, trimmed)).normalize('NFC')
}

export function sanitizePath(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= 200) return sanitized
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 12)
  return `${sanitized.slice(0, 200)}-${hash}`
}
