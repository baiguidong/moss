import { feature } from 'bun:bundle'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { getAdvancedSetting } from '../../services/advancedSettings.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/featureFlags.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { EXPLORE_AGENT } from './built-in/exploreAgent.js'
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js'
import { PLAN_AGENT } from './built-in/planAgent.js'
import { STATUSLINE_SETUP_AGENT } from './built-in/statuslineSetup.js'
import { VERIFICATION_AGENT } from './built-in/verificationAgent.js'
import type { AgentDefinition } from './loadAgentsDir.js'

export function areExplorePlanAgentsEnabled(): boolean {
  if (feature('BUILTIN_EXPLORE_PLAN_AGENTS')) {
    // 3P default: true — Bedrock/Vertex keep agents enabled (matches pre-experiment
    // external behavior). A/B test treatment sets false to measure impact of removal.
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_stoat', true)
  }
  return false
}

/**
 * Return every built-in agent shipped in this build, including agents that
 * are currently disabled by a setting. Desktop management surfaces use this
 * catalog so an opt-in agent such as `verification` remains discoverable.
 */
export function getBuiltInAgentCatalog(): AgentDefinition[] {
  const agents: AgentDefinition[] = [
    GENERAL_PURPOSE_AGENT,
    STATUSLINE_SETUP_AGENT,
  ]

  if (areExplorePlanAgentsEnabled()) {
    agents.push(EXPLORE_AGENT, PLAN_AGENT)
  }

  if (feature('VERIFICATION_AGENT')) {
    agents.push(VERIFICATION_AGENT)
  }

  return agents
}

export function getBuiltInAgents(): AgentDefinition[] {
  // Allow disabling all built-in agents via env var (useful for SDK users who want a blank slate)
  // Only applies in noninteractive mode (SDK/API usage)
  if (
    isEnvTruthy(process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS) &&
    getIsNonInteractiveSession()
  ) {
    return []
  }

  return getBuiltInAgentCatalog().filter(
    agent =>
      agent.agentType !== 'verification' ||
      getAdvancedSetting('moss_hive_evidence'),
  )
}
