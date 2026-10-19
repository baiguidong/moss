import { getAdvancedSetting } from '../../services/advancedSettings.js'

export type MossToolLoadingMode = 'always' | 'deferred'

export const MOSS_TOOL_GROUPS = {
  presentation: ['moss_present'],
  browser: ['moss_browser_open'],
  connector: [
    'connector_cli_setup',
    'connector_mcp_authenticate',
  ],
  image: [
    'image_generate',
    'image_edit',
  ],
} as const

export const DEFAULT_MOSS_TOOL_LOADING = {
  moss_present: 'always',
  moss_browser_open: 'always',
  connector_cli_setup: 'deferred',
  connector_mcp_authenticate: 'deferred',
  image_generate: 'deferred',
  image_edit: 'deferred',
} as const satisfies Record<string, MossToolLoadingMode>

export type MossToolName = keyof typeof DEFAULT_MOSS_TOOL_LOADING

export function isMossToolName(name: string): name is MossToolName {
  return Object.hasOwn(DEFAULT_MOSS_TOOL_LOADING, name)
}

const MOSS_TOOL_GROUP_BY_NAME = new Map<MossToolName, readonly MossToolName[]>(
  Object.values(MOSS_TOOL_GROUPS).flatMap(group => (
    group.map(name => [name, group] as const)
  )),
)

export function getMossToolGroupMembers(
  name: string,
): readonly MossToolName[] | undefined {
  return MOSS_TOOL_GROUP_BY_NAME.get(name as MossToolName)
}

export function getMossToolLoadingMode(name: MossToolName): MossToolLoadingMode {
  const loading = getAdvancedSetting('moss_tool_loading')
  const configured = loading?.[name]
    ?? (name === 'moss_browser_open' ? loading?.browser_open : undefined)
  return configured === 'always' || configured === 'deferred'
    ? configured
    : DEFAULT_MOSS_TOOL_LOADING[name]
}

export function shouldDeferMossTool(name: MossToolName): boolean {
  return getMossToolLoadingMode(name) === 'deferred'
}
