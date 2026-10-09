import { getSettingsForSource } from '../../utils/settings/settings.js'
export function assertWorkflowPolicy(env: Record<string, string | undefined>, policy: { disableWorkflows?: boolean; enableWorkflows?: boolean } | null | undefined) {
  const truthy = (value?: string) => ['1', 'true', 'yes', 'on'].includes(value?.toLowerCase().trim() ?? '')
  if (truthy(env.MOSS_DISABLE_WORKFLOWS) || truthy(env.CLAUDE_CODE_DISABLE_WORKFLOWS)) throw new Error('Workflow 已由环境变量禁用')
  if (policy?.disableWorkflows === true || policy?.enableWorkflows === false) throw new Error('Workflow 已由托管策略禁用')
}
export function assertWorkflowAppPolicy() {
  assertWorkflowPolicy(process.env, getSettingsForSource('policySettings'))
}
