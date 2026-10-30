import { afterEach, expect, test } from "bun:test";
import {
  consumeMonitorLines,
  formatMonitorCompletionNotification,
  formatMonitorEventNotification,
  startMonitorTask,
} from "./MonitorTask.js";
import { dequeueAll } from "../../utils/messageQueueManager.js";
import type { AppState } from "../../state/AppStateStore.js";
import { killTask } from "../LocalShellTask/killShellTasks.js";
import { readFile } from "node:fs/promises";

afterEach(() => {
  dequeueAll();
});

async function waitForMonitor(getState: () => AppState, taskId: string) {
  const deadline = Date.now() + 4_000;
  while (getState().tasks[taskId]?.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("consumeMonitorLines keeps partial stdout chunks until a newline", () => {
  expect(consumeMonitorLines("one\ntwo\npar")).toEqual({
    lines: ["one", "two"],
    remainder: "par",
  });
  expect(consumeMonitorLines("par\nlast", true)).toEqual({
    lines: ["par", "last"],
    remainder: "",
  });
});

test("monitor notifications distinguish stream events from terminal completion", () => {
  const event = formatMonitorEventNotification(
    { taskId: "bmonitor", line: "ready <yes>", eventNumber: 1 },
    "/tmp/monitor.output",
  );
  expect(event).toContain("<summary>Monitor event 1</summary>");
  expect(event).toContain("ready <yes>");
  expect(event).not.toContain("<status>");

  const completion = formatMonitorCompletionNotification(
    "bmonitor",
    "/tmp/monitor.output",
    "wait for ready",
    "completed",
    1,
    0,
    "ready <yes>",
  );
  expect(completion).toContain("<status>completed</status>");
  expect(completion).toContain("after 1 event");
  expect(completion).toContain("ready <yes>");
});

test("startMonitorTask streams lines and records a terminal task notification", async () => {
  let state = { tasks: {} } as unknown as AppState;
  const setAppState = (update: (previous: AppState) => AppState) => {
    state = update(state);
  };
  const handle = await startMonitorTask({
    command: "printf 'first\\nsecond\\n'",
    description: "emit two lines",
    timeoutMs: 5_000,
    setAppState,
  });
  expect(handle.taskId).toMatch(/^b/);
  await waitForMonitor(() => state, handle.taskId);
  const task = state.tasks[handle.taskId] as
    { status: string; kind?: string } | undefined;
  expect(task?.status).toBe("completed");
  expect(task?.kind).toBe("monitor");
  expect(await readFile(handle.outputFile, "utf8")).toContain("first");
  const queued = dequeueAll().map((command) => String(command.value));
  expect(queued.some((value) => value.includes("Event:\nfirst"))).toBe(true);
  expect(queued.some((value) => value.includes("Event:\nsecond"))).toBe(true);
  expect(
    queued.some((value) => value.includes("<status>completed</status>")),
  ).toBe(true);
});

test("max_events ends a monitor after the requested number of events", async () => {
  let state = { tasks: {} } as unknown as AppState;
  const setAppState = (update: (previous: AppState) => AppState) => {
    state = update(state);
  };
  const handle = await startMonitorTask({
    command: "printf 'first\\nsecond\\n'; sleep 1",
    description: "stop after one",
    timeoutMs: 5_000,
    maxEvents: 1,
    setAppState,
  });
  await waitForMonitor(() => state, handle.taskId);
  const task = state.tasks[handle.taskId] as { status: string } | undefined;
  expect(task?.status).toBe("completed");
  const queued = dequeueAll().map((command) => String(command.value));
  expect(
    queued.filter((value) => value.includes("<summary>Monitor event")).length,
  ).toBe(1);
  expect(
    queued.some((value) => value.includes("reached the event limit")),
  ).toBe(true);
});

test("a monitor deadline produces one timeout completion notification", async () => {
  let state = { tasks: {} } as unknown as AppState;
  const setAppState = (update: (previous: AppState) => AppState) => {
    state = update(state);
  };
  const handle = await startMonitorTask({
    command: "sleep 2",
    description: "deadline test",
    timeoutMs: 100,
    setAppState,
  });
  await waitForMonitor(() => state, handle.taskId);
  expect(
    (state.tasks[handle.taskId] as { status: string } | undefined)?.status,
  ).toBe("failed");
  const queued = dequeueAll().map((command) => String(command.value));
  expect(
    queued.filter((value) => value.includes("<status>failed</status>")).length,
  ).toBe(1);
  expect(queued.some((value) => value.includes("timed out after 100ms"))).toBe(
    true,
  );
});

test("killing a monitor aborts it without a completed monitor receipt", async () => {
  let state = { tasks: {} } as unknown as AppState;
  const setAppState = (update: (previous: AppState) => AppState) => {
    state = update(state);
  };
  const handle = await startMonitorTask({
    command: "sleep 2",
    description: "abort test",
    timeoutMs: 5_000,
    setAppState,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  killTask(handle.taskId, setAppState);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(
    (state.tasks[handle.taskId] as { status: string } | undefined)?.status,
  ).toBe("killed");
  const queued = dequeueAll().map((command) => String(command.value));
  expect(queued.some((value) => value.includes('Monitor "abort test"'))).toBe(
    false,
  );
});
