import { escapeXml } from "../../utils/xml.js";
import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from "../../constants/xml.js";
import type { AppState } from "../../state/AppState.js";
import { createTaskStateBase } from "../../Task.js";
import type { AgentId } from "../../types/ids.js";
import { registerCleanup } from "../../utils/cleanupRegistry.js";
import { enqueuePendingNotification } from "../../utils/messageQueueManager.js";
import { exec, type ExecOptions, type ExecResult } from "../../utils/Shell.js";
import type { ShellCommand } from "../../utils/ShellCommand.js";
import { shouldUseSandbox } from "../../tools/BashTool/shouldUseSandbox.js";
import {
  evictTaskOutput,
  initTaskOutput,
} from "../../utils/task/diskOutput.js";
import { registerTask, updateTaskState } from "../../utils/task/framework.js";
import type { LocalShellTaskState } from "../LocalShellTask/guards.js";
import { killTask } from "../LocalShellTask/killShellTasks.js";

export type MonitorTaskInput = {
  command: string;
  description: string;
  timeoutMs: number;
  maxEvents?: number;
  toolUseId?: string;
  agentId?: AgentId;
  sandboxConfig?: ExecOptions["sandboxConfig"];
  setAppState: (updater: (prev: AppState) => AppState) => void;
};

export type MonitorLineEvent = {
  taskId: string;
  line: string;
  eventNumber: number;
};

export type MonitorTaskHandle = {
  taskId: string;
  outputFile: string;
};

/** Split complete newline-delimited events while preserving a partial tail. */
export function consumeMonitorLines(
  buffer: string,
  final = false,
): { lines: string[]; remainder: string } {
  const parts = buffer.split(/\r?\n/);
  const remainder = final ? "" : (parts.pop() ?? "");
  const lines = parts.filter((line) => line.length > 0);
  if (final && parts.length === 0 && buffer.length > 0) {
    return { lines: [buffer], remainder: "" };
  }
  if (final && remainder.length > 0) lines.push(remainder);
  return { lines, remainder };
}

