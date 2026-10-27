import { expect, test } from "bun:test";
import { MonitorTool } from "./MonitorTool.js";
import {
  MONITOR_HEADLESS_MAX_TIMEOUT_MS,
  MONITOR_MAX_TIMEOUT_MS,
} from "./constants.js";

function context(isNonInteractiveSession: boolean) {
  return {
    options: { isNonInteractiveSession },
  } as never;
}

test("Monitor exposes a strict line-stream schema and is in the built-in pool", () => {
  const parsed = MonitorTool.inputSchema.safeParse({
    command: "tail -f app.log",
    description: "watch app logs",
    timeout_ms: 30_000,
    max_events: 5,
  });
  expect(parsed.success).toBe(true);
  expect(MonitorTool.name).toBe("Monitor");
});

test("Monitor enforces the shorter single-prompt deadline", async () => {
  const result = await MonitorTool.validateInput?.(
    { command: "echo ready", timeout_ms: MONITOR_HEADLESS_MAX_TIMEOUT_MS + 1 },
    context(true),
  );
  expect(result?.result).toBe(false);
  expect(result && "message" in result ? result.message : "").toContain(
    String(MONITOR_HEADLESS_MAX_TIMEOUT_MS),
  );
});

test("Monitor accepts the interactive deadline ceiling", async () => {
  const result = await MonitorTool.validateInput?.(
    { command: "echo ready", timeout_ms: MONITOR_MAX_TIMEOUT_MS },
    context(false),
  );
  expect(result).toEqual({ result: true });
});
