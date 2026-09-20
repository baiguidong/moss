import type {
  BackgroundTaskInfo,
  WorkflowCatalogDetail,
  WorkflowCatalogEntry,
} from "../types";

export function workflowPreviewTask(detail: WorkflowCatalogDetail): BackgroundTaskInfo {
  return {
    id: `preview-${detail.record.id}-${detail.revision.revision}`,
    description: detail.revision.definition.meta.description,
    command: "",
    kind: "workflow",
    status: "completed",
    isBackgrounded: false,
    startTime: null,
    endTime: null,
    exitCode: null,
    workflowName: detail.revision.definition.meta.title,
    workflowId: detail.record.id,
    workflowRevision: detail.revision.revision,
    workflowRunId: null,
    definition: detail.revision.definition,
    graph: detail.revision.graph,
    mermaid: detail.revision.mermaid,
    nodeEvents: [],
    progress: [],
  };
}

export function conversationWorkflowDrafts(
  workflows: WorkflowCatalogEntry[],
  sessionId: string | undefined,
): WorkflowCatalogEntry[] {
  if (!sessionId) return [];
  return workflows
    .filter((workflow) => (
      workflow.status === "draft" && workflow.origin?.sessionId === sessionId
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function workflowEditPrompt(workflow: WorkflowCatalogDetail): string {
  return [
    `请先使用 WorkflowManage get 读取 ${workflow.record.id}，然后用 WorkflowEdit 基于 revision ${workflow.record.currentRevision} 修改它。`,
    "只修改草稿，不要运行或发布。我的修改要求是：",
  ].join("\n");
}

export function workflowUsePrompt(workflow: WorkflowCatalogDetail): string {
  const revision = workflow.record.publishedRevision ?? workflow.revision.revision;
  return [
    `请使用已发布的 Workflow 模板“${workflow.revision.definition.meta.title}”。`,
    `workflowId: ${workflow.record.id}`,
    `revision: ${revision}`,
    "请根据我下面的自然语言整理运行输入，不要让我填写 JSON；若缺少必需信息，先向我提问。",
    "",
    "我的输入：",
  ].join("\n");
}
