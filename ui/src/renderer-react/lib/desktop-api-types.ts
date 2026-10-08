import type {
  AgentEvent, AskUserQuestionAnnotations, ComposerResourceRef,
  PendingPlanApproval, SessionSummary, SessionTask,
} from '../types';

export type SessionRequest = { sessionId: string };
export type ControlResult = { ok: true };
export type SendRequest = SessionRequest & {
  prompt: string;
  skills?: Array<{ name: string; displayName?: string; source?: string }>;
  agentType?: string;
  mode?: 'chat' | 'boss';
  appName?: string;
  files?: string[];
  resources?: ComposerResourceRef[];
};

// The promise settles when the turn finishes, including direct shell turns.
// Transport/runtime failures reject; these variants are Main's returned results.
export type SendResult =
  | { ok: true; sessionId: string; summary: SessionSummary; pendingPlanApproval: PendingPlanApproval | null; assistantText: string }
  | { ok: true; bash: true; exitCode: number }
  | { ok: false; deleted: true; sessionId: string }
  | { ok: false; error: string; sessionId: string };
export type PlanDecisionResult = ControlResult & { sessionId: string; summary: SessionSummary };
export type QuestionRequestRef = SessionRequest & { requestId: string };
export type AnswerQuestionRequest = QuestionRequestRef & {
  answers: Record<string, string>;
  annotations?: AskUserQuestionAnnotations;
};
export type RejectQuestionRequest = QuestionRequestRef & { message?: string };

// The outer envelope belongs to Desktop; inner SDK/history events stay extensible.
export type SessionEvent = SessionRequest & { payload: AgentEvent };
export type SessionStateEvent = SessionRequest & {
  busy?: boolean;
  summary?: SessionSummary;
  history?: AgentEvent[];
  tasks?: SessionTask[];
};
export type SessionHistoryEvent = SessionRequest & {
  replaceHistory?: boolean;
  summary?: SessionSummary;
  history?: AgentEvent[];
  tasks?: SessionTask[];
};
export type ConnectorsChangedEvent = { reason?: string; connectorId?: string };

// Catalog content varies by provider; views retain their existing parsing.
// Use unknown rather than claiming the content is validated at the IPC boundary.
export type MarketplaceResponse<T = unknown> = { success: boolean; data?: T; error?: string };
export type MarketplaceQuery = {
  page?: number; pageSize?: number; query?: string; category?: string; sortBy?: string;
};
export type SkillQuery = MarketplaceQuery & { order?: 'asc' | 'desc'; keyword?: string; source?: string };
export type ExpertQuery = MarketplaceQuery & { type?: string; forceRefresh?: boolean };
export type SkillCoordinate = { slug: string; namespace?: string };
export type SkillInstallRequest = { skill: Record<string, unknown> };
export type SourcePathRequest = { sourcePath: string };
export type ExpertRequest = { expertId: string; forceRefresh?: boolean };
export type SkillHubApi = {
  getInstalled: () => Promise<MarketplaceResponse<unknown[]>>;
  fetchCategories: () => Promise<MarketplaceResponse<unknown[]>>;
  fetchSkills: (payload?: SkillQuery) => Promise<MarketplaceResponse<{ skills: unknown[]; total: number; page: number; pageSize: number; hasMore: boolean }>>;
  fetchDetail: (payload: SkillCoordinate) => Promise<MarketplaceResponse<{ skill: Record<string, unknown> | null }>>;
  install: (payload: SkillInstallRequest) => Promise<MarketplaceResponse & { skillName?: string; version?: string }>;
  uninstall: (payload: SourcePathRequest) => Promise<MarketplaceResponse>;
  openImportDialog: () => Promise<MarketplaceResponse<{ filePath: string }>>;
  importLocal: (payload: SourcePathRequest) => Promise<MarketplaceResponse<{ skillName: string; installedVersion: string }>>;
};
type ExpertPage = { experts: unknown[]; total: number; page: number; pageSize: number; hasMore: boolean };
export type ExpertHubApi = {
  getInstalled: () => Promise<MarketplaceResponse<unknown[]>>;
  fetchCategories: (payload?: { forceRefresh?: boolean }) => Promise<MarketplaceResponse<{ categories: unknown[]; manifests: unknown[] }>>;
  fetchExperts: (payload?: ExpertQuery) => Promise<MarketplaceResponse<ExpertPage>>;
  fetchFeatured: (payload?: ExpertQuery) => Promise<MarketplaceResponse<ExpertPage>>;
  fetchScenes: (payload?: { page?: number; pageSize?: number; forceRefresh?: boolean }) => Promise<MarketplaceResponse<{ scenes: unknown[]; total: number; page: number; pageSize: number; hasMore: boolean }>>;
  fetchDetail: (payload: ExpertRequest) => Promise<MarketplaceResponse>;
  install: (payload: ExpertRequest) => Promise<MarketplaceResponse>;
  uninstall: (payload: SourcePathRequest) => Promise<MarketplaceResponse>;
};

export type CronSource = 'local' | 'cloud';
export type CronTaskInfo = {
  id: string; cron: string; prompt: string; recurring: boolean;
  createdAt: number | null; lastFiredAt: number | null;
  enabled: boolean; orphaned: boolean;
  ownerSessionId: string | null; ownerSessionTitle: string | null;
  executionSessionId: string | null; executionSessionTitle: string | null;
  nextRunAt: number | null; durable?: boolean;
  status?: 'idle' | 'running' | 'failed'; lastError?: string | null;
  lastCompletedAt?: number | null; timezone?: string;
};
type CronResult = { ok: boolean; error?: string; sessionId?: string };
export type SessionCronApi = {
  list: (source: CronSource) => Promise<{ tasks: CronTaskInfo[] }>;
  toggle: (source: CronSource, payload: { taskId: string; enabled: boolean }) => Promise<CronResult>;
  remove: (source: CronSource, payload: { taskId: string }) => Promise<CronResult>;
  runNow: (source: CronSource, payload: { taskId: string }) => Promise<CronResult>;
};
