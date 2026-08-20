import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/featureFlags.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import type { ToolUseContext } from '../../Tool.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js'
import { REMOTE_TRIGGER_TOOL_NAME } from '../../tools/RemoteTriggerTool/prompt.js'
import { checkGithubAppInstalled } from '../../utils/background/remote/preconditions.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  detectCurrentRepositoryWithHost,
  parseGitRemote,
} from '../../utils/detectRepository.js'
import { getRemoteUrl } from '../../utils/git.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  createDefaultCloudEnvironment,
  type EnvironmentResource,
  fetchEnvironments,
} from '../../utils/teleport/environments.js'
import { registerBundledSkill } from '../bundledSkills.js'

const BASE_QUESTION = 'What would you like to do with scheduled remote agents?'

/**
 * Formats setup notes as a bulleted Heads-up block. Shared between the
 * initial AskUserQuestion dialog text (no-args path) and the prompt-body
 * section (args path) so notes are never silently dropped.
 */
function formatSetupNotes(notes: string[]): string {
  const items = notes.map(n => `- ${n}`).join('\n')
  return `⚠ Heads-up:\n${items}`
}

async function getCurrentRepoHttpsUrl(): Promise<string | null> {
  const remoteUrl = await getRemoteUrl()
  if (!remoteUrl) {
    return null
  }
  const parsed = parseGitRemote(remoteUrl)
  if (!parsed) {
    return null
  }
  return `https://${parsed.host}/${parsed.owner}/${parsed.name}`
}

function buildPrompt(opts: {
  userTimezone: string
  gitRepoUrl: string | null
  environmentsInfo: string
  createdEnvironment: EnvironmentResource | null
  setupNotes: string[]
  needsGitHubAccessReminder: boolean
  userArgs: string
}): string {
  const {
    userTimezone,
    gitRepoUrl,
    environmentsInfo,
    createdEnvironment,
    setupNotes,
    needsGitHubAccessReminder,
    userArgs,
  } = opts
  // When the user passes args, the initial AskUserQuestion dialog is skipped.
  // Setup notes must surface in the prompt body instead, otherwise they're
  // computed and silently discarded (regression vs. the old hard-block).
  const setupNotesSection =
    userArgs && setupNotes.length > 0
      ? `\n## Setup Notes\n\n${formatSetupNotes(setupNotes)}\n`
      : ''
  const initialQuestion =
    setupNotes.length > 0
      ? `${formatSetupNotes(setupNotes)}\n\n${BASE_QUESTION}`
      : BASE_QUESTION
  const firstStep = userArgs
    ? `The user has already told you what they want (see User Request at the bottom). Skip the initial question and go directly to the matching workflow.`
    : `Your FIRST action must be a single ${ASK_USER_QUESTION_TOOL_NAME} tool call (no preamble). Use this EXACT string for the \`question\` field — do not paraphrase or shorten it:

${jsonStringify(initialQuestion)}

Set \`header: "Action"\` and offer the four actions (create/list/update/run) as options. After the user picks, follow the matching workflow below.`

  return `# Schedule Remote Agents

You are helping the user schedule, update, list, or run **remote** Claude Code agents. These are NOT local cron jobs — each trigger spawns a fully isolated remote session (CCR) in Anthropic's cloud infrastructure on a cron schedule. The agent runs in a sandboxed environment with its own git checkout, tools, and optional MCP connections.

## First Step

${firstStep}
${setupNotesSection}

## What You Can Do

Use the \`${REMOTE_TRIGGER_TOOL_NAME}\` tool (load it first with \`ToolSearch select:${REMOTE_TRIGGER_TOOL_NAME}\`; auth is handled in-process — do not use curl):

- \`{action: "list"}\` — list all triggers
- \`{action: "get", trigger_id: "..."}\` — fetch one trigger
- \`{action: "create", body: {...}}\` — create a trigger
- \`{action: "update", trigger_id: "...", body: {...}}\` — partial update
- \`{action: "run", trigger_id: "..."}\` — run a trigger now

You CANNOT delete triggers. If the user asks to delete, direct them to the scheduled agents management UI.

## Create body shape

\`\`\`json
{
  "name": "AGENT_NAME",
  "cron_expression": "CRON_EXPR",
  "enabled": true,
  "job_config": {
    "ccr": {
      "environment_id": "ENVIRONMENT_ID",
      "session_context": {
        "model": "claude-sonnet-4-6",
        "sources": [
          {"git_repository": {"url": "${gitRepoUrl || 'https://github.com/ORG/REPO'}"}}
        ],
        "allowed_tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]
      },
      "events": [
        {"data": {
          "uuid": "<lowercase v4 uuid>",
          "session_id": "",
          "type": "user",
          "parent_tool_use_id": null,
          "message": {"content": "PROMPT_HERE", "role": "user"}
        }}
      ]
    }
  }
}
\`\`\`

Generate a fresh lowercase UUID for \`events[].data.uuid\` yourself.

## MCP Connectors

This build does not import MCP connectors from Claude.ai. If the user needs MCP access for a scheduled agent, ask them to configure the required connectors in the selected Moss environment before creating the trigger.

## Environments

Every trigger requires an \`environment_id\` in the job config. This determines where the remote agent runs. Ask the user which environment to use.

${environmentsInfo}

Use the \`id\` value as the \`environment_id\` in \`job_config.ccr.environment_id\`.
${createdEnvironment ? `\n**Note:** A new environment \`${createdEnvironment.name}\` (id: \`${createdEnvironment.environment_id}\`) was just created for the user because they had none. Use this id for \`job_config.ccr.environment_id\` and mention the creation when you confirm the trigger config.\n` : ''}

