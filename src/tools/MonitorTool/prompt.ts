import {
  MONITOR_DEFAULT_TIMEOUT_MS,
  MONITOR_HEADLESS_MAX_TIMEOUT_MS,
  MONITOR_MAX_TIMEOUT_MS,
} from "./constants.js";

export const DESCRIPTION = `Stream events from a background shell command. Each stdout line becomes a notification and the monitor ends when the command exits or its deadline expires. Use Bash with run_in_background for a one-shot command that only needs a completion notification. Monitor commands always have a deadline (interactive max ${MONITOR_MAX_TIMEOUT_MS / 60000} minutes; single-prompt max ${MONITOR_HEADLESS_MAX_TIMEOUT_MS / 60000} minutes).`;

export function getMonitorPrompt(): string {
  return `Use Monitor to watch a command whose stdout is an event stream. Each complete line printed to stdout is delivered as one event; stderr is saved in the output file and is only shown when the monitor ends. The monitor is killed at timeout_ms and reports how many events it delivered. Re-arm it if you still need a long-running watch.

Arguments:
- command: shell command or script to run
- description: short human-readable description
- timeout_ms: deadline in milliseconds (default ${MONITOR_DEFAULT_TIMEOUT_MS}; max ${MONITOR_MAX_TIMEOUT_MS} interactive or ${MONITOR_HEADLESS_MAX_TIMEOUT_MS} in a single-prompt run)
- max_events: optional cap; the monitor ends after this many stdout lines

For one event, make the command exit after printing it. Do not use an unbounded tail or polling loop when a single Bash background task is sufficient. Use TaskStop to cancel a monitor early.`;
}
