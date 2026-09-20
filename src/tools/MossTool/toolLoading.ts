import { getAdvancedSetting } from '../../services/advancedSettings.js'

export type MossToolLoadingMode = 'always' | 'deferred'

export const MOSS_TOOL_GROUPS = {
  browser: [
    'browser_open',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_press',
    'browser_scroll',
    'browser_wait',
    'browser_reload',
  ],
  app: [
    'app_build',
    'app_preview',
    'app_publish',
    'app_launch',
    'app_update',
    'app_extract_to_workspace',
    'app_get_versions',
  ],
  connector: [
    'connector_cli_setup',
    'connector_mcp_authenticate',
  ],
  image: [
    'image_generate',
    'image_edit',
  ],
  library: [
    'library_list',
    'library_search',
    'library_read',
    'library_write',
  ],
  workflows: [
    'WorkflowRun',
    'WorkflowCreate',
    'WorkflowEdit',
    'WorkflowManage',
  ],
} as const

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
  library_list: 'deferred',
  library_search: 'deferred',
  library_read: 'deferred',
  library_write: 'deferred',
  WorkflowRun: 'deferred',
  WorkflowCreate: 'deferred',
  WorkflowEdit: 'deferred',
  WorkflowManage: 'deferred',
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
  const configured = getAdvancedSetting('moss_tool_loading')?.[name]
  return configured === 'always' || configured === 'deferred'
    ? configured
    : DEFAULT_MOSS_TOOL_LOADING[name]
}

export function shouldDeferMossTool(name: MossToolName): boolean {
  return getMossToolLoadingMode(name) === 'deferred'
}
