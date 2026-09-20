import { describe, expect, test } from "bun:test";
import {
  conversationWorkflowDrafts,
  workflowEditPrompt,
  workflowPreviewTask,
  workflowUsePrompt,
} from "../src/renderer-react/lib/workflow-library";
import type { WorkflowCatalogDetail, WorkflowCatalogEntry } from "../src/renderer-react/types";

function entry(overrides: Partial<WorkflowCatalogEntry> = {}): WorkflowCatalogEntry {
  return {
    schemaVersion: 1,
    id: "wfd_aaaaaaaaaaaaaaaa",
    scope: "user",
    status: "draft",
    name: "demo",
    title: "Demo",
    description: "Demo workflow",
    currentRevision: 2,
    origin: { sessionId: "session-a" },
    createdAt: 1,
    updatedAt: 2,
    graph: { version: 3, name: "demo", title: "Demo", description: "Demo workflow", nodes: [], edges: [] },
    mermaid: "flowchart TD",
    ...overrides,
  };
}

function detail(overrides: Partial<WorkflowCatalogEntry> = {}): WorkflowCatalogDetail {
  const record = entry(overrides);
  return {
    record,
    revision: {
      schemaVersion: 1,
      workflowId: record.id,
      revision: record.currentRevision,
      definition: { version: 3, kind: "state-machine", meta: { name: record.name, title: record.title, description: record.description }, graph: { entry: "start", nodes: [], edges: [] }, limits: {} },
      graph: record.graph,
      mermaid: record.mermaid,
      createdAt: record.updatedAt,
    },
    revisions: [],
  };
}

describe("workflow library helpers", () => {
  test("keeps only drafts created by the current conversation", () => {
    const current = entry();
    const other = entry({ id: "wfd_bbbbbbbbbbbbbbbb", origin: { sessionId: "session-b" }, updatedAt: 4 });
    const published = entry({ id: "wfd_cccccccccccccccc", status: "published", updatedAt: 5 });
    expect(conversationWorkflowDrafts([published, other, current], "session-a")).toEqual([current]);
    expect(conversationWorkflowDrafts([current], undefined)).toEqual([]);
  });

  test("creates a read-only graph preview without pretending to have run", () => {
    const task = workflowPreviewTask(detail());
    expect(task.workflowId).toBe("wfd_aaaaaaaaaaaaaaaa");
    expect(task.workflowRevision).toBe(2);
    expect(task.nodeEvents).toEqual([]);
    expect(task.progress).toEqual([]);
  });

  test("edits drafts without running or publishing them", () => {
    const prompt = workflowEditPrompt(detail());
    expect(prompt).toContain("WorkflowEdit");
    expect(prompt).toContain("不要运行或发布");
  });

  test("uses published templates from natural language instead of raw JSON", () => {
    const prompt = workflowUsePrompt(detail({ status: "published", publishedRevision: 2 }));
    expect(prompt).toContain("已发布");
    expect(prompt).toContain("不要让我填写 JSON");
    expect(prompt).toContain("revision: 2");
  });
});
