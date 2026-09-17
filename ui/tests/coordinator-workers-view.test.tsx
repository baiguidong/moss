import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CoordinatorWorkersSummary,
  CoordinatorWorkersView,
} from "../src/renderer-react/components/coordinator-workers-view";
import { SessionTabBar } from "../src/renderer-react/components/chat-area";
import type { SessionSummary } from "../src/renderer-react/types";

const workers: SessionSummary[] = [
  {
    id: "worker-running",
    title: "调查一个很长很长的认证异常任务标题并确认刷新令牌处理逻辑",
    agentMode: "local",
    workspace: "/tmp/running",
    createdAt: 1_000,
    updatedAt: 3_000,
    busy: true,
    messageCount: 3,
    sessionId: "agent-running",
    preview: "正在检查 token 校验逻辑",
    subagentStatus: "running",
    workerName: "researcher",
    assistantName: "general-purpose",
    isSubAgent: true,
    parentSessionId: "parent",
  },
  {
    id: "worker-failed",
    title: "验证数据库迁移",
    agentMode: "local",
    workspace: "/tmp/failed",
    createdAt: 2_000,
    updatedAt: 5_000,
    busy: false,
    messageCount: 2,
    sessionId: "agent-failed",
    preview: "migration test exited with code 1",
    subagentStatus: "failed",
    workerName: "verifier",
    isSubAgent: true,
    parentSessionId: "parent",
  },
  {
    id: "worker-completed",
    title: "梳理认证模块结构",
    agentMode: "local",
    workspace: "/tmp/completed",
    createdAt: 1_000,
    updatedAt: 4_000,
    busy: false,
    messageCount: 4,
    sessionId: "agent-completed",
    preview: "梳理认证模块结构",
    subagentStatus: "completed",
    assistantName: "explore",
    isSubAgent: true,
    parentSessionId: "parent",
  },
];

test("coordinator header uses compact status dots without worker titles", () => {
  const markup = renderToStaticMarkup(
    <CoordinatorWorkersSummary workers={workers} onOpen={() => {}} onSelect={() => {}} />,
  );

  expect(markup).toContain("3 个子 Agent");
  expect(markup).toContain("1 运行 · 1 失败");
  expect(markup).toContain("bg-sky-500");
  expect(markup).toContain("bg-destructive");
  expect(markup).toContain("bg-emerald-500");
  expect(markup).not.toContain(">调查一个很长很长的认证异常任务标题并确认刷新令牌处理逻辑<");
});

test("coordinator worker view groups status rows and truncates long titles", () => {
  const markup = renderToStaticMarkup(
    <CoordinatorWorkersView
      workers={workers}
      selectedWorkerId="worker-running"
      onClose={() => {}}
      onOpenWorker={() => {}}
    />,
  );

  expect(markup).toContain("进行中");
  expect(markup).toContain("需要关注");
  expect(markup).toContain("历史");
  expect(markup).toContain("researcher · general-purpose");
  expect(markup).toContain("migration test exited with code 1");
  expect(markup).toContain("data-worker-id=\"worker-running\"");
  expect(markup).toContain("aria-current=\"true\"");
  expect(markup).toContain(">运行中</span>");
  expect(markup).toContain(">失败</span>");
  expect(markup).toContain(">已完成</span>");
  expect(markup).toContain("block truncate text-sm font-medium");
});

test("chat header renders a truncated session title alongside worker status", () => {
  const title = "这是一个需要在顶部保留但不能挤压操作区的超长会话标题";
  const markup = renderToStaticMarkup(
    <SessionTabBar
      title={title}
      leftCollapsed={false}
      rightCollapsed={false}
      leftPanelName="会话"
      rightPanelName="检查器"
      onToggleLeft={() => {}}
      onToggleRight={() => {}}
      toolDisplayMode="expanded"
      sessionToolDisplayMode={null}
      globalToolDisplayMode="expanded"
      onToolDisplayModeChange={() => {}}
      toolDisplaySettingBusy={false}
      outline={[]}
      onJumpToOutlineItem={() => {}}
      messages={[]}
      childSessions={workers}
      onOpenWorkers={() => {}}
      onSelectWorker={() => {}}
    />,
  );

  expect(markup).toContain(`aria-label="会话操作：${title}"`);
  expect(markup).toContain(`>${title}</span>`);
  expect(markup).toContain("max-w-[40%] truncate text-sm font-medium");
  expect(markup).toContain('aria-label="查看会话大纲"');
  expect(markup).toContain("3 个子 Agent");
});

test("chat area uses the coordinator list instead of footer worker cards", () => {
  const source = readFileSync(
    new URL("../src/renderer-react/components/chat-area.tsx", import.meta.url),
    "utf8",
  );

  expect(source).not.toContain("打开子任务：");
  expect(source).toContain("<CoordinatorWorkersSummary");
  expect(source).toContain("<CoordinatorWorkersView");
});