## API Field Reference

### Create Trigger — Required Fields
- \`name\` (string) — A descriptive name
- \`cron_expression\` (string) — 5-field cron. **Minimum interval is 1 hour.**
- \`job_config\` (object) — Session configuration (see structure above)

### Create Trigger — Optional Fields
- \`enabled\` (boolean, default: true)
- \`mcp_connections\` (array) — MCP servers to attach:
  \`\`\`json
  [{"connector_uuid": "uuid", "name": "server-name", "url": "https://..."}]
  \`\`\`

### Update Trigger — Optional Fields
All fields optional (partial update):
- \`name\`, \`cron_expression\`, \`enabled\`, \`job_config\`
- \`mcp_connections\` — Replace MCP connections
- \`clear_mcp_connections\` (boolean) — Remove all MCP connections

### Cron Expression Examples

The user's local timezone is **${userTimezone}**. Cron expressions are always in UTC. When the user says a local time, convert it to UTC for the cron expression but confirm with them: "9am ${userTimezone} = Xam UTC, so the cron would be \`0 X * * 1-5\`."

- \`0 9 * * 1-5\` — Every weekday at 9am **UTC**
- \`0 */2 * * *\` — Every 2 hours
- \`0 0 * * *\` — Daily at midnight **UTC**
- \`30 14 * * 1\` — Every Monday at 2:30pm **UTC**
- \`0 8 1 * *\` — First of every month at 8am **UTC**

Minimum interval is 1 hour. \`*/30 * * * *\` will be rejected.

## Workflow

### CREATE a new trigger:

1. **Understand the goal** — Ask what they want the remote agent to do. What repo(s)? What task? Remind them that the agent runs remotely — it won't have access to their local machine, local files, or local environment variables.
2. **Craft the prompt** — Help them write an effective agent prompt. Good prompts are:
   - Specific about what to do and what success looks like
   - Clear about which files/areas to focus on
   - Explicit about what actions to take (open PRs, commit, just analyze, etc.)
3. **Set the schedule** — Ask when and how often. The user's timezone is ${userTimezone}. When they say a time (e.g., "every morning at 9am"), assume they mean their local time and convert to UTC for the cron expression. Always confirm the conversion: "9am ${userTimezone} = Xam UTC."
4. **Choose the model** — Default to \`claude-sonnet-4-6\`. Tell the user which model you're defaulting to and ask if they want a different one.
5. **Validate connections** — Infer what services the agent will need from the user's description. For example, if they say "check monitoring and Slack me errors," the agent needs both monitoring and Slack MCP connectors. Cross-reference with the connectors list above. If any are missing, warn the user and ask them to connect them in Moss settings first.${gitRepoUrl ? ` The default git repo is already set to \`${gitRepoUrl}\`. Ask the user if this is the right repo or if they need a different one.` : ' Ask which git repos the remote agent needs cloned into its environment.'}
6. **Review and confirm** — Show the full configuration before creating. Let them adjust.
7. **Create it** \u2014 Call \`${REMOTE_TRIGGER_TOOL_NAME}\` with \`action: "create"\` and show the result. The response includes the trigger ID.

### UPDATE a trigger:

1. List triggers first so they can pick one
2. Ask what they want to change
3. Show current vs proposed value
4. Confirm and update

### LIST triggers:

1. Fetch and display in a readable format
2. Show: name, schedule (human-readable), enabled/disabled, next run, repo(s)

### RUN NOW:

1. List triggers if they haven't specified which one
2. Confirm which trigger
3. Execute and confirm

## Important Notes

- These are REMOTE agents — they run in Anthropic's cloud, not on the user's machine. They cannot access local files, local services, or local environment variables.
- Always convert cron to human-readable when displaying
- Default to \`enabled: true\` unless user says otherwise
- Accept GitHub URLs in any format (https://github.com/org/repo, org/repo, etc.) and normalize to the full HTTPS URL (without .git suffix)
- The prompt is the most important part — spend time getting it right. The remote agent starts with zero context, so the prompt must be self-contained.
- To delete a trigger, direct users to the scheduled agents management UI.
${needsGitHubAccessReminder ? `- If the user's request seems to require GitHub repo access (e.g. cloning a repo, opening PRs, reading code), remind them that they need the Claude GitHub App installed on the repo — otherwise the remote agent won't be able to access it.` : ''}
${userArgs ? `\n## User Request\n\nThe user said: "${userArgs}"\n\nStart by understanding their intent and working through the appropriate workflow above.` : ''}`
}

