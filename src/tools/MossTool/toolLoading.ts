import { getAdvancedSetting } from '../../services/advancedSettings.js'

export type MossToolLoadingMode = 'always' | 'deferred'

export const DEFAULT_MOSS_TOOL_LOADING = {
  browser_open: 'always',
  browser_snapshot: 'always',
  browser_click: 'always',
  browser_type: 'always',
  browser_press: 'deferred',
  browser_scroll: 'deferred',
  browser_wait: 'deferred',
  browser_reload: 'deferred',
  app_build: 'deferred',
  app_preview: 'deferred',
  app_publish: 'deferred',
  app_launch: 'deferred',
  app_update: 'deferred',
  app_extract_to_workspace: 'deferred',
  app_get_versions: 'deferred',
  connector_cli_setup: 'deferred',
  connector_mcp_authenticate: 'deferred',
  image_generate: 'deferred',
  image_edit: 'deferred',
} as const satisfies Record<string, MossToolLoadingMode>

export type MossToolName = keyof typeof DEFAULT_MOSS_TOOL_LOADING

export function getMossToolLoadingMode(name: MossToolName): MossToolLoadingMode {
  const configured = getAdvancedSetting('moss_tool_loading')?.[name]
  return configured === 'always' || configured === 'deferred'
    ? configured
    : DEFAULT_MOSS_TOOL_LOADING[name]
}

export function shouldDeferMossTool(name: MossToolName): boolean {
  return getMossToolLoadingMode(name) === 'deferred'
}
