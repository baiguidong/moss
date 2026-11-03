import type { AppNotification } from './app-notifications';
import type { AskUserQuestionRequest, SessionSummary } from '../types';

export type PendingWorkState = 'attention' | 'review' | 'progress' | 'done';
export type PendingWorkSource = 'question' | 'approval' | 'result' | 'failure';

export type PendingWorkItem = {
  id: string;
  sessionId?: string;
  source: PendingWorkSource;
  state: PendingWorkState;
  title: string;
  summary: string;
  context?: string;
  createdAt: number;
  actionRef?: string;
  notificationId?: string;
  dedupeKey: string;
};

export type PendingWorkInput = {
  questions?: AskUserQuestionRequest[];
  notifications?: AppNotification[];
  sessions?: SessionSummary[];
  now?: number;
  doneWindowMs?: number;
};

const DEFAULT_DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const STATE_RANK: Record<PendingWorkState, number> = {
  attention: 0,
  review: 1,
  progress: 2,
  done: 3,
};

function compactText(value: unknown, fallback: string): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function sessionTitle(session: SessionSummary | undefined): string {
  return compactText(session?.title, '未命名会话');
}

function sessionContext(session: SessionSummary | undefined): string | undefined {
  const value = compactText(session?.projectName, '');
  return value || undefined;
}

function questionSummary(request: AskUserQuestionRequest): string {
  const question = request.input?.questions?.[0];
  if (question?.question) return compactText(question.question, '等待你的回答');
  if (question?.header) return compactText(question.header, '等待你的回答');
  return request.input?.metadata?.source === 'session:tool-permission'
    ? 'Moss 正在等待操作确认'
    : 'Moss 正在等待你的回答';
}

function addItem(items: PendingWorkItem[], item: PendingWorkItem): void {
  if (!items.some((entry) => entry.dedupeKey === item.dedupeKey)) items.push(item);
}

export function buildPendingWorkItems({
  questions = [],
  notifications = [],
  sessions = [],
  now = Date.now(),
  doneWindowMs = DEFAULT_DONE_WINDOW_MS,
}: PendingWorkInput = {}): PendingWorkItem[] {
  const items: PendingWorkItem[] = [];
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const sessionsWithQuestions = new Set(questions.map((request) => request.sessionId));

  for (const request of questions) {
    if (!request?.requestId || !request.sessionId) continue;
    const session = sessionById.get(request.sessionId);
    const isToolPermission = request.input?.metadata?.source === 'session:tool-permission';
    addItem(items, {
      id: `question:${request.requestId}`,
      sessionId: request.sessionId,
      source: isToolPermission ? 'approval' : 'question',
      state: 'attention',
      title: sessionTitle(session),
      summary: questionSummary(request),
      context: sessionContext(session),
      createdAt: request.requestedAt || session?.updatedAt || now,
      actionRef: request.requestId,
      dedupeKey: `question:${request.requestId}`,
    });
  }

  // The message center owns ordinary notification history. Only an unresolved
  // Decision Broker item belongs in the task queue because it still blocks work.
  for (const notification of notifications) {
    if (notification.decisionRequestId) {
      addItem(items, {
        id: `decision:${notification.decisionRequestId}`,
        source: 'approval',
        state: 'attention',
        title: compactText(notification.title, '待确认操作'),
        summary: compactText(notification.message, '有一项操作等待确认'),
        context: compactText(notification.source, ''),
        createdAt: notification.createdAt,
        actionRef: notification.decisionRequestId,
        notificationId: notification.id,
        dedupeKey: `decision:${notification.decisionRequestId}`,
      });
    }
  }

  for (const session of sessions) {
    if (session.archivedAt) continue;
    const title = sessionTitle(session);
    const context = sessionContext(session);
    if (session.pendingPlanApproval) {
      addItem(items, {
        id: `session:${session.id}:plan`,
        sessionId: session.id,
        source: 'approval',
        state: 'attention',
        title,
        summary: '计划已准备好，等待你确认后继续',
        context,
        createdAt: session.pendingPlanApproval.requestedAt || session.updatedAt,
        actionRef: session.id,
        dedupeKey: `session:${session.id}:plan`,
      });
    }
    if (session.projectSessionStatus === 'waiting_for_user' && !sessionsWithQuestions.has(session.id)) {
      addItem(items, {
        id: `session:${session.id}:question`,
        sessionId: session.id,
        source: 'question',
        state: 'attention',
        title,
        summary: '项目任务等待你的处理',
        context,
        createdAt: session.updatedAt,
        actionRef: session.id,
        dedupeKey: `session:${session.id}:question`,
      });
    }
    if (session.projectSessionStatus === 'failed') {
      addItem(items, {
        id: `session:${session.id}:failure`,
        sessionId: session.id,
        source: 'failure',
        state: 'attention',
        title,
        summary: compactText(session.projectConclusion, '项目任务执行失败，进入会话查看详情'),
        context,
        createdAt: session.updatedAt,
        actionRef: session.id,
        dedupeKey: `session:${session.id}:failure`,
      });
    }
    const running = session.busy || session.projectSessionStatus === 'working';
    if (running && !sessionsWithQuestions.has(session.id) && !session.pendingPlanApproval) {
      addItem(items, {
        id: `session:${session.id}:progress`,
        sessionId: session.id,
        source: 'result',
        state: 'progress',
        title,
        summary: compactText(session.preview, '正在处理任务'),
        context,
        createdAt: session.busyStartedAt || session.updatedAt,
        actionRef: session.id,
        dedupeKey: `session:${session.id}:progress`,
      });
    }
    const completedAt = session.completedAt || 0;
    if (
      session.projectSessionStatus === 'completed' &&
      completedAt > 0 &&
      now - completedAt <= doneWindowMs
    ) {
      addItem(items, {
        id: `session:${session.id}:result`,
        sessionId: session.id,
        source: 'result',
        state: 'done',
        title,
        summary: compactText(session.projectConclusion || session.preview, '任务已完成'),
        context,
        createdAt: completedAt,
        actionRef: session.id,
        dedupeKey: `session:${session.id}:result`,
      });
    }
  }

  return items.sort((left, right) => (
    STATE_RANK[left.state] - STATE_RANK[right.state] || right.createdAt - left.createdAt
  ));
}

export function countPendingWorkItems(items: PendingWorkItem[]): number {
  return items.filter((item) => item.state === 'attention' || item.state === 'review').length;
}