export function registerScheduleRemoteAgentsSkill(): void {
  registerBundledSkill({
    name: 'schedule',
    description:
      'Create, update, list, or run scheduled remote agents (triggers) that execute on a cron schedule.',
    whenToUse:
      'When the user wants to schedule a recurring remote agent, set up automated tasks, create a cron job for Claude Code, or manage their scheduled agents/triggers.',
    userInvocable: true,
    isEnabled: () => false,
    allowedTools: [REMOTE_TRIGGER_TOOL_NAME, ASK_USER_QUESTION_TOOL_NAME],
    async getPromptForCommand(args: string, context: ToolUseContext) {
      if (true) {
        return [
          {
            type: 'text',
            text: 'Scheduled remote agents are not supported in this build.',
          },
        ]
      }

      let environments: EnvironmentResource[]
      try {
        environments = await fetchEnvironments()
      } catch (err) {
        logForDebugging(`[schedule] Failed to fetch environments: ${err}`, {
          level: 'warn',
        })
        return [
          {
            type: 'text',
            text: 'Scheduled remote agents are not supported in this build.',
          },
        ]
      }

      let createdEnvironment: EnvironmentResource | null = null
      if (environments.length === 0) {
        try {
          createdEnvironment = await createDefaultCloudEnvironment(
            'claude-code-default',
          )
          environments = [createdEnvironment]
        } catch (err) {
          logForDebugging(`[schedule] Failed to create environment: ${err}`, {
            level: 'warn',
          })
          return [
            {
              type: 'text',
              text: 'No remote environments found, and we could not create one automatically. Configure one in Moss server settings, then run /schedule again.',
            },
          ]
        }
      }

      // Soft setup checks — collected as upfront notes embedded in the initial
      // AskUserQuestion dialog. Never block — triggers don't require a git
      // source (e.g., Slack-only polls), and the trigger's sources may point
      // at a different repo than cwd anyway.
      const setupNotes: string[] = []
      let needsGitHubAccessReminder = false

      const repo = await detectCurrentRepositoryWithHost()
      if (repo === null) {
        setupNotes.push(
          `Not in a git repo — you'll need to specify a repo URL manually (or skip repos entirely).`,
        )
      } else if (repo.host === 'github.com') {
        const hasAccess = await checkGithubAppInstalled(
          repo.owner,
          repo.name,
        )
        if (!hasAccess) {
          needsGitHubAccessReminder = true
          setupNotes.push(
            `Claude GitHub App not installed on ${repo.owner}/${repo.name}. Install it if your trigger needs this repo.`,
          )
        }
      }
      // Non-github.com hosts (GHE/GitLab/etc.): silently skip. The GitHub
      // App check is github.com-specific, and the "not in a git repo" note
      // would be factually wrong — getCurrentRepoHttpsUrl() below will
      // still populate gitRepoUrl with the GHE URL.

      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const gitRepoUrl = await getCurrentRepoHttpsUrl()
      const lines = ['Available environments:']
      for (const env of environments) {
        lines.push(
          `- ${env.name} (id: ${env.environment_id}, kind: ${env.kind})`,
        )
      }
      const environmentsInfo = lines.join('\n')
      const prompt = buildPrompt({
        userTimezone,
        gitRepoUrl,
        environmentsInfo,
        createdEnvironment,
        setupNotes,
        needsGitHubAccessReminder,
        userArgs: args,
      })
      return [{ type: 'text', text: prompt }]
    },
  })
}
