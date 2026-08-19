import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'

export function normalizePath(input) {
  const trimmed = String(input || '').trim()
  if (!trimmed) {
    return ''
  }
  if (trimmed === '~') {
    return homedir().normalize('NFC')
  }
  if (trimmed.startsWith('~/')) {
    return join(homedir(), trimmed.slice(2)).normalize('NFC')
  }
  return (isAbsolute(trimmed) ? trimmed : resolve(trimmed)).normalize('NFC')
}

export function getMossServerHome(env = process.env) {
  return normalizePath(env.MOSS_SERVER_HOME || join(homedir(), '.moss', 'server'))
}

export function getServerRuntimeEnv(env = process.env) {
  const serverHome = getMossServerHome(env)
  return {
    ...env,
    MOSS_SERVER_HOME: serverHome,
    MOSS_HOME: serverHome,
    MOSS_CONFIG_DIR: serverHome,
  }
}
