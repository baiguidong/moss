export type OperationDraftStatus = 'draft' | 'ready' | 'executing' | 'succeeded' | 'returned' | 'failed' | 'unknown' | 'cancelled' | 'expired';

export type OperationDraft = {
  kind?: 'tool-call';
  toolCall?: { kind: 'app' | 'mcp'; contributionId?: string; server?: string; instanceId?: string; toolName?: string; sourceRevision: string; toolUseId: string; sessionId: string; schema: Record<string, any>; arguments: Record<string, unknown> };
  id: string;
  draftId: string;
  appId: string;
  instanceId: string | null;
  channel: string;
  accountId: string | null;
  accountLabel: string | null;
  title: string;
  summary: string;
  target: Record<string, unknown>;
  content: string;
  attachments: Array<{ name: string; uri: string }>;
  baseVersion: string | null;
  revision: number;
  status: OperationDraftStatus;
  idempotencyKey: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  resultRef: Record<string, unknown> | null;
  error: string | null;
  actionRefs: {
    resolveTarget?: string;
    validateDraft?: string;
    execute?: string;
    queryResult?: string;
  };
  metadata: Record<string, unknown>;
};

export type OperationDraftPatch = Partial<Pick<OperationDraft, 'title' | 'summary' | 'accountId' | 'accountLabel' | 'target' | 'content' | 'attachments' | 'baseVersion' | 'metadata'>> & { arguments?: Record<string, unknown> };

export function operationDraftNeedsAction(draft: OperationDraft): boolean {
  return ['draft', 'ready', 'failed', 'unknown'].includes(draft.status);
}

export function operationDraftStateLabel(status: OperationDraftStatus): string {
  return ({ draft: '待检查', ready: '可执行', executing: '执行中', succeeded: '已完成', returned: '工具已返回', failed: '执行失败', unknown: '结果待核实', cancelled: '已取消', expired: '已过期' } as Record<OperationDraftStatus, string>)[status];
}