function notificationBase(
  taskId: string,
  outputFile: string,
  toolUseId: string | undefined,
  summary: string,
  status?: "completed" | "failed" | "killed",
): string {
  const toolUseIdLine = toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${escapeXml(toolUseId)}</${TOOL_USE_ID_TAG}>`
    : "";
  const statusLine = status ? `\n<${STATUS_TAG}>${status}</${STATUS_TAG}>` : "";
  return `<${TASK_NOTIFICATION_TAG}>\n<${TASK_ID_TAG}>${escapeXml(taskId)}</${TASK_ID_TAG}>${toolUseIdLine}\n<${OUTPUT_FILE_TAG}>${escapeXml(outputFile)}</${OUTPUT_FILE_TAG}>${statusLine}\n<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>\n</${TASK_NOTIFICATION_TAG}>`;
}

export function formatMonitorEventNotification(
  event: MonitorLineEvent,
  outputFile: string,
  toolUseId?: string,
): string {
  return `${notificationBase(event.taskId, outputFile, toolUseId, `Monitor event ${event.eventNumber}`)}\nEvent:\n${event.line}`;
}

export function formatMonitorCompletionNotification(
  taskId: string,
  outputFile: string,
  description: string,
  status: "completed" | "failed" | "killed",
  eventCount: number,
  exitCode: number,
  output: string,
  toolUseId?: string,
  reason?: string,
): string {
  const suffix = reason ? ` ${reason}` : "";
  const outputText = output.trimEnd();
  return `${notificationBase(taskId, outputFile, toolUseId, `Monitor "${description}"${suffix} after ${eventCount} event${eventCount === 1 ? "" : "s"} (exit code ${exitCode})`, status)}${outputText ? `\nLast output:\n${outputText}` : "\nNo stdout events were produced."}`;
}

function isTimeoutResult(result: ExecResult): boolean {
  return /timed out after/i.test(result.stderr);
}

export async function startMonitorTask(
  input: MonitorTaskInput,
): Promise<MonitorTaskHandle> {
  const monitorAbortController = new AbortController();
  let commandRef: ShellCommand | undefined;
  let taskId = "";
  let outputFile = "";
  let lineBuffer = "";
  let eventCount = 0;
  let eventLimitReached = false;
  let finalized = false;
  const pendingEventLines: string[] = [];

  const emitEvent = (line: string): void => {
    if (!line || finalized) return;
    // exec() may observe an exceptionally fast command before it returns the
    // ShellCommand metadata. Hold those lines until the task id and output
    // path are available so the model never receives an empty task reference.
    if (!taskId) {
      pendingEventLines.push(line);
      return;
    }
    eventCount += 1;
    enqueuePendingNotification({
      value: formatMonitorEventNotification(
        { taskId, line, eventNumber: eventCount },
        outputFile,
        input.toolUseId,
      ),
      mode: "task-notification",
      priority: "later",
      agentId: input.agentId,
    });
    if (input.maxEvents !== undefined && eventCount >= input.maxEvents) {
      eventLimitReached = true;
      commandRef?.kill();
    }
  };

  const shellCommand = await exec(
    input.command,
    monitorAbortController.signal,
    "bash",
    {
      timeout: input.timeoutMs,
      sandboxConfig: input.sandboxConfig,
      shouldUseSandbox:
        input.sandboxConfig !== undefined ||
        shouldUseSandbox({ command: input.command }),
      onStdout(data) {
        lineBuffer += data;
        const consumed = consumeMonitorLines(lineBuffer);
        lineBuffer = consumed.remainder;
        for (const line of consumed.lines) {
          emitEvent(line);
          if (eventLimitReached) break;
        }
      },
    },
  );
  commandRef = shellCommand;
  taskId = shellCommand.taskOutput.taskId;
  outputFile = shellCommand.taskOutput.path;
  // Monitors expose a stable output file even when the process emits less than
  // the normal in-memory spill threshold. Force TaskOutput into disk mode so
  // Read can inspect the full event stream after the monitor completes.
  await initTaskOutput(taskId).catch(() => undefined);
  shellCommand.taskOutput.spillToDisk();

  const unregisterCleanup = registerCleanup(async () => {
    monitorAbortController.abort("monitor-cleanup");
    shellCommand.kill();
  });
  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(
      taskId,
      "local_bash",
      input.description,
      input.toolUseId,
    ),
    type: "local_bash",
    kind: "monitor",
    status: "running",
    command: input.command,
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: true,
    agentId: input.agentId,
  };
  registerTask(taskState, input.setAppState);
  for (const line of pendingEventLines.splice(0)) {
    emitEvent(line);
    if (eventLimitReached) break;
  }

  void shellCommand.result.then(async (result) => {
    if (lineBuffer) {
      const consumed = consumeMonitorLines(lineBuffer, true);
      lineBuffer = consumed.remainder;
      for (const line of consumed.lines) {
        emitEvent(line);
        if (eventLimitReached) break;
      }
    }
    await shellCommand.taskOutput.flush();
    const finalOutput = result.stdout.slice(-4096);
    let wasKilled = false;
    updateTaskState<LocalShellTaskState>(taskId, input.setAppState, (task) => {
      if (task.status === "killed") {
        wasKilled = true;
        return task;
      }
      const timedOut = isTimeoutResult(result);
      return {
        ...task,
        status: result.code === 0 || eventLimitReached ? "completed" : "failed",
        result: { code: result.code, interrupted: result.interrupted },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now(),
        notified: true,
        ...(timedOut ? { monitorTimeout: true } : {}),
      } as LocalShellTaskState;
    });
    finalized = true;
    unregisterCleanup();
    shellCommand.cleanup();
    if (!wasKilled) {
      const timedOut = isTimeoutResult(result);
      const reason = timedOut
        ? `timed out after ${input.timeoutMs}ms; re-arm to continue`
        : eventLimitReached
          ? "reached the event limit"
          : result.code === 0
            ? undefined
            : "exited with an error";
      enqueuePendingNotification({
        value: formatMonitorCompletionNotification(
          taskId,
          outputFile,
          input.description,
          result.code === 0 || eventLimitReached ? "completed" : "failed",
          eventCount,
          result.code,
          finalOutput,
          input.toolUseId,
          reason,
        ),
        mode: "task-notification",
        priority: "later",
        agentId: input.agentId,
      });
    }
    void evictTaskOutput(taskId);
  });

  return { taskId, outputFile };
}

export const MonitorTask = {
  name: "MonitorTask",
  type: "local_bash" as const,
  async kill(
    taskId: string,
    setAppState: (updater: (prev: AppState) => AppState) => void,
  ) {
    killTask(taskId, setAppState);
  },
};
