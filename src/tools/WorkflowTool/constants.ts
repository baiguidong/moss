export const WORKFLOW_RUN_TOOL_NAME = 'WorkflowRun'
export const WORKFLOW_CREATE_TOOL_NAME = 'WorkflowCreate'
export const WORKFLOW_EDIT_TOOL_NAME = 'WorkflowEdit'
export const WORKFLOW_MANAGE_TOOL_NAME = 'WorkflowManage'

/** Kept as the internal run-tool constant used by the executor. */
export const WORKFLOW_TOOL_NAME = WORKFLOW_RUN_TOOL_NAME

export const WORKFLOW_TOOL_NAMES = [
  WORKFLOW_RUN_TOOL_NAME,
  WORKFLOW_CREATE_TOOL_NAME,
  WORKFLOW_EDIT_TOOL_NAME,
  WORKFLOW_MANAGE_TOOL_NAME,
] as const
