import { getSessionRuntimeContext } from '../../utils/sessionIdContext.js'
import { z } from 'zod/v4'
import { setScheduledTasksEnabled } from '../../bootstrap/state.js'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { cronToHuman, parseCronExpression } from '../../utils/cron.js'
import {
  addCronTask,
  getCronFilePath,
  getDesktopCronHostId,
  listAllCronTasks,
  nextCronRunMs,
} from '../../utils/cronTasks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'
import { getTeammateContext } from '../../utils/teammateContext.js'
import {
  buildCronCreateDescription,
  buildCronCreatePrompt,
  CRON_CREATE_TOOL_NAME,
  DEFAULT_MAX_AGE_DAYS,
  isDurableCronEnabled,
  isCronEnabled,
} from './prompt.js'
import { renderCreateResultMessage, renderCreateToolUseMessage } from './UI.js'

const MAX_JOBS = 50

const inputSchema = lazySchema(() =>
  z.strictObject({
    cron: z
      .string()
      .describe(
        'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once).',
      ),
    timezone: z.string().optional().describe('Cloud schedules: IANA timezone, e.g. Asia/Shanghai. Omit to use the server timezone. Desktop uses the computer timezone.'),
    expires_at: z.iso.datetime({ offset: true }).optional().describe(
      'Moss Desktop: exclusive end time as ISO 8601 with timezone, e.g. 2026-11-05T00:00:00+08:00 for "today only" on Nov 4. The task stops automatically at this time; do not create a second cleanup task.',
    ),
    prompt: z.string().describe('The prompt to enqueue at each fire time.'),
    recurring: semanticBoolean(z.boolean().optional()).describe(
      `true (default) = repeat. Cloud tasks run until cancelled; desktop tasks stop at expires_at, or after ${DEFAULT_MAX_AGE_DAYS} days if omitted; CLI tasks expire after ${DEFAULT_MAX_AGE_DAYS} days. false = fire once at the next match, then auto-delete. Use false for "remind me at X" one-shot requests with pinned minute/hour/dom/month.`,
    ),
    durable: semanticBoolean(z.boolean().optional()).describe(
      'Desktop and cloud tasks always persist across restarts; this flag is ignored there. Use expires_at for a desktop validity deadline. CLI only: true persists, false (default) is session-only.',
    ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    humanSchedule: z.string(),
    recurring: z.boolean(),
    durable: z.boolean().optional(),
    expiresAt: z.number().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type CreateOutput = z.infer<OutputSchema>

export const CronCreateTool = buildTool({
  name: CRON_CREATE_TOOL_NAME,
  searchHint: 'schedule a recurring or one-shot prompt',
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isCronEnabled()
  },
  async description() {
    return buildCronCreateDescription(isDurableCronEnabled())
  },
  async prompt() {
    return buildCronCreatePrompt(isDurableCronEnabled())
  },
  getPath() {
    return getSessionRuntimeContext()?.cron ? '' : getCronFilePath()
  },
  async validateInput(input): Promise<ValidationResult> {
    if (!parseCronExpression(input.cron)) {
      return {
        result: false,
        message: `Invalid cron expression '${input.cron}'. Expected 5 fields: M H DoM Mon DoW.`,
        errorCode: 1,
      }
    }
    if (!getSessionRuntimeContext()?.cron && nextCronRunMs(input.cron, Date.now()) === null) {
      return {
        result: false,
        message: `Cron expression '${input.cron}' does not match any calendar date in the next year.`,
        errorCode: 2,
      }
    }
    if (input.expires_at !== undefined) {
      if (!getDesktopCronHostId() || getSessionRuntimeContext()?.cron) {
        return { result: false, message: 'expires_at is supported by Moss Desktop scheduling only.', errorCode: 5 }
      }
      const expiresAt = Date.parse(input.expires_at)
      const next = nextCronRunMs(input.cron, Date.now())
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || next === null || next >= expiresAt) {
        return { result: false, message: 'expires_at must be in the future, with at least one scheduled run strictly before it.', errorCode: 6 }
      }
    }
    const tasks = await listAllCronTasks()
    const activeTasks = getDesktopCronHostId()
      ? tasks.filter(task => task.status !== 'expired' && (task.expiresAt === undefined || task.expiresAt > Date.now()))
      : tasks
    if (activeTasks.length >= MAX_JOBS) {
      return {
        result: false,
        message: `Too many scheduled jobs (max ${MAX_JOBS}). Cancel one first.`,
        errorCode: 3,
      }
    }
    // Teammates don't persist across sessions, so a durable teammate cron
    // would orphan on restart (agentId would point to a nonexistent teammate).
    if (input.durable && getTeammateContext() && !getSessionRuntimeContext()?.cron && !getDesktopCronHostId()) {
      return {
        result: false,
        message:
          'durable crons are not supported for teammates (teammates do not persist across sessions)',
        errorCode: 4,
      }
    }
    return { result: true }
  },
  async call({ cron, prompt, recurring = true, durable, timezone, expires_at }) {
    // Desktop/cloud always persist, including older callers passing false.
    // The durability feature gate only controls CLI storage.
    const cloud = Boolean(getSessionRuntimeContext()?.cron)
    const effectiveDurable = cloud || Boolean(getDesktopCronHostId()) || (Boolean(durable) && isDurableCronEnabled())
    const expiresAt = expires_at === undefined ? undefined : Date.parse(expires_at)
    const id = await addCronTask(
      cron,
      prompt,
      recurring,
      effectiveDurable,
      getTeammateContext()?.agentId,
      timezone,
      expiresAt,
    )
    // Enable the scheduler so the task fires in this session. The
    // useScheduledTasks hook polls this flag and starts watching on the
    // next tick; desktop tasks are already in the persistent shared store.
    if (!cloud) setScheduledTasksEnabled(true)
    return {
      data: {
        id,
        humanSchedule: cronToHuman(cron),
        recurring,
        durable: effectiveDurable,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (getSessionRuntimeContext()?.cron) return {
      tool_use_id: toolUseID, type: 'tool_result',
      content: `Created cloud task ${output.id} (${output.humanSchedule}). Persistent; runs on Moss Server while desktop is offline. ${output.recurring ? 'Repeats until cancelled.' : 'Removed after successful execution.'} Failures pause the task for review.`,
    }
    const where = getDesktopCronHostId()
      ? 'Saved by Moss Desktop; survives restarts. Runs while the desktop app is running.'
      : output.durable
      ? 'Persisted to .moss/scheduled_tasks.json'
      : 'Session-only (not written to disk, dies when Claude exits)'
    const lifetime = output.expiresAt !== undefined
      ? `Stops automatically at ${new Date(output.expiresAt).toISOString()} and remains listed as expired. No cleanup task is needed.`
      : `Auto-expires after ${DEFAULT_MAX_AGE_DAYS} days.`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.recurring
        ? `Scheduled recurring job ${output.id} (${output.humanSchedule}). ${where} ${lifetime} Use CronDelete to cancel sooner.`
        : `Scheduled one-shot task ${output.id} (${output.humanSchedule}). ${where} It will fire once then auto-delete.${output.expiresAt !== undefined ? ` ${lifetime}` : ''}`,
    }
  },
  renderToolUseMessage: renderCreateToolUseMessage,
  renderToolResultMessage: renderCreateResultMessage,
} satisfies ToolDef<InputSchema, CreateOutput>)
