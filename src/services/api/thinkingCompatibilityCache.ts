import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getMossConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import type { ThinkingFallbackMode } from './thinkingFallback.js'

export const THINKING_COMPATIBILITY_TTL_MS = 24 * 60 * 60 * 1000

export interface ThinkingCacheEntry {
  path: string
}

function cacheDirectory(): string {
  return join(getMossConfigHomeDir(), 'cache', 'thinking-compatibility')
}

/** Use the actual client endpoint and credentials, including session overrides. */
export function getThinkingCacheEntry(
  client: { baseURL?: string; apiKey?: string | null; authToken?: string | null },
  model: string,
  thinkingMode: ThinkingConfig['type'],
): ThinkingCacheEntry | undefined {
  if (!client.baseURL) return undefined

  // Hash all routing/auth configuration. Never persist credentials or URLs,
  // which can themselves contain credentials. Do not include conversation IDs.
  const fingerprint = createHash('sha256').update(JSON.stringify([
    getAPIProvider(),
    client.baseURL.replace(/\/+$/, ''),
    client.apiKey ?? null,
    client.authToken ?? null,
    model,
    thinkingMode,
    process.env.ANTHROPIC_CUSTOM_HEADERS ?? null,
    process.env.CLAUDE_CODE_EXTRA_BODY ?? null,
    ...[
      'AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_BEARER_TOKEN_BEDROCK',
      'ANTHROPIC_FOUNDRY_RESOURCE', 'ANTHROPIC_FOUNDRY_BASE_URL',
      'ANTHROPIC_FOUNDRY_API_KEY', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID',
      'ANTHROPIC_VERTEX_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_APPLICATION_CREDENTIALS',
    ].map(name => process.env[name] ?? null),
  ])).digest('hex')
  return { path: join(cacheDirectory(), `${fingerprint}.json`) }
}

export async function readThinkingCache(
  entry: ThinkingCacheEntry,
  now = Date.now(),
): Promise<ThinkingFallbackMode | undefined> {
  try {
    const value = JSON.parse(await readFile(entry.path, 'utf8'))
    if (
      value?.version === 1 &&
      (value.mode === 'disabled' || value.mode === 'omit') &&
      typeof value.expiresAt === 'number' &&
      value.expiresAt > now &&
      value.expiresAt <= now + THINKING_COMPATIBILITY_TTL_MS
    ) {
      return value.mode
    }
  } catch {
    // Missing, corrupt, or unreadable cache entries never prevent a request.
  }
  return undefined
}

export async function writeThinkingCache(
  entry: ThinkingCacheEntry,
  mode: ThinkingFallbackMode,
  now = Date.now(),
): Promise<void> {
  const temporaryPath = `${entry.path}.${randomUUID()}.tmp`
  try {
    // One file per key avoids losing other entries when session processes write
    // concurrently. Rename prevents readers from seeing a partial JSON file.
    await mkdir(dirname(entry.path), { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, JSON.stringify({
      version: 1, mode, expiresAt: now + THINKING_COMPATIBILITY_TTL_MS,
    }), { mode: 0o600 })
    await rename(temporaryPath, entry.path)
  } catch {
    logForDebugging('Could not save thinking compatibility cache')
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

export async function removeThinkingCache(entry: ThinkingCacheEntry): Promise<void> {
  await rm(entry.path, { force: true }).catch(() => {})
}

export async function clearThinkingCompatibilityCache(): Promise<void> {
  await rm(cacheDirectory(), { recursive: true, force: true })
}
