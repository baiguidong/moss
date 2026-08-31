import {
  autoMemorySettingsSchema,
  normalizeAutoMemorySettings,
  type AutoMemorySettings,
  type SessionProfileMode,
} from '../../packages/direct-connect-protocol/src/index.js'

function readGlobalAutoMemoryOverride(): Partial<AutoMemorySettings> {
  const raw = process.env.MOSS_AUTO_MEMORY_SETTINGS
  if (!raw) return {}
  try {
    const parsed = autoMemorySettingsSchema().safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export function validateAutoMemoryProfile(
  profileMode: SessionProfileMode,
  autoMemory?: Partial<AutoMemorySettings>,
): void {
  const effectiveAutoMemory = normalizeAutoMemorySettings({
    ...autoMemory,
    ...readGlobalAutoMemoryOverride(),
  })
  if (
    effectiveAutoMemory.enabled &&
    effectiveAutoMemory.dreamEnabled &&
    profileMode !== 'user'
  ) {
    throw new Error('Dream consolidation requires profileMode "user"')
  }
}
