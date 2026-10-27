import React from "react";
import { z } from "zod/v4";
import type { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/index.mjs";
import type { ToolDef, ToolUseContext } from "../../Tool.js";
import { buildTool } from "../../Tool.js";
import { BashTool } from "../BashTool/BashTool.js";
import { startMonitorTask } from "../../tasks/MonitorTask/MonitorTask.js";
import {
  MONITOR_DEFAULT_TIMEOUT_MS,
  MONITOR_HEADLESS_MAX_TIMEOUT_MS,
  MONITOR_MAX_TIMEOUT_MS,
  MONITOR_TOOL_NAME,
} from "./constants.js";
import { DESCRIPTION, getMonitorPrompt } from "./prompt.js";
import { renderToolUseMessage } from "./UI.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { jsonStringify } from "../../utils/slowOperations.js";

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z
      .string()
      .min(1)
      .describe(
        "Shell command or script. Each stdout line is an event; exit ends the watch.",
      ),
    description: z
      .string()
      .optional()
      .describe("Short human-readable description of what is being monitored."),
    timeout_ms: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(`Deadline in milliseconds; max ${MONITOR_MAX_TIMEOUT_MS}.`),
    max_events: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe(
        "Optional maximum number of stdout events before ending the watch.",
      ),
  }),
);
type InputSchema = ReturnType<typeof inputSchema>;

type MonitorOutput = {
  task_id: string;
  output_file: string;
  status: "armed";
  timeout_ms: number;
  message: string;
};

function getTimeout(
  input: z.infer<InputSchema>,
  context: ToolUseContext,
): number {
  const max = context.options.isNonInteractiveSession
    ? MONITOR_HEADLESS_MAX_TIMEOUT_MS
    : MONITOR_MAX_TIMEOUT_MS;
  const requested = input.timeout_ms ?? MONITOR_DEFAULT_TIMEOUT_MS;
  return Math.min(requested, max);
}

export const MonitorTool = buildTool({
  name: MONITOR_TOOL_NAME,
  searchHint: "stream background process events",
  maxResultSizeChars: 20_000,
  strict: true,
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  async description() {
    return DESCRIPTION;
  },
  async prompt() {
    return getMonitorPrompt();
  },
  getActivityDescription(input) {
    return `Monitoring ${input?.description || input?.command || "command"}`;
  },
  isReadOnly() {
    return false;
  },
  isConcurrencySafe() {
    return false;
  },
  interruptBehavior() {
    return "block";
  },
  async validateInput(input, context) {
    if (input.timeout_ms !== undefined) {
      const max = context.options.isNonInteractiveSession
        ? MONITOR_HEADLESS_MAX_TIMEOUT_MS
        : MONITOR_MAX_TIMEOUT_MS;
      if (input.timeout_ms > max) {
        return {
          result: false,
          message: `timeout_ms cannot exceed ${max}ms for this session.`,
          errorCode: 2,
        };
      }
    }
    return { result: true };
  },
  async checkPermissions(input, context) {
    // Reuse the hardened shell parser/sandbox/path checks. The execution
    // surface is identical to Bash, while the tool name remains Monitor so
    // model-facing prompts and events are distinct.
    return BashTool.checkPermissions(
      {
        command: input.command,
        description: input.description,
      },
      context,
    );
  },
  async call(input, context) {
    const timeoutMs = getTimeout(input, context);
    const setAppState = context.setAppStateForTasks ?? context.setAppState;
    const handle = await startMonitorTask({
      command: input.command,
      description: input.description || input.command,
      timeoutMs,
      maxEvents: input.max_events,
      toolUseId: context.toolUseId,
      agentId: context.agentId,
      sandboxConfig: context.bashSandboxConfig,
      setAppState,
    });
    return {
      data: {
        task_id: handle.taskId,
        output_file: handle.outputFile,
        status: "armed" as const,
        timeout_ms: timeoutMs,
        message: `Monitor armed. Each stdout line will arrive as an event. It expires in ${Math.ceil(timeoutMs / 60000)} minute(s); use TaskStop with task_id ${handle.taskId} to cancel it.`,
      },
    };
  },
  mapToolResultToToolResultBlockParam(
    output: MonitorOutput,
    toolUseID,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: "tool_result",
      content: jsonStringify(output),
    };
  },
  renderToolUseMessage,
} satisfies ToolDef<InputSchema, MonitorOutput>);

export default MonitorTool;
