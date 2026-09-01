import { isEnvTruthy } from './envUtils.js'

/**
 * Check if --agent-teams flag is provided via CLI.
 * Checks process.argv directly to avoid import cycles with bootstrap/state.
 */
function isAgentTeamsFlagSet(): boolean {
  return process.argv.includes('--agent-teams')
}

/**
 * Centralized runtime check for agent teams/teammate features.
 * This is the single gate that should be checked everywhere teammates
 * are referenced (prompts, code, tools isEnabled, UI, etc.).
 *
 * Requires explicit opt-in via CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS or
 * the --agent-teams CLI flag.
 */
export function isAgentSwarmsEnabled(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) ||
    isAgentTeamsFlagSet()
  )
}
