import type { AppNotification, NewAppNotification } from './lib/app-notifications';

export type PendingPlanApproval = {
  kind: 'plan';
  originalPrompt: string;
  plan: string;
  requestedAt: number;
};

export type AgentMailMessageStatus =
  | 'queued'
  | 'leased'
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'expired';

export type AgentMailMessage = {
  messageId: string;
  orgId: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  subject: string;
  content: string;
  threadId: string;
  replyTo: string | null;
  hopCount: number;
  status: AgentMailMessageStatus;
  deliveryMode: 'blocked' | 'manual' | 'auto';
  attempts: number;
  error: string | null;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  completedAt: number | null;
};

export type AgentMailRuntimeStatus = {
  state: 'stopped' | 'disabled' | 'polling' | 'standby' | 'error';
  error: string | null;
  serverUrl: string;
  pendingManual: number;
};

export type PermissionMode = 'plan' | 'acceptEdits' | 'default' | 'dontAsk' | 'bypassPermissions';

export type SessionSummary = {
  id: string;
  title: string;
  agentMode?: 'local' | 'remote-direct';
  permissionMode: PermissionMode;
  composerIntent?: 'chat' | 'boss';
  workspace: string;
  createdAt: number;
  updatedAt: number;
  busy: boolean;
  busyStartedAt?: number | null;
  messageCount: number;
  sessionId: string | null;
  preview: string;
  pendingPlanApproval?: PendingPlanApproval | null;
  resumeReadOnlyReason?: string | null;
  assistantName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  runtimeMode?: 'normal' | 'coordinator' | 'project-coordinator';
  projectSessionStatus?: ProjectTaskStatus | null;
  completedAt?: number | null;
  projectConclusion?: string;
  projectMemoryVersion?: number;
  connectorIds?: string[];
  sessionKind?: 'chat' | 'cron' | 'agent-mail';
  originChannel?: 'desktop' | 'feishu' | 'cron' | 'agent-mail';
  sourceSessionId?: string | null;
  sourceSessionTitle?: string | null;
  cronTaskId?: string | null;
  toolDisplayMode?: 'expanded' | 'collapsed' | 'merged' | null;
  isSubAgent?: boolean;
  parentSessionId?: string | null;
  subagentStatus?: 'running' | 'completed' | 'failed' | null;
  workerName?: string | null;
};

export type SessionDetail = SessionSummary & {
  history: AgentEvent[];
  workerSummariesJson: string | null;
  tasks?: SessionTask[];
};

export type SessionSearchResult = {
  sessionId: string;
  sessionTitle: string;
  agentMode: 'local' | 'remote-direct';
  messageId: string | null;
  role: 'user' | 'assistant' | null;
  snippet: string;
  timestamp: number;
  sessionUpdatedAt: number;
  rank: number;
};

export type WorkspaceLocation = {
  name: string;
  path: string;
  updatedAt: number;
  managed: boolean;
};

export type AgentEvent = Record<string, any>;

export type TurnChangeHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type TurnFileChange = {
  filePath: string;
  isNewFile: boolean;
  structuredPatch: TurnChangeHunk[];
  additions: number;
  deletions: number;
};

export type TurnChangeSummary = {
  userMessageId: string;
  files: TurnFileChange[];
  stats: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  hasUnverifiedChanges: boolean;
};

export type TurnChangesPayload = {
  turns: TurnChangeSummary[];
  rewind: { supported: boolean; reason: string | null };
};

export type TurnRewindPreview = {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
};

export type UsageDailySummary = {
  day: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  requestCount: number;
};

export type UsageOverview = {
  generatedAt: number;
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    requestCount: number;
    activeDays: number;
    peakDay: string | null;
    peakTokens: number;
    currentStreak: number;
    longestStreak: number;
    todayTokens: number;
  };
  daily: UsageDailySummary[];
};

export type MemoryGlobalEntry = {
  id: string;
  path: string;
  source?: 'local' | 'remote';
  title: string;
  description: string;
  type: string;
  isIndex: boolean;
  indexed: boolean;
  bytes: number;
  updatedAt: number;
  readable: boolean;
};

export type MemoryProjectHistoryEntry = {
  id: string;
  sessionId: string;
  title: string;
  conclusion: string;
  bytes: number;
  updatedAt: number;
  readable: boolean;
};

export type MemoryProjectEntry = {
  id: string;
  name: string;
  updatedAt: number;
  version: number;
  memoryUpdatedAt: number | null;
  finalizedSessionCount: number;
  hasOverview: boolean;
  history: MemoryProjectHistoryEntry[];
};

export type MemorySessionEntry = {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  agentMode: 'local' | 'remote-direct';
  busy: boolean;
  createdAt: number;
  updatedAt: number;
  hasSummary: boolean;
  summaryUpdatedAt: number | null;
  bytes: number;
  readable: boolean;
};

export type MemoryCatalog = {
  generatedAt: number;
  global: {
    rootLabel: string;
    files: MemoryGlobalEntry[];
  };
  projects: MemoryProjectEntry[];
  sessions: MemorySessionEntry[];
};

export type MemoryEntryContent = {
  content: string;
  updatedAt: number | null;
  bytes: number;
  readable: boolean;
};

export type SessionTaskStatus = 'pending' | 'in_progress' | 'completed';

export type SessionTask = {
  id: string;
  subject: string;
  description: string;
  status: SessionTaskStatus;
  activeForm?: string;
  owner?: string | null;
  blockedBy: string[];
};

export type AgentTeamRunStatus = 'live' | 'completed' | 'interrupted';
export type AgentTeamPhase = 'forming' | 'ready' | 'executing' | 'blocked' | 'wrapping_up' | 'completed' | 'interrupted';

export type AgentTeamMember = {
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  color: string;
  joinedAt: number | null;
  cwd: string;
  status: 'running' | 'idle';
};

export type AgentTeamTask = {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  owner: string | null;
  status: SessionTaskStatus;
  blocked: boolean;
  blocks: string[];
  blockedBy: string[];
  metadata: Record<string, unknown>;
};

export type AgentTeamMessage = {
  id: string;
  to: string;
  from: string;
  text: string;
  timestamp: string;
  read: boolean;
  color: string;
  summary: string;
};

export type AgentTeamSnapshot = {
  capturedAt: string;
  phase: AgentTeamPhase;
  taskCounts: { total: number; completed: number; inProgress: number; pending: number; blocked: number };
  team: {
    name: string;
    description: string;
    createdAt: number;
    leadAgentId: string;
    leadSessionId: string;
    members: AgentTeamMember[];
  };
  tasks: AgentTeamTask[];
  messages: AgentTeamMessage[];
  recovery?: {
    type: 'desktop_restart_continuation';
    recoveredAt: string;
  };
};

export type AgentTeamRun = {
  schemaVersion: 1;
  sessionId: string;
  incarnationId: string;
  teamName: string;
  status: AgentTeamRunStatus;
  createdAt: number;
  updatedAt: string;
  deletedAt: string | null;
  snapshots: AgentTeamSnapshot[];
  recoveryAttempt?: {
    id: string;
    mode: 'finish_summary' | 'rerun_missing_members';
    startedAt: number;
    status: 'active' | 'completed';
    completedAt?: number;
  };
};

export type AgentTeamsSessionState = {
  sessionId: string;
  teams: AgentTeamRun[];
};

export type ProjectTaskStatus = 'working' | 'waiting_for_user' | 'completed' | 'failed' | 'stopped';

export type ProjectTask = {
  id: string;
  projectId: string;
  sessionId: string;
  subject: string;
  description: string;
  status: ProjectTaskStatus;
  workerCount: number;
  activeWorkerCount: number;
  attentionCount: number;
  conclusion?: string;
  outputAssetIds: string[];
  completedAt?: number | null;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectTemplate = {
  id: string;
  name: string;
  description?: string;
  nameSuggestion?: string;
  instructions?: string;
  connectorIds?: string[];
  expertIds?: string[];
  skillIds?: string[];
};

export type Project = {
  id: string;
  name: string;
  instructions: string;
  templateId?: string | null;
  connectorIds: string[];
  expertIds: string[];
  skillIds: string[];
  decisionPolicy: {
    mode: 'auto_all' | 'recommend' | 'auto_low_risk';
  };
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
  path?: string;
  workspace?: string;
  assetCount?: number;
  taskCount?: number;
  sessionCount?: number;
  pendingDecisionCount?: number;
};

export type ConnectorType = 'mcp' | 'cli' | 'unknown';

export type ConnectorCredentialField = {
  key: string;
  label: string;
  labelEn?: string;
  placeholder?: string;
  placeholderEn?: string;
  description?: string;
  descriptionEn?: string;
  type: 'text' | 'password' | 'select';
  required: boolean;
  defaultValue?: string;
  options?: Array<{ value: string; label: string; labelEn?: string }>;
  visibleWhen?: { field: string; equals: string[] };
  requiredWhen?: { field: string; equals: string[] };
};

export type ConnectorCredentialProvision = {
  url: string;
  targetField: string;
  responseField: string;
  label: string;
  labelEn?: string;
  validation?: {
    url: string;
    headers?: Record<string, string>;
  };
};

export type ConnectorCredentialSchema = {
  title: string;
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  docUrl?: string;
  docLabel?: string;
  docLabelEn?: string;
  fields: ConnectorCredentialField[];
  authenticateOnSave?: boolean;
  provision?: ConnectorCredentialProvision;
};

export type ConnectorCatalogItem = {
  id: string;
  source: string;
  name: string;
  nameEn?: string;
  icon?: string;
  description?: string;
  descriptionEn?: string;
  type: ConnectorType;
  authMode?: string;
  providerId?: string;
  minWorkbuddyVersion?: string;
  visibleIn?: string[];
  examples?: string[];
  hasMcp?: boolean;
  hasRemoteMcp?: boolean;
  hasCli?: boolean;
  hasSkills?: boolean;
  hasCredentialSchema?: boolean;
  requiresCliSetup?: boolean;
  credentialSchema?: ConnectorCredentialSchema | null;
  configuredFields?: string[];
  configuredValues?: Record<string, string>;
  credentialsConfigured?: boolean;
  installed?: boolean;
  enabled?: boolean;
  connected?: boolean;
  setupStatus?: string;
  setupMessage?: string;
  setupUpdatedAt?: string;
  installedAt?: string | null;
  mcpServerNames?: string[];
  path?: string;
  skillRoot?: string;
  skillName?: string;
};

export type InstalledConnector = ConnectorCatalogItem & {
  installedAt: string;
  path: string;
};

export type ProjectAsset = {
  id: string;
  name: string;
  fileName: string;
  path: string;
  relativePath: string;
  size: number;
  mimeType?: string;
  sourceType?: 'upload' | 'session_output' | string;
  sourceSessionId?: string | null;
  sourcePath?: string | null;
  contentHash?: string | null;
  provenance?: Array<{
    sourceSessionId?: string | null;
    sourcePath?: string | null;
    recordedAt: number;
  }>;
  description?: string;
  createdAt: number;
  updatedAt: number;
};

export type LibraryCollection = {
  id: string;
  uri: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  scope: { kind: 'personal' } | { kind: 'project'; projectId: string };
  sourceCount: number;
  resourceCount: number;
  createdAt: number;
  updatedAt: number;
};

export type LibrarySourceStatus = 'idle' | 'indexing' | 'ready' | 'stale' | 'failed';

export type LibrarySource = {
  id: string;
  uri: string;
  providerKind: 'local-path' | 'project-assets' | 'task-artifacts' | 'managed-files';
  capabilities: Array<'list' | 'search' | 'read' | 'write' | 'move' | 'delete' | 'watch' | 'version'>;
  scope: { kind: 'personal' } | { kind: 'project'; projectId: string };
  name: string;
  location: string;
  config: Record<string, unknown>;
  enabled: boolean;
  status: LibrarySourceStatus;
  error: string;
  revision: string | null;
  indexedRevision: string | null;
  resourceCount: number;
  readyCount: number;
  errorCount: number;
  createdAt: number;
  updatedAt: number;
  indexedAt: number | null;
};

export type LibraryResourceStatus = 'discovered' | 'ready' | 'stale' | 'failed' | 'missing' | 'unsupported';

export type LibraryResource = {
  id: string;
  sourceId: string;
  provider: LibrarySource['providerKind'];
  capabilities: LibrarySource['capabilities'];
  uri: string;
  title: string;
  name: string;
  parentId: string | null;
  kind: 'file';
  displayPath: string;
  relativePath: string;
  extension: string;
  mimeType: string;
  size: number;
  status: LibraryResourceStatus;
  error: string;
  indexStatus: 'unindexed' | 'queued' | 'indexing' | 'ready' | 'stale' | 'error' | 'unsupported';
  indexError: string | null;
  revision: string | null;
  indexedRevision: string | null;
  metadata: Record<string, unknown>;
  contentHash: string | null;
  sourceSessionId: string | null;
  provenance: Array<{ sourceSessionId: string | null; sourcePath: string | null; recordedAt: number }>;
  sourceName: string;
  providerKind: LibrarySource['providerKind'];
  scope: LibrarySource['scope'];
  createdAt: number;
  updatedAt: number;
  indexedAt: number | null;
};

export type LibrarySearchResult = {
  chunkId: number;
  resourceId: string;
  sourceId: string;
  uri: string;
  title: string;
  relativePath: string;
  sourceName: string;
  providerKind: LibrarySource['providerKind'];
  scope: LibrarySource['scope'];
  extension: string;
  revision: string;
  chunkIndex: number;
  blockIndex: number;
  heading: string | null;
  page: number | null;
  startLine: number | null;
  endLine: number | null;
  locationKind: 'line' | 'page' | 'paragraph' | 'slide' | 'sheet' | 'row' | null;
  content: string;
  matchedChunk: string;
  context: string;
  contextChunkIndexes: number[];
  snippet: string;
  score: number;
  rank: {
    final: number;
    fts: number;
    fusion: number;
    boost: number;
    matchedFields: Array<'title' | 'path' | 'heading' | 'body'>;
    exactPhrase: boolean;
    fallbackMode: 'all' | 'any' | 'literal';
    queryTerms: string[];
    queryCoverage: number;
  };
};

export type LibrarySearchDiagnostics = {
  queryTerms: string[];
  requestedMode: 'auto' | 'all' | 'any';
  ftsQueries?: Partial<Record<'all' | 'any', string>>;
  candidateCounts: Partial<Record<'all' | 'any' | 'literal', number>>;
  candidateLimit: number;
  coverageRejectedCount: number;
  coverageRejected?: Array<{
    chunkId: number;
    resourceId: string;
    title: string;
    queryCoverage: number;
    fallbackMode: 'any';
  }>;
  selectedCount: number;
  fallbackUsed: boolean;
  scopedResourceCount: number;
  durationMs: number;
  reason: 'empty-query' | 'no-indexable-terms' | 'no-scoped-content' | 'coverage-filtered' | 'no-lexical-match' | 'results';
  candidates: Array<{
    chunkId: number;
    resourceId: string;
    title: string;
    heading: string | null;
    selected: boolean;
    final: number;
    fts: number;
    fusion: number;
    boost: number;
    matchedFields: LibrarySearchResult['rank']['matchedFields'];
    exactPhrase: boolean;
    fallbackMode: 'all' | 'any' | 'literal';
    queryCoverage: number;
  }>;
};

export type LibraryEvaluationCase = {
  id: string;
  name: string;
  query: string;
  expectedResourceId: string | null;
  expectedResourceTitle: string | null;
  expectedHeading: string | null;
  collectionId: string | null;
  sourceId: string | null;
  scopeKind: 'personal' | 'projects' | 'task-artifacts';
  createdAt: number;
  updatedAt: number;
};

export type LibraryEvaluationSummary = {
  cases: number;
  positiveCases: number;
  negativeCases: number;
  passedCases: number;
  hitAt1: number;
  hitAt5: number;
  mrr: number;
  negativeAccuracy: number;
  noResultRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  citationCompleteness: number;
  duplicateEvidenceRate: number;
  contextCharacterCount: number;
};

export type LibraryEvaluationRun = {
  id: string;
  summary: LibraryEvaluationSummary;
  details?: Array<{
    caseId: string;
    name: string;
    query: string;
    expectedResourceId: string | null;
    expectedResourceTitle: string | null;
    expectedNoResult: boolean;
    passed: boolean;
    resultRank: number | null;
    resultCount: number;
    durationMs: number;
    reason: LibrarySearchDiagnostics['reason'];
    topResults: Array<{ resourceId: string; title: string; heading: string | null; score: number }>;
  }>;
  createdAt: number;
};

export type LibraryEvaluationOverview = {
  cases: LibraryEvaluationCase[];
  latestRun: LibraryEvaluationRun | null;
  recentRuns: LibraryEvaluationRun[];
};

export type ComposerResourceRef = {
  uri: string;
  resourceId: string;
  kind: 'resource' | 'collection' | 'source';
  selection: 'full-file' | 'search-scope' | 'quote';
  displayName: string;
  revision: string | null;
  quote?: { text: string; heading?: string; page?: number };
};

export type LibraryJob = {
  id: string;
  sourceId: string | null;
  kind: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    phase?: string;
    discovered?: number;
    indexed?: number;
    skipped?: number;
    failed?: number;
    currentResourceId?: string;
    currentTitle?: string;
  };
  error: string;
  errorCode: string | null;
  attemptCount: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type LibraryMigrationPreview = {
  available: boolean;
  migratedAt?: number | null;
  sourceCount?: number;
  error?: string;
  knowledgeBases: Array<{
    id: string;
    name: string;
    paths: Array<{ path: string; exists: boolean }>;
  }>;
};

export type LibraryOverview = {
  defaultCollectionId: string;
  stats: { collections: number; sources: number; resources: number; chunks: number; errors: number };
  supportedExtensions: string[];
  featureFlags: { core: boolean; projectAssets: boolean; composerResources: boolean; migration: boolean };
  engine: { status: 'ready' | 'installing' | 'unavailable'; runtime: 'managed-python'; protocolVersion: number };
  providers: Array<{ kind: LibrarySource['providerKind']; capabilities: LibrarySource['capabilities'] }>;
  diagnostics: {
    operations: Array<{
      kind: string;
      count: number;
      averageDurationMs: number;
      maximumDurationMs: number;
      p50DurationMs: number;
      p95DurationMs: number;
      resultCount: number;
      noResultCount: number;
    }>;
    parseCache: { entries: number; bytes: number; hits: number; maxEntries: number; maxBytes: number };
  };
  activeJobs: LibraryJob[];
  migration: LibraryMigrationPreview;
};

export type LibraryExtensionStatus = {
  status: 'not-installed' | 'partial' | 'installing' | 'ready' | 'error' | 'unavailable';
  runtimeAvailable: boolean;
  pythonVersion: string;
  installedAt: number | null;
  error: string;
  repairJobId?: string | null;
  guideAcknowledged?: boolean;
  background?: boolean;
  packages: Array<{
    id: string;
    label: string;
    description: string;
    spec: string;
    installed: boolean;
    version: string | null;
  }>;
};

export type ProjectEvent = {
  id: string;
  type: string;
  summary: string;
  actor: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: number;
};

export type ProjectDecision = {
  id: string;
  projectId: string;
  requestId: string;
  toolUseId?: string | null;
  taskId?: string | null;
  parentSessionId: string;
  originSessionId: string;
  originAgentId?: string | null;
  originAgentType?: string | null;
  originLabel: string;
  kind: 'preference' | 'clarification' | 'external_action' | 'authorization' | 'tool_permission';
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'resolved' | 'rejected' | 'expired';
  blocking: boolean;
  questions: AskUserQuestion[];
  recommendation?: { answers: Record<string, string>; reason: string } | null;
  resolution?: {
    answers: Record<string, string>;
    source: 'user' | 'policy' | 'system';
    note: string;
  } | null;
  createdAt: number;
  resolvedAt?: number | null;
  expiresAt?: number | null;
};

export type ProjectMemory = {
  version: number;
  updatedAt: number | null;
  lastSessionId: string | null;
  finalizedSessionCount: number;
  overview: string;
  overviewPath: string;
};

export type AskUserQuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

export type AskUserQuestion = {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
};

export type AskUserQuestionRequest = {
  requestId: string;
  sessionId: string;
  input: {
    questions?: AskUserQuestion[];
    metadata?: Record<string, unknown>;
  };
  requestedAt: number;
  projectId?: string | null;
  decisionId?: string | null;
  originSessionId?: string;
  originLabel?: string;
};

export type AskUserQuestionAnnotations = Record<string, {
  preview?: string;
  notes?: string;
}>;

export type PairedUser = {
  userId: string | number
  displayName: string
  pairedAt: number
}

export type PairingState = {
  code?: string | null
  expiresAt?: number | null
  createdAt?: number | null
}

export type AdapterFileConfig = {
  serverUrl?: string
  defaultProjectDir?: string
  pairing?: PairingState
  feishu?: {
    appId?: string
    appSecret?: string
    encryptKey?: string
    verificationToken?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
    streamingCard?: boolean
    runLocation?: 'desktop' | 'server'
    serverDeployment?: {
      serverUrl: string
      credentialMode: 'password' | 'api-key'
      userEmail: string
      workspace: string
      configFingerprint: string
    }
  }
}

export type FeishuAdapterStatus = {
  status: 'stopped' | 'running' | 'disabled' | 'error';
  pid: number | null;
  bridgeReady: boolean;
  error?: string | null;
  transportConnected: boolean;
  transportUpdatedAt?: number | null;
  transportError?: string | null;
  location: 'desktop' | 'server';
  enabled?: boolean;
  pairedUsers?: PairedUser[];
  pairing?: PairingState;
};

export type McpServerConfig =
  | {
      type?: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      type: 'http' | 'sse';
      url: string;
      headers?: Record<string, string>;
    };

export type McpServerEntry = {
  name: string;
  enabled: boolean;
  config: McpServerConfig;
  updatedAt?: number;
};

export type McpSettingsPayload = {
  servers: McpServerEntry[];
  configPath: string;
  agentConfigPath: string;
  resetSessionCount?: number;
  skippedBusySessionCount?: number;
};

export type DesktopAgentSource = 'built-in' | 'user' | 'project' | 'managed' | 'flag';

export type DesktopAgentDefinition = {
  id: string;
  agentType: string;
  description: string;
  source: DesktopAgentSource;
  location?: string;
  fileName?: string;
  effective: boolean;
  enabled: boolean;
  active: boolean;
  overriddenBy?: DesktopAgentSource;
  model?: string;
  tools?: string[];
  background?: boolean;
  color?: string;
  canEdit?: boolean;
  canDelete?: boolean;
};

export type DesktopAgentCatalog = {
  agents: DesktopAgentDefinition[];
  workspace: string;
  userAgentsDir: string;
  projectAgentsDir: string;
  totals: {
    all: number;
    active: number;
    sources: number;
    builtIn: number;
  };
  resetSessionCount?: number;
  skippedBusySessionCount?: number;
};

export type DesktopAgentDraft = {
  scope: 'user' | 'project';
  name: string;
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
  background?: boolean;
};

export type DesktopSettings = {
  agentMode: 'local' | 'remote-direct';
  localEnabled: boolean;
  remoteEnabled: boolean;
  agentTeamsEnabled: boolean;
  permissionMode: PermissionMode;
  bypassPermissions: boolean;
  model: string;
  fastModel: string;
  maxTurns: number;
  language: string;
  appendSystemPrompt: string;
  thinkingMode: 'adaptive' | 'enabled' | 'disabled';
  thinkingBudgetTokens: number;
  url: string;
  apiKey: string;
  webSearch?: {
    mode: 'auto' | 'tavily' | 'brave' | 'native' | 'disabled';
    tavilyApiKey?: string;
    braveApiKey?: string;
    tavilyConfigured?: boolean;
    braveConfigured?: boolean;
    clearTavilyApiKey?: boolean;
    clearBraveApiKey?: boolean;
    nativeCapability?: {
      status: 'supported' | 'compatible' | 'unsupported' | 'unknown' | 'detecting';
      format: 'structured' | 'compatible-text' | null;
      checkedAt: number | null;
      reasonCode: string | null;
    };
    activeProvider?: 'tavily' | 'brave' | 'native' | null;
  };
  image: {
    provider: string;
    url: string;
    apiKey: string;
    model: string;
  };
  toolLoading: Record<string, 'always' | 'deferred'>;
  agentSettings?: {
    disabled?: string[];
  };
  sessionMemory?: {
    enabled?: boolean;
    compactEnabled?: boolean;
    minimumMessageTokensToInit?: number;
    minimumTokensBetweenUpdate?: number;
    toolCallsBetweenUpdates?: number;
    compactMinTokens?: number;
    compactMinTextBlockMessages?: number;
    compactMaxTokens?: number;
  };
  autoMemory?: {
    enabled?: boolean;
    extractionEnabled?: boolean;
    extractionIntervalTurns?: number;
    pastContextSearchEnabled?: boolean;
    dreamEnabled?: boolean;
    dreamMinHours?: number;
    dreamMinSessions?: number;
  };
  advanced?: {
    moss_auto_background_agents?: boolean;
    moss_bash_ast_permissions?: boolean;
    moss_hive_evidence?: boolean;
    moss_scratchpad?: boolean;
    moss_idle_session_cleanup?: boolean;
    moss_streaming_tool_execution?: boolean;
    moss_plan_mode_interview?: boolean;
    moss_fast_web_search?: boolean;
    moss_memory_learn_from_corrections?: boolean;
    moss_large_tool_result_protection?: boolean;
    moss_tool_result_budget_chars?: number;
    moss_mcp_output_token_limit?: number;
    moss_file_read_max_size_bytes?: number;
    moss_file_read_max_tokens?: number;
    moss_request_attribution_enabled?: boolean;
    moss_context_compaction_strategy?: 'proactive' | 'reactive';
    moss_session_debug_logging?: boolean;
  };
  managedRuntimes?: {
    node?: boolean;
    python?: boolean;
    git?: boolean;
  };
  appearance: {
    themeMode: 'dark' | 'light' | 'system';
    cssThemeId: 'default' | 'grid-theme' | 'dot-theme' | 'gradient-theme';
    toolDisplayMode: 'expanded' | 'collapsed' | 'merged';
    chatFontSize: number;
    chatLineHeight: number;
    chatMessageSpacing: number;
  };
  mcp?: {
    version?: number;
    servers?: Record<string, {
      enabled?: boolean;
      config?: McpServerConfig;
      updatedAt?: number;
    }>;
  };
  skillHub?: {
    apiBaseUrl?: string;
  };
  expertHub?: {
    baseUrl?: string;
  };
  library?: {
    enabled?: boolean;
    extensionGuideAcknowledged?: boolean;
  };
  workflows?: {
    enabled?: boolean;
  };
  agentMail?: {
    enabled?: boolean;
    sessionMode?: 'fixed' | 'new';
    consumerId?: string;
    inboxSessionId?: string;
    inboxSessionIds?: Record<string, string>;
  };
  remoteDirect?: {
    serverUrl: string;
    credentialMode: 'password' | 'api-key';
    userName: string;
    userEmail: string;
    userPassword: string;
    apiKey: string;
    workspace: string;
  };
  remoteDirectServerUrl: string;
  remoteDirectCredentialMode: 'password' | 'api-key';
  remoteDirectUserName: string;
  // Legacy key name; stores either username or email for password login.
  remoteDirectUserEmail: string;
  remoteDirectUserPassword: string;
  remoteDirectApiKey: string;
  remoteDirectWorkspace: string;
  settingsPath: string;
  settingsExists: boolean;
  settingsLoaded: boolean;
  settingsParseError: string;
  appearancePersisted?: boolean;
  skippedSessionCount?: number;
  coordinatorMode?: boolean;
};

export type ManagedRuntimeEntry = {
  path?: string;
  installed?: boolean;
  skipped?: boolean;
  resourceAvailable?: boolean;
};

export type ManagedRuntimeStatus = {
  node: ManagedRuntimeEntry;
  python: ManagedRuntimeEntry;
  git: ManagedRuntimeEntry;
  registryPath: string;
  resourcesRoot: string;
  installing?: boolean;
};

export type StoredApp = {
  id?: string;
  kind?: 'app';
  name: string;
  displayName?: string;
  title: string;
  description: string;
  icon: string;
  width: number;
  height: number;
  resizable: boolean;
  createdAt: number;
  updatedAt: number;
  versionCount?: number;
  latestVersionId?: string | null;
  latestVersion?: string | null;
  currentVersionId?: string | null;
  currentVersion?: string | null;
  publishedVersion?: string | null;
  marketplaceSource?: {
    catalogUrl: string;
    appId: string;
    version: string;
  };
  hasUi?: boolean;
  hasSettings?: boolean;
  hasBackend?: boolean;
  enabled?: boolean;
  serverEnabled?: boolean;
  grants?: string[];
  serverGrants?: string[];
  trust?: { status: 'unsigned' | 'untrusted' | 'trusted'; publisher?: { id: string; name: string } | null; keyId?: string } | null;
  serverTrust?: { status: 'unsigned' | 'untrusted' | 'trusted'; publisher?: { id: string; name: string } | null; keyId?: string } | null;
  serverVersion?: string | null;
  remoteInstalled?: boolean;
  remoteOnly?: boolean;
  serverConfigured?: boolean;
  serverAvailable?: boolean;
  serverPackageAvailable?: boolean;
  serverPackageError?: string | null;
  remoteError?: string | null;
  backend?: {
    lifecycle: 'on-demand' | 'persistent';
    instanceMode: 'single' | 'multiple';
    targets: Array<'desktop' | 'server'>;
    protocols?: string[];
    actions: Array<{ name: string }>;
  } | null;
  serverBackend?: {
    lifecycle: 'on-demand' | 'persistent';
    instanceMode: 'single' | 'multiple';
    targets: Array<'desktop' | 'server'>;
    protocols?: string[];
    actions: Array<{ name: string }>;
  } | null;
  permissions?: string[];
  serverPermissions?: string[];
  contributes?: {
    views?: Array<{ id: string; title: string; route: string; location: 'sidebar' | 'more' | 'hidden'; icon?: string; order?: number; permission?: string }>;
    settings?: Array<Record<string, any>>;
    commands?: Array<Record<string, any>>;
    tools?: Array<Record<string, any>>;
    resourceProviders?: Array<Record<string, any>>;
    widgets?: Array<Record<string, any>>;
  } | null;
  configuration?: {
    schema?: Record<string, any> | null;
    secrets?: Record<string, any> | null;
  } | null;
  serverConfiguration?: {
    schema?: Record<string, any> | null;
    secrets?: Record<string, any> | null;
  } | null;
  instances?: AppInstance[];
  deployments?: AppDeploymentStatus[];
  runtimeStatus?: {
    state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'crash-loop';
    error?: string;
  };
};

export type AppInstance = {
  id: string;
  appId: string;
  displayName: string;
  config: Record<string, any>;
  secretRefs?: Record<string, { configured: boolean; masked: string }>;
  enabled: boolean;
  target?: 'desktop' | 'server';
};

export type AppDeploymentStatus = {
  deployment: { key: string; instanceId: string; targetType: 'desktop' | 'server'; targetId: string; generation: number };
  runtime: { state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'crash-loop'; lastError?: string | null };
};

export type AppVersion = {
  id: string;
  version: string;
  createdAt: number;
  reason: string;
  note: string;
  marketplaceSource?: {
    catalogUrl: string;
    appId: string;
    version: string;
  } | null;
  description: string;
  width: number;
  height: number;
  resizable: boolean;
  isCurrent?: boolean;
  isLatest?: boolean;
  kind?: 'app';
  hasUi?: boolean;
  hasBackend?: boolean;
  checksumStatus?: string;
};

export type AppMarketplaceArtifact = {
  fileName: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  signed: boolean;
  publisherId: string;
  keyId: string;
};

export type AppMarketplaceVersion = {
  version: string;
  hostApi: string;
  platforms: string[];
  permissions: string[];
  publishedAt: string;
  releaseNotes: string;
  artifact: AppMarketplaceArtifact;
  platformCompatible?: boolean;
  hostCompatible?: boolean;
};

export type AppMarketplaceEntry = {
  id: string;
  displayName: string;
  summary: string;
  description?: string;
  publisher: { id: string; name: string } | null;
  categories: string[];
  keywords?: string[];
  featured: boolean;
  iconUrl: string;
  detailUrl: string;
  latestVersion: string;
  latest: AppMarketplaceVersion;
  installedVersion: string | null;
  updateAvailable: boolean;
  platformCompatible: boolean;
  hostCompatible: boolean;
};

export type AppMarketplaceDetail = Omit<AppMarketplaceEntry, 'detailUrl' | 'latest' | 'installedVersion' | 'updateAvailable' | 'platformCompatible' | 'hostCompatible'> & {
  homepage: string;
  repository: string;
  license: string;
  versions: AppMarketplaceVersion[];
  warning?: string;
};

export type AppMarketplaceCatalog = {
  schemaVersion: 1;
  catalogId: string;
  displayName: string;
  generatedAt: string;
  sourceUrl: string;
  fetchedAt: number;
  cached: boolean;
  warning: string;
  platform: string;
  hostApiVersion: string;
  apps: AppMarketplaceEntry[];
};

export type FileTreeNode = {
  id: string;
  name: string;
  type: 'folder' | 'file';
  path: string;
  children?: FileTreeNode[];
};

export type WorkspacePreviewContentType =
  | 'markdown'
  | 'html'
  | 'image'
  | 'pdf'
  | 'diff'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'url'
  | 'text'
  | 'code'
  | 'ofv'
  | 'unsupported';

export type WorkspacePreviewData = {
  path: string;
  relativePath: string;
  content: string;
  size?: number;
  truncated?: boolean;
  contentType: WorkspacePreviewContentType;
  language?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
};

export type PreviewOpenPayload =
  | { file: WorkspacePreviewData }
  | {
      content: string;
      contentType: WorkspacePreviewContentType;
      metadata?: Record<string, unknown>;
    };

export type PreviewHistoryTarget = {
  contentType: WorkspacePreviewContentType;
  filePath?: string;
  workspace?: string;
  fileName?: string;
  title?: string;
  language?: string;
  conversationId?: string;
};

export type PreviewSnapshotInfo = {
  id: string;
  label: string;
  createdAt: number;
  size: number;
  contentType: WorkspacePreviewContentType;
  fileName?: string;
  filePath?: string;
};

export type BrowserConnectorAuthContext = {
  connectorId: string;
  serverName: string;
  displayName?: string;
  tokenParam?: string;
  allowedHosts?: string[];
};

export type BrowserMcpAuthContext = {
  serverName: string;
  displayName?: string;
};

export type BrowserTabState = {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  devToolsOpen: boolean;
  isNativeBlank: boolean;
  error: string | null;
  connectorAuth?: BrowserConnectorAuthContext | null;
  mcpAuth?: BrowserMcpAuthContext | null;
};

export type BrowserState = {
  tabs: BrowserTabState[];
  activeTabId: string;
};

export type BrowserAuthNavigation = {
  id: string;
  sessionId: string;
  tabId: string;
  url: string;
  connectorAuth: BrowserConnectorAuthContext | null;
  mcpAuth: BrowserMcpAuthContext | null;
};

export type BrowserTabTarget = {
  sessionId?: string | null;
  tabId?: string;
};

export type BrowserOpenTabPayload = {
  sessionId?: string | null;
  url?: string;
  connectorAuth?: BrowserConnectorAuthContext | null;
  mcpAuth?: BrowserMcpAuthContext | null;
};

declare namespace JSX {
  interface IntrinsicElements {
    webview: any;
  }
}

export type BackgroundTaskInfo = {
  id: string;
  description: string;
  command: string;
  kind: 'shell' | 'monitor' | 'workflow';
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'killed';
  isBackgrounded: boolean;
  startTime: number | null;
  endTime: number | null;
  exitCode: number | null;
  workflowName?: string | null;
  workflowId?: string | null;
  workflowRevision?: number | null;
  runMode?: 'test' | 'run' | null;
  workflowRunId?: string | null;
  definition?: WorkflowDefinition | null;
  definitionPath?: string | null;
  args?: unknown;
  graph?: WorkflowGraph | null;
  mermaid?: string;
  graphError?: string | null;
  nodeEvents?: WorkflowNodeEvent[];
  progress?: WorkflowProgressEvent[];
  agentCount?: number;
  totalTokens?: number;
  totalToolCalls?: number;
  result?: unknown;
  error?: string | null;
};

export type WorkflowCatalogStatus = 'draft' | 'published' | 'archived';
export type WorkflowCatalogScope = 'user' | 'project';

export type WorkflowCatalogRecord = {
  schemaVersion: 1;
  id: string;
  scope: WorkflowCatalogScope;
  status: WorkflowCatalogStatus;
  name: string;
  title: string;
  description: string;
  currentRevision: number;
  publishedRevision?: number;
  publishedFileName?: string;
  origin?: { sessionId?: string; toolUseId?: string };
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
};

export type WorkflowCatalogRevision = {
  schemaVersion: 1;
  workflowId: string;
  revision: number;
  definition: WorkflowDefinition;
  graph: WorkflowGraph;
  mermaid: string;
  origin?: { sessionId?: string; toolUseId?: string };
  changeSummary?: string;
  createdAt: number;
};

export type WorkflowCatalogEntry = WorkflowCatalogRecord & {
  graph: WorkflowGraph;
  mermaid: string;
  inputSchema?: unknown;
};

export type WorkflowCatalogDetail = {
  record: WorkflowCatalogRecord;
  revision: WorkflowCatalogRevision;
  revisions: Array<Pick<WorkflowCatalogRevision, 'revision' | 'createdAt' | 'changeSummary' | 'origin'>>;
};

export type WorkflowGraph = {
  version: 3;
  name: string;
  title: string;
  description: string;
  nodes: Array<{
    id: string;
    workflowNodeId: string;
    type: 'start' | 'end' | 'agent' | 'code' | 'condition' | 'workflow' | 'merge' | 'parallel' | 'join' | 'foreach';
    label: string;
    detail?: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: 'next' | 'true' | 'false' | 'case' | 'loop-back' | 'fan-out' | 'join';
    label?: string;
    branchKey?: string;
    workflowEdgeId?: string;
  }>;
  warnings: Array<'truncated'>;
};

export type WorkflowNodeEvent = {
  type: 'workflow_node';
  sequence: number;
  nodeId: string;
  instanceId: string;
  parentInstanceId?: string;
  state: 'ready' | 'queued' | 'running' | 'waiting_children' | 'completed' | 'blocked' | 'failed' | 'skipped' | 'cancelled' | 'interrupted';
  timestamp: number;
  branch?: string;
  iteration?: number;
  itemIndex?: number;
  attempt?: number;
  cached?: boolean;
  error?: string;
};

export type WorkflowDefinitionNode = {
  id: string;
  type: string;
  title: string;
  description?: string;
  prompt?: string;
  script?: string;
  body?: WorkflowDefinitionGraph;
  [key: string]: unknown;
};

export type WorkflowDefinitionGraph = {
  entry: string;
  nodes: WorkflowDefinitionNode[];
  edges: Array<{
    source: string;
    target: string;
    sourcePort?: string;
    label?: string;
    kind?: 'back';
    maxTraversals?: number;
  }>;
};

export type WorkflowDefinition = {
  version: 3;
  kind: 'state-machine';
  meta: { name: string; title: string; description: string };
  defaults?: { concurrency?: number };
  limits?: { maxAgentCalls?: number; maxNodeExecutions?: number; maxConcurrency?: number; maxDurationMs?: number };
  graph: WorkflowDefinitionGraph;
};

export type WorkflowEdgeEvent = {
  type: 'workflow_edge';
  sequence: number;
  edgeId: string;
  source: string;
  target: string;
  instanceId: string;
  state: 'selected' | 'skipped' | 'traversed';
  timestamp: number;
};

export type WorkflowProgressEvent =
  | { type: 'workflow_phase'; index: number; nodeId?: string; title: string; kind: 'definition' }
  | { type: 'workflow_log'; message: string; nodeId?: string; instanceId?: string }
  | WorkflowNodeEvent
  | WorkflowEdgeEvent
  | {
      type: 'workflow_agent';
      index: number;
      nodeId: string;
      instanceId: string;
      parentInstanceId?: string;
      label: string;
      state: 'start' | 'progress' | 'done' | 'error';
      phaseIndex?: number;
      phaseTitle?: string;
      agentType?: string;
      tokens?: number;
      toolCalls?: number;
      durationMs?: number;
      cached?: boolean;
      skipped?: boolean;
      error?: string;
    };

export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AuditFindingStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';

export type AuditSessionRecord = {
  id: string;
  title: string;
  workspace: string;
  projectId: string | null;
  assistantName: string | null;
  sessionKind: 'chat' | 'cron' | 'agent-mail';
  isSubAgent: boolean;
  sourceCreatedAt: number;
  sourceUpdatedAt: number;
  auditedAt: number;
  latestRunId: string;
  eventCount: number;
  toolCallCount: number;
  findingCount: number;
  completeness: 'complete' | 'partial';
  sourcePresent: boolean;
};

export type AuditToolCallRecord = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  toolUseId: string;
  parentToolUseId: string | null;
  toolName: string;
  input: unknown;
  result: string;
  status: 'success' | 'error' | 'unknown';
  isError: boolean;
  startedAt: number | null;
  completedAt: number | null;
  orderIndex: number;
};

export type AuditFindingRecord = {
  id: string;
  runId: string;
  sessionId: string;
  sessionTitle: string;
  toolCallId: string | null;
  toolName: string | null;
  toolUseId: string | null;
  toolInput: unknown;
  toolResult: string;
  toolStatus: 'success' | 'error' | 'unknown' | null;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  severity: AuditSeverity;
  title: string;
  detail: string;
  evidence: unknown;
  status: AuditFindingStatus;
  fingerprint: string;
  createdAt: number;
  reportedAt: number | null;
};

export type AuditAlert = {
  findingId: string;
  fingerprint: string;
  severity: 'high' | 'critical';
  title: string;
  detail: string;
  sessionId: string;
  sessionTitle: string;
  toolUseId: string | null;
  toolName: string | null;
  ruleName: string;
  createdAt: number;
};

export type AuditRuleRecord = {
  id: string;
  name: string;
  description: string;
  severity: AuditSeverity;
  enabled: boolean;
  config: { patterns?: string[]; minimumFailures?: number; allowedPaths?: string[] };
  version: number;
  updatedAt: number;
};

export type AuditRunRecord = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  scope: { kind?: string; sessionIds?: string[] };
  ruleSnapshot: AuditRuleRecord[];
  startedAt: number;
  completedAt: number | null;
  sessionCount: number;
  toolCallCount: number;
  findingCount: number;
  error: string | null;
};

export type AuditEventRecord = {
  id: string;
  sessionId: string;
  eventType: string;
  userMessageId: string | null;
  details: Record<string, unknown>;
  messageCount: number;
  toolCallCount: number;
  createdAt: number;
};

export type AuditEventDetail = AuditEventRecord & {
  history: AgentEvent[];
  tools: Array<{
    id: string;
    eventId: string;
    sessionId: string;
    toolUseId: string;
    parentToolUseId: string | null;
    toolName: string;
    input: unknown;
    result: string;
    status: 'success' | 'error' | 'unknown';
    isError: boolean;
    orderIndex: number;
  }>;
};

export type AuditDashboardPayload = {
  summary: {
    sessionCount: number;
    toolCallCount: number;
    findingCount: number;
    openFindingCount: number;
    criticalFindingCount: number;
    incompleteSessionCount: number;
    latestCompletedAt: number;
    rulesStale: boolean;
    running: boolean;
    eventCount: number;
  };
  sessions: AuditSessionRecord[];
  tools: AuditToolCallRecord[];
  findings: AuditFindingRecord[];
  rules: AuditRuleRecord[];
  runs: AuditRunRecord[];
  events: AuditEventRecord[];
};

declare global {
  interface Window {
    agentDesktop: {
      // 通用 IPC 方法
      ipcInvoke: (channel: string, payload?: any) => Promise<any>;
      ipcOn: (channel: string, callback: (payload: any) => void) => any;
      ipcOff: (channel: string, handler: any) => void;

      getStatus: () => Promise<any>;
      getManagedRuntimeStatus: () => Promise<ManagedRuntimeStatus>;
      ensureManagedRuntimes: (payload?: { node?: boolean; python?: boolean; git?: boolean }) => Promise<Record<string, unknown>>;
      getAuthDebug: () => Promise<any>;
      getSettings: () => Promise<DesktopSettings>;
      updateSettings: (payload: Partial<Omit<DesktopSettings, 'webSearch'>> & {
        webSearch?: Partial<NonNullable<DesktopSettings['webSearch']>>;
      }) => Promise<DesktopSettings>;
      probeWebSearch: () => Promise<DesktopSettings>;
      usage: {
        getOverview: () => Promise<UsageOverview>;
      };
      memory: {
        getCatalog: () => Promise<MemoryCatalog>;
        readEntry: (payload:
          | { scope: 'global'; path: string; source?: 'local' | 'remote' }
          | { scope: 'project'; projectId: string; kind: 'overview' }
          | { scope: 'project'; projectId: string; kind: 'history'; sessionId: string }
          | { scope: 'session'; sessionId: string }
        ) => Promise<MemoryEntryContent>;
      };
      workflows: {
        list: (payload?: {
          cwd?: string;
          status?: WorkflowCatalogStatus;
          publishedOnly?: boolean;
        }) => Promise<WorkflowCatalogEntry[]>;
        get: (payload: { workflowId: string; revision?: number; cwd?: string }) => Promise<WorkflowCatalogDetail>;
        publish: (payload: { workflowId: string; cwd?: string }) => Promise<WorkflowCatalogDetail>;
        unpublish: (payload: { workflowId: string; cwd?: string }) => Promise<WorkflowCatalogDetail>;
        duplicate: (payload: { workflowId: string; name: string; title?: string; scope?: 'user' | 'project'; cwd?: string }) => Promise<WorkflowCatalogDetail>;
        archive: (payload: { workflowId: string; cwd?: string }) => Promise<WorkflowCatalogDetail>;
        restore: (payload: { workflowId: string; cwd?: string }) => Promise<WorkflowCatalogDetail>;
        delete: (payload: { workflowId: string; cwd?: string }) => Promise<{ deleted: true; workflowId: string }>;
        onChanged: (callback: (payload: {
          action?: string;
          workflowId?: string;
          sessionId?: string | null;
          runtimeSessionId?: string | null;
        }) => void) => () => void;
      };
      openIM: {
        getConfig: () => Promise<{
          available: boolean;
          error: string;
          platformID: number;
          dataDir: string;
          logFilePath: string;
          mediaCacheDir: string;
        }>;
        createSession: () => Promise<{
          available: true;
          userID: string;
          imToken: string;
          expiresIn: number;
          apiAddr: string;
          wsAddr: string;
          rtcEnabled: boolean;
          capabilities: { createGroup: boolean };
          user: { id: string; name: string; email: string | null; orgId: string };
        }>;
        listDirectory: () => Promise<{
          departments: Array<{
            id: string;
            orgId: string;
            parentId: string | null;
            name: string;
            userCount: number;
          }>;
          users: Array<{
            id: string;
            name: string;
            email: string | null;
            departmentId: string | null;
            status: 'active';
            openimUserID: string;
          }>;
        }>;
        prepareDirectConversation: (payload: { userID: string }) => Promise<{
          userID: string;
          name: string;
          email: string | null;
        }>;
        prepareGroupConversation: (payload: { userIDs: string[] }) => Promise<{
          groupID: string;
          memberUserIDs: string[];
        }>;
        pickFiles: (payload: { kind: 'image' | 'video' | 'audio' | 'file' }) => Promise<Array<{
          name: string;
          path: string;
          size: number;
          mediaUrl: string;
        }>>;
        prepareLocalFiles: (payload: { files: Array<{ name: string; path: string }> }) => Promise<Array<{
          name: string;
          path: string;
          size: number;
          mediaUrl: string;
        }>>;
        createVideoThumbnail: (payload: { path: string }) => Promise<{ path: string; mediaUrl: string }>;
        captureScreen: () => Promise<{
          name: string;
          path: string;
          size: number;
          mediaUrl: string;
        }>;
        download: (payload: { url: string; fileName: string }) => Promise<{
          canceled: boolean;
          filePath?: string;
        }>;
        getRtcToken: (payload: { chatToken: string; room: string; identity: string }) => Promise<{
          serverUrl: string;
          token: string;
        }>;
      };
      agentMail: {
        getStatus: () => Promise<AgentMailRuntimeStatus>;
        listPending: () => Promise<Array<Record<string, unknown>>>;
        list: (direction: 'inbox' | 'outbox', limit?: number) => Promise<{ messages: AgentMailMessage[] }>;
        delete: (messageIds: string[]) => Promise<{ messageIds: string[] }>;
        onStatusChanged: (callback: (payload: AgentMailRuntimeStatus) => void) => () => void;
      };
      authenticateRemoteServer: (payload: { serverUrl: string }) => Promise<DesktopSettings>;
      cancelRemoteServerAuthentication: () => Promise<{ canceled: boolean }>;
      getRemoteServerIdentity: () => Promise<{ userName: string; userEmail: string }>;
      listMcpServers: () => Promise<McpSettingsPayload>;
      upsertMcpServer: (payload: { previousName?: string; name: string; enabled: boolean; config: McpServerConfig }) => Promise<McpSettingsPayload>;
      removeMcpServer: (payload: { name: string }) => Promise<McpSettingsPayload>;
      setMcpServerEnabled: (payload: { name: string; enabled: boolean }) => Promise<McpSettingsPayload>;
      authenticateMcpServer: (payload: { name: string; sessionId?: string | null }) => Promise<McpSettingsPayload>;
      submitMcpAuthCallback: (payload: { name: string; callbackUrl: string }) => Promise<{ ok: boolean }>;
      clearMcpServerAuth: (payload: { name: string }) => Promise<McpSettingsPayload>;
      getAdapterConfig: () => Promise<AdapterFileConfig>;
      updateAdapterConfig: (patch: Partial<AdapterFileConfig>) => Promise<AdapterFileConfig>;
      applyAdapterRuntime: (payload: { runLocation: 'desktop' | 'server' }) => Promise<{
        config: AdapterFileConfig;
        status: FeishuAdapterStatus;
      }>;
      getAdapterStatus: () => Promise<FeishuAdapterStatus>;
      listProjectTemplates: () => Promise<ProjectTemplate[]>;
      listProjects: (payload?: { includeArchived?: boolean }) => Promise<Project[]>;
      getProject: (payload: { projectId: string }) => Promise<Project>;
      createProject: (payload: {
        name: string;
        instructions?: string;
        templateId?: string | null;
        connectorIds?: string[];
        expertIds?: string[];
        skillIds?: string[];
        decisionPolicy?: Project['decisionPolicy'];
      }) => Promise<Project>;
      updateProject: (payload: { projectId: string; updates: Partial<Project> }) => Promise<Project>;
      archiveProject: (payload: { projectId: string }) => Promise<Project>;
      listProjectAssets: (payload: { projectId: string }) => Promise<ProjectAsset[]>;
      listProjectEvents: (payload: { projectId: string }) => Promise<ProjectEvent[]>;
      listProjectDecisions: (payload: { projectId: string }) => Promise<ProjectDecision[]>;
      resolveProjectDecision: (payload: {
        projectId: string;
        decisionId: string;
        answers: Record<string, string>;
        annotations?: AskUserQuestionAnnotations;
      }) => Promise<ProjectDecision>;
      rejectProjectDecision: (payload: {
        projectId: string;
        decisionId: string;
        message?: string;
      }) => Promise<ProjectDecision>;
      getProjectMemory: (payload: { projectId: string }) => Promise<ProjectMemory>;
      addProjectAsset: (payload: { projectId: string; sourcePath: string; fileName?: string; name?: string; description?: string; sourceType?: string; sourceSessionId?: string }) => Promise<ProjectAsset>;
      removeProjectAsset: (payload: { projectId: string; assetId: string }) => Promise<{ ok: boolean }>;
      listProjectTasks: (payload: { projectId: string }) => Promise<ProjectTask[]>;
      createProjectTask: (payload: {
        projectId: string;
        task: { prompt: string };
      }) => Promise<{ task: ProjectTask; session: SessionSummary }>;
      getProjectTask: (payload: { projectId: string; taskId: string }) => Promise<ProjectTask | null>;
      library: {
        getOverview: () => Promise<LibraryOverview>;
        getExtensionStatus: () => Promise<LibraryExtensionStatus>;
        acknowledgeExtensionGuide: () => Promise<{ acknowledged: boolean }>;
        installExtensions: (payload: { packageIds: string[] }) => Promise<LibraryExtensionStatus>;
        listCollections: () => Promise<LibraryCollection[]>;
        createCollection: (payload: { name: string; description?: string; scope?: LibraryCollection['scope'] }) => Promise<LibraryCollection>;
        updateCollection: (payload: { id: string; name?: string; description?: string }) => Promise<LibraryCollection>;
        deleteCollection: (payload: { id: string }) => Promise<{ ok: boolean }>;
        listSources: (payload?: { collectionId?: string; scopeKind?: 'personal' | 'projects' | 'task-artifacts' }) => Promise<LibrarySource[]>;
        pickSources: (payload: {
          collectionId: string;
          kind: 'files';
        }) => Promise<LibrarySource[]>;
        selectDirectory: () => Promise<{ selectionId: string; name: string; path: string } | null>;
        prepareDirectoryImport: (payload: {
          collectionId: string;
          selectionId: string;
        }) => Promise<{
          workspace: string;
          title: string;
          draftPrompt: string;
        }>;
        addProjectSource: (payload: { collectionId?: string; projectId: string; name?: string }) => Promise<LibrarySource>;
        removeSource: (payload: { sourceId: string; collectionId?: string }) => Promise<{
          ok: boolean;
          deleted: boolean;
          detached: boolean;
        }>;
        refreshSource: (payload: { sourceId: string; full?: boolean }) => Promise<LibraryJob>;
        listResources: (payload?: { collectionId?: string; sourceId?: string; query?: string; projectId?: string; personalOnly?: boolean; scopeKind?: 'personal' | 'projects' | 'task-artifacts'; extensions?: string[]; limit?: number; offset?: number }) => Promise<LibraryResource[]>;
        getResource: (payload: { resourceId: string; chunkLimit?: number }) => Promise<LibraryResource & { chunks: Array<{ id: number; index: number; blockIndex: number; heading: string | null; page: number | null; startLine: number | null; endLine: number | null; locationKind: LibrarySearchResult['locationKind']; content: string }> }>;
        search: (payload: { query: string; collectionId?: string; sourceId?: string; projectId?: string; personalOnly?: boolean; scopeKind?: 'personal' | 'projects' | 'task-artifacts'; mode?: 'auto' | 'all' | 'any'; extensions?: string[]; limit?: number; includeContext?: boolean; contextBudget?: number }) => Promise<LibrarySearchResult[]>;
        diagnoseSearch: (payload: { query: string; collectionId?: string; sourceId?: string; projectId?: string; personalOnly?: boolean; scopeKind?: 'personal' | 'projects' | 'task-artifacts'; mode?: 'auto' | 'all' | 'any'; extensions?: string[]; limit?: number }) => Promise<{ items: LibrarySearchResult[]; diagnostics: LibrarySearchDiagnostics }>;
        getEvaluationOverview: () => Promise<LibraryEvaluationOverview>;
        saveEvaluationCase: (payload: { id?: string; name?: string; query: string; expectedResourceId?: string | null; expectedHeading?: string | null; collectionId?: string | null; sourceId?: string | null; scopeKind?: 'personal' | 'projects' | 'task-artifacts' }) => Promise<LibraryEvaluationCase>;
        deleteEvaluationCase: (payload: { id: string }) => Promise<{ ok: boolean }>;
        runEvaluation: (payload?: { caseIds?: string[] }) => Promise<LibraryEvaluationRun>;
        openResource: (payload: { resourceId: string }) => Promise<{ ok: boolean }>;
        showResourceInFolder: (payload: { resourceId: string }) => Promise<{ ok: boolean }>;
        listJobs: (payload?: { sourceId?: string; limit?: number }) => Promise<LibraryJob[]>;
        cancelJob: (payload: { jobId: string }) => Promise<{ ok: boolean }>;
        repairIndex: () => Promise<LibraryJob>;
        saveTaskArtifact: (payload: { sessionId: string; path: string; name?: string; collectionId?: string; target?: 'personal' | 'project' }) => Promise<{ sourceId: string; job: LibraryJob; name: string; target: 'personal' | 'project' }>;
        getMigrationPreview: () => Promise<LibraryMigrationPreview>;
        migrateLegacy: () => Promise<{ migrated: boolean; collections: number; sources: number; skipped: number }>;
        dismissLegacyMigration: () => Promise<{ ok: boolean }>;
        onChanged: (callback: (payload: { reason: string; [key: string]: unknown }) => void) => () => void;
      };
      listSessions: () => Promise<SessionSummary[]>;
      searchSessions: (payload: { query: string; limit?: number }) => Promise<SessionSearchResult[]>;
      syncRemoteSessions: () => Promise<{ ok: boolean }>;
      createSession: (payload?: { workspace?: string; title?: string; assistant_name?: string; connectorIds?: string[]; permissionMode?: PermissionMode; agentMode?: 'local' | 'remote-direct' }) => Promise<{ summary: SessionSummary; detail: SessionDetail }>;
      forkSession: (payload: { sessionId: string }) => Promise<{ summary: SessionSummary; detail: SessionDetail }>;
      getSession: (payload: { sessionId: string }) => Promise<SessionDetail>;
      getTurnChanges: (payload: { sessionId: string }) => Promise<TurnChangesPayload>;
      previewTurnRewind: (payload: { sessionId: string; userMessageId: string }) => Promise<TurnRewindPreview>;
      rewindTurn: (payload: { sessionId: string; userMessageId: string }) => Promise<{
        ok: boolean;
        userMessageId: string;
        restoredFiles: string[];
        removedHistoryEvents: number;
        auditRecorded: boolean;
      }>;
      updateSession: (payload: { sessionId: string; title: string }) => Promise<SessionDetail>;
      setSessionToolDisplayMode: (payload: {
        sessionId: string;
        mode: 'expanded' | 'collapsed' | 'merged' | null;
      }) => Promise<SessionSummary>;
      setSessionPermissionMode: (payload: {
        sessionId: string;
        mode: PermissionMode;
      }) => Promise<SessionSummary>;
      deleteSession: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      setSessionConnectors: (payload: { sessionId: string; connectorIds: string[] }) => Promise<{ success?: boolean; data?: SessionDetail & { skippedBusyRuntime?: boolean }; error?: string }>;
      listWorkspaces: (payload?: { query?: string; limit?: number }) => Promise<WorkspaceLocation[]>;
      createWorkspace: (payload: { name: string }) => Promise<WorkspaceLocation>;
      touchWorkspace: (payload: { path: string }) => Promise<WorkspaceLocation>;
      agentTeams: {
        list: (payload: { sessionId: string }) => Promise<AgentTeamsSessionState>;
        refresh: (payload: { sessionId: string }) => Promise<AgentTeamsSessionState>;
        onChanged: (callback: (payload: AgentTeamsSessionState) => void) => () => void;
      };
      agents: {
        list: (payload?: { sessionId?: string; workspace?: string }) => Promise<DesktopAgentCatalog>;
        read: (payload: { scope: 'user' | 'project'; fileName: string; sessionId?: string; workspace?: string }) => Promise<DesktopAgentDraft & { fileName: string }>;
        create: (payload: DesktopAgentDraft & { sessionId?: string; workspace?: string }) => Promise<DesktopAgentCatalog>;
        update: (payload: DesktopAgentDraft & {
          previousScope: 'user' | 'project';
          previousFileName: string;
          sessionId?: string;
          workspace?: string;
        }) => Promise<DesktopAgentCatalog>;
        delete: (payload: { scope: 'user' | 'project'; fileName: string; sessionId?: string; workspace?: string }) => Promise<DesktopAgentCatalog>;
        setEnabled: (payload: { agentType: string; enabled: boolean; sessionId?: string; workspace?: string }) => Promise<DesktopAgentCatalog>;
        onChanged: (callback: (payload: { reason?: string; agentType?: string }) => void) => () => void;
      };
      setConnectorAuthStatus: (payload: { sessionId: string; connectorId: string; connectorName?: string; status: 'pending' | 'success' | 'failed'; message?: string }) => Promise<SessionDetail>;
      listConnectors: () => Promise<{ success?: boolean; data?: { connectors: ConnectorCatalogItem[]; installed: InstalledConnector[]; catalogPath: string; installedDir: string; updatedAt: number }; error?: string }>;
      getInstalledConnectors: () => Promise<{ success?: boolean; data?: InstalledConnector[]; error?: string }>;
      refreshConnectorCliStatus: (payload: { id: string }) => Promise<{ success?: boolean; data?: { connector: InstalledConnector; connected: boolean; changed: boolean; connectionChanged: boolean }; error?: string }>;
      installConnector: (payload: { id: string }) => Promise<{ success?: boolean; data?: { connector?: InstalledConnector; cli?: Record<string, any> | null }; error?: string }>;
      uninstallConnector: (payload: { id: string }) => Promise<{ success?: boolean; data?: { ok: boolean; id: string }; error?: string }>;
      saveConnectorMcpToken: (payload: { connectorId: string; serverName: string; token?: string; url?: string }) => Promise<{ success?: boolean; data?: { ok: boolean; connectorId: string; serverName: string }; error?: string }>;
      saveConnectorCredentials: (payload: { connectorId: string; values: Record<string, string> }) => Promise<{ success?: boolean; data?: { ok: boolean; connectorId: string; configuredFields: string[]; requiresAuthentication?: boolean }; error?: string }>;
      provisionConnectorCredentials: (payload: { connectorId: string }) => Promise<{ success?: boolean; data?: { ok: boolean; connectorId: string; configuredFields: string[]; provisioned: boolean }; error?: string }>;
      pickDirectory: () => Promise<string | null>;
      pickFiles: () => Promise<Array<{ name: string; path: string }>>;
      setSessionWorkspace: (payload: { sessionId: string; workspace: string }) => Promise<SessionDetail>;
      openWorkspace: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      copyFileToWorkspace: (payload: { sessionId: string; sourcePath: string; fileName: string }) => Promise<{ path: string } | { error: string }>;
      send: (payload: {
        sessionId: string;
        prompt: string;
        skills?: Array<{ name: string; displayName?: string; source?: string }>;
        agentType?: string;
        mode?: 'chat' | 'boss';
        appName?: string;
        files?: string[];
        resources?: ComposerResourceRef[];
      }) => Promise<any>;
      approvePlan: (payload: { sessionId: string }) => Promise<any>;
      rejectPlan: (payload: { sessionId: string }) => Promise<any>;
      answerQuestion: (payload: {
        requestId: string;
        sessionId: string;
        answers: Record<string, string>;
        annotations?: AskUserQuestionAnnotations;
      }) => Promise<{ ok: boolean }>;
      rejectQuestion: (payload: {
        requestId: string;
        sessionId: string;
        message?: string;
      }) => Promise<{ ok: boolean }>;
      abort: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      appMarketplace: {
        list: (payload?: { forceRefresh?: boolean }) => Promise<AppMarketplaceCatalog>;
        getDetails: (payload: { appId: string; forceRefresh?: boolean }) => Promise<AppMarketplaceDetail>;
        install: (payload: { appId: string; version?: string; acceptPermissions?: boolean }) => Promise<{
          ok: boolean;
          alreadyInstalled?: boolean;
          requiresPermissionApproval?: boolean;
          permissions?: string[];
          appId: string;
          version: string;
          app?: StoredApp;
        }>;
      };
      listApps: () => Promise<StoredApp[]>;
      listAppVersions: (payload: { name: string }) => Promise<AppVersion[]>;
      launchApp: (payload: { name: string }) => Promise<{ ok: boolean; error?: string }>;
      openEmbeddedApp: (payload: { name: string }) => Promise<{
        ok: boolean;
        error?: string;
        embedId?: string;
        url?: string;
        preload?: string;
        app?: {
          id: string;
          name: string;
          displayName: string;
          description: string;
        };
      }>;
      attachEmbeddedApp: (payload: { embedId: string; webContentsId: number }) => Promise<{ ok: boolean; error?: string }>;
      closeEmbeddedApp: (payload: { embedId: string }) => Promise<{ ok: boolean; error?: string }>;
      rollbackApp: (payload: { name: string; versionId: string }) => Promise<{ ok: boolean; app: StoredApp; error?: string }>;
      deleteApp: (payload: { name: string; deleteData?: boolean; deleteCredentials?: boolean }) => Promise<{ ok: boolean; error?: string }>;
      installAppArchive: () => Promise<{ ok: boolean; canceled?: boolean; app?: StoredApp; error?: string }>;
      installAppOnServer: (payload: { appId: string; version: string }) => Promise<any>;
      uninstallAppOnServer: (payload: { appId: string; deleteData?: boolean; deleteCredentials?: boolean }) => Promise<any>;
      getAppRuntimeState: (payload: { appId: string; target?: 'desktop' | 'server' }) => Promise<any>;
      listAppContributions: (payload?: { appId?: string; kinds?: string[]; includeUnavailable?: boolean; loadSchemas?: boolean }) => Promise<Record<string, any[]>>;
      invokeAppContribution: (payload: { kind: 'commands' | 'resourceProviders'; id: string; input?: unknown; instanceId?: string; requestId?: string; timeoutMs?: number }) => Promise<unknown>;
      setAppEnabled: (payload: { appId: string; enabled: boolean; target?: 'desktop' | 'server' }) => Promise<any>;
      setAppGrants: (payload: { appId: string; grants: string[]; target?: 'desktop' | 'server' }) => Promise<any>;
      listAppInstances: (payload: { appId: string; target?: 'desktop' | 'server' }) => Promise<AppInstance[]>;
      createAppInstance: (payload: { appId: string; displayName: string; config?: Record<string, any>; secrets?: Record<string, string>; enabled?: boolean; target?: 'desktop' | 'server' }) => Promise<AppInstance>;
      updateAppInstance: (payload: { appId: string; instanceId: string; displayName?: string; config?: Record<string, any>; secrets?: Record<string, string>; target?: 'desktop' | 'server' }) => Promise<AppInstance>;
      setAppInstanceEnabled: (payload: { appId: string; instanceId: string; enabled: boolean; target?: 'desktop' | 'server' }) => Promise<any>;
      clearAppInstanceCredentials: (payload: { appId: string; instanceId: string; target?: 'desktop' | 'server' }) => Promise<any>;
      removeAppInstance: (payload: { appId: string; instanceId: string; deleteData?: boolean; deleteCredentials?: boolean; target?: 'desktop' | 'server' }) => Promise<{ ok: boolean }>;
      restartAppInstance: (payload: { appId: string; instanceId: string; target?: 'desktop' | 'server' }) => Promise<any>;
      getAppInstanceLogs: (payload: { appId: string; instanceId: string; limit?: number; target?: 'desktop' | 'server' }) => Promise<any[]>;
      moveAppInstance: (payload: { appId: string; instanceId: string; from: 'desktop' | 'server'; to: 'desktop' | 'server'; secrets?: Record<string, string>; deleteSourceCredentials?: boolean }) => Promise<any>;
      saveApp: (payload: { sessionId: string; launch?: boolean }) => Promise<{ ok: boolean; app?: StoredApp; error?: string }>;
      listWorkspaceDir: (payload: { sessionId: string; dirPath?: string }) => Promise<any>;
      readWorkspaceFile: (payload: { sessionId: string; filePath: string }) => Promise<WorkspacePreviewData>;
      document: {
        convert: (payload: { filePath: string; to: 'libreoffice-pdf' | 'markdown' | 'word-html' | 'excel-json' | 'ppt-json' | 'pptx-arraybuffer' }) => Promise<any>;
        libreOffice: {
          isAvailable: () => Promise<boolean>;
        };
      };
      libreOffice: {
        checkInstalled: () => Promise<any>;
        install: () => Promise<any>;
        installFromLocalFile: (payload: { filePath: string }) => Promise<any>;
        uninstall: () => Promise<any>;
        getInstallState: () => Promise<any>;
        onInstallProgress: (callback: (payload: { phase: string; percent?: number }) => void) => () => void;
        onInstallResult: (callback: (payload: { success: boolean; msg?: string }) => void) => () => void;
      };
      previewHistory: {
        list: (payload: { target: PreviewHistoryTarget }) => Promise<PreviewSnapshotInfo[]>;
        save: (payload: { target: PreviewHistoryTarget; content: string }) => Promise<PreviewSnapshotInfo>;
        getContent: (payload: { target: PreviewHistoryTarget; snapshotId: string }) => Promise<{ snapshot: PreviewSnapshotInfo; content: string } | null>;
      };
      preview: {
        open: (payload: PreviewOpenPayload) => Promise<{ ok: boolean }>;
        sync: (payload: { files: WorkspacePreviewData[] }) => Promise<{ ok: boolean }>;
        ready: () => Promise<{ ok: boolean }>;
        close: () => Promise<{ ok: boolean }>;
        onOpen: (callback: (payload: PreviewOpenPayload) => void) => () => void;
        onSync: (callback: (payload: { files: WorkspacePreviewData[] }) => void) => () => void;
      };
      browser: {
        getState: (payload: { sessionId?: string | null }) => Promise<BrowserState>;
        openTab: (payload: BrowserOpenTabPayload) => Promise<BrowserState>;
        activateTab: (payload: BrowserTabTarget & { tabId: string }) => Promise<BrowserState>;
        closeTab: (payload: BrowserTabTarget & { tabId: string }) => Promise<BrowserState>;
        navigate: (payload: BrowserTabTarget & { url: string }) => Promise<BrowserState>;
        goBack: (payload: BrowserTabTarget) => Promise<BrowserState>;
        goForward: (payload: BrowserTabTarget) => Promise<BrowserState>;
        reload: (payload: BrowserTabTarget) => Promise<BrowserState>;
        stop: (payload: BrowserTabTarget) => Promise<BrowserState>;
        toggleDevTools: (payload: BrowserTabTarget) => Promise<BrowserState>;
        completeAuth: (payload: BrowserTabTarget & {
          title?: string;
          authKind?: "connector" | "mcp";
          serverName?: string;
          eventId?: string;
        }) => Promise<BrowserState>;
        getPendingAuthNavigations: (payload: { sessionId?: string | null }) => Promise<BrowserAuthNavigation[]>;
        ackAuthNavigation: (payload: { sessionId?: string | null; eventId: string }) => Promise<{ ok: boolean }>;
        setHost: (payload: {
          sessionId?: string | null;
          visible: boolean;
          bounds?: { x: number; y: number; width: number; height: number };
        }) => void;
        onOpen: (callback: (payload: {
          url: string;
          sessionId?: string | null;
          alreadyOpened?: boolean;
          connectorAuth?: {
            connectorId: string;
            serverName: string;
            displayName?: string;
            tokenParam?: string;
            allowedHosts?: string[];
          } | null;
          mcpAuth?: {
            serverName: string;
            displayName?: string;
          } | null;
        }) => void) => () => void;
        onState: (callback: (payload: { sessionId: string; state: BrowserState }) => void) => () => void;
        onAuthNavigation: (callback: (payload: BrowserAuthNavigation) => void) => () => void;
        onExternalUrl: (callback: (payload: { sessionId?: string; tabId?: string; url: string }) => void) => () => void;
      };
      audit: {
        getDashboard: () => Promise<AuditDashboardPayload>;
        getEvent: (payload: { id: string }) => Promise<AuditEventDetail>;
        getPendingAlerts: () => Promise<AuditAlert[]>;
        run: (payload?: { sessionIds?: string[] }) => Promise<{
          ok: boolean;
          runId: string;
          sessionCount: number;
          toolCallCount: number;
          findingCount: number;
        }>;
        updateRule: (payload: {
          id: string;
          enabled?: boolean;
          severity?: AuditSeverity;
          config?: AuditRuleRecord['config'];
        }) => Promise<AuditRuleRecord>;
        updateFinding: (payload: { id: string; status: AuditFindingStatus }) => Promise<{ ok: boolean }>;
        updateFindings: (payload: { ids: string[]; status: AuditFindingStatus }) => Promise<{
          ok: boolean;
          updatedCount: number;
        }>;
        markReported: (payload: { fingerprints: string[] }) => Promise<{
          ok: boolean;
          updatedCount: number;
        }>;
        onChanged: (callback: (payload: {
          reason: string;
          runId?: string;
          scope?: { kind?: string; sessionIds?: string[] };
          completed?: number;
          total?: number;
          error?: string;
          alerts?: AuditAlert[];
        }) => void) => () => void;
      };
      notifications: {
        list: () => Promise<AppNotification[]>;
        create: (notification: NewAppNotification, options?: { id?: string; now?: number }) => Promise<AppNotification>;
        importLegacy: (notifications: AppNotification[]) => Promise<AppNotification[]>;
        markRead: (id: string) => Promise<AppNotification[]>;
        markAllRead: () => Promise<AppNotification[]>;
        remove: (id: string) => Promise<AppNotification[]>;
        clear: () => Promise<AppNotification[]>;
        onChanged: (callback: (payload: {
          reason: string;
          notification?: AppNotification | null;
          notifications: AppNotification[];
        }) => void) => () => void;
      };
      decisions: {
        respond: (payload: { decisionId: string; allowed: boolean; choice?: string }) => Promise<{
          id: string;
          sessionId: string;
          status: string;
        }>;
      };
      workspace: {
        writeFile: (payload: { sessionId: string; filePath: string; content: string }) => Promise<WorkspacePreviewData>;
      };
      shell: {
        openFile: (filePath: string) => Promise<string>;
        openExternal: (url: string) => Promise<{ ok: boolean }>;
        showItemInFolder: (filePath: string) => Promise<{ ok: boolean }>;
      };
      fs: {
        getImageBase64: (path: string) => Promise<string | null>;
        getFileMetadata: (path: string) => Promise<{ size: number } | null>;
        getHomeDir: () => Promise<string>;
        createTempFile: (fileName: string) => Promise<string | null>;
        writeFile: (path: string, data: number[]) => Promise<boolean>;
        saveImageToWorkspace: (sessionId: string, fileName: string, data: number[]) => Promise<{ path: string } | { error: string }>;
        getAppIcon: () => Promise<string | null>;
      };
      listBackgroundTasks: (payload: { sessionId: string }) => Promise<{ tasks: BackgroundTaskInfo[] }>;
      getTaskOutput: (payload: { sessionId: string; taskId: string; maxBytes?: number }) => Promise<{ content: string; truncated: boolean }>;
      killTask: (payload: { sessionId: string; taskId: string }) => Promise<{ ok: boolean; error?: string }>;
      onBackgroundTasks: (callback: (payload: { sessionId: string; tasks: BackgroundTaskInfo[] }) => void) => () => void;
      onEvent: (callback: (payload: any) => void) => () => void;
      onState: (callback: (payload: any) => void) => () => void;
      onPermission: (callback: (payload: any) => void) => () => void;
      onQuestionRequest: (callback: (payload: AskUserQuestionRequest) => void) => () => void;
      onQuestionResolved: (callback: (payload: { requestId: string; sessionId: string }) => void) => () => void;
      onSessionMeta: (callback: (payload: SessionSummary) => void) => () => void;
      onSessionHistory: (callback: (payload: {
        sessionId: string;
        summary?: SessionSummary;
        history?: AgentEvent[];
        tasks?: SessionTask[];
      }) => void) => () => void;
      onSessionRemoved: (callback: (payload: { sessionId: string }) => void) => () => void;
      onWorkspaceChanged: (callback: (payload: any) => void) => () => void;
      onAppsChanged: (callback: (payload: any) => void) => () => void;
      onSettingsChanged: (callback: (payload: DesktopSettings) => void) => () => void;
      onAdapterStatus: (callback: (payload: FeishuAdapterStatus) => void) => () => void;
      onProjectsChanged: (callback: (payload: { projectId?: string; reason?: string }) => void) => () => void;
      onAssistantsChanged: (callback: (payload: { reason?: string; expertId?: string; sourcePath?: string }) => void) => () => void;
      listCoordinatorTasks: (sessionId?: string) => Promise<{ tasks: CoordinatorTask[] }>;
      getWorkerResults: (payload: { sessionId: string }) => Promise<{ results: Record<string, WorkerSubagentResult> }>;
      setWorkerSummaries: (payload: { sessionId: string; workerSummariesJson: string | null }) => Promise<{ ok: boolean }>;
      cronList: () => Promise<CronTask[]>;
      cronDelete: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
      getInstalledAssistants: () => Promise<{ success: boolean; data?: InstalledAssistant[]; error?: string }>;
      getAssistantContext: (assistantName: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      getSkillInfosByIds: (skillIds: string[]) => Promise<{ success: boolean; data?: Array<{ id: string; name: string; path: string }>; error?: string }>;
      logWrite: (payload: { level?: string; category?: string; message: string; data?: unknown }) => Promise<void>;
      update: {
        check: (params?: { includePrerelease?: boolean }) => Promise<{ success: boolean; data?: UpdateCheckResult; msg?: string }>;
        download: (params: { url: string; fileName?: string }) => Promise<{ success: boolean; data?: { downloadId: string; filePath: string }; msg?: string }>;
        onOpenModal: (callback: () => void) => () => void;
        onDownloadProgress: (callback: (evt: UpdateDownloadProgressEvent) => void) => () => void;
      };
      autoUpdate: {
        check: (params?: { includePrerelease?: boolean }) => Promise<{ success: boolean; data?: { updateInfo?: { version: string; releaseDate?: string; releaseNotes?: string } }; msg?: string }>;
        download: () => Promise<{ success: boolean; msg?: string }>;
        quitAndInstall: () => Promise<{ success: boolean; msg?: string }>;
        getDownloadedFilePath: () => Promise<{ success: boolean; data?: { path: string | null } }>;
        getMirrorStatus: () => Promise<{ success: boolean; data?: { useMirror: boolean; reason: string } }>;
        onStatus: (callback: (evt: AutoUpdateStatus) => void) => () => void;
      };
    };
  }
}

export type CoordinatorTask = {
  id: string;
  agentId: string | null;
  name: string;
  status: string;
  isIdle: boolean;
  description: string;
  color: string;
};

export type CronTask = {
  id: string;
  cron: string;
  prompt: string;
  createdAt: number;
  lastFiredAt?: number;
  recurring?: boolean;
  permanent?: boolean;
};

export type WorkerSubagentResult = {
  resultText: string | null;
  status: string;
  events: any[];
};

export type InstalledAssistant = {
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  emoji: string;
  category: string;
  categories: string[];
  version: string;
  source: string;
  isBuiltin: boolean;
  isHubInstalled: boolean;
  tag: string;
  enabled: boolean;
  skills: string[];
  enabledSkills: string[];
};

// Update types
export type UpdateReleaseInfo = {
  tagName: string;
  version: string;
  name?: string;
  body?: string;
  htmlUrl: string;
  publishedAt?: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubReleaseAsset[];
  recommendedAsset?: GitHubReleaseAsset;
};

export type GitHubReleaseAsset = {
  name: string;
  url: string;
  size: number;
  contentType?: string;
};

export type UpdateCheckResult = {
  currentVersion: string;
  updateAvailable: boolean;
  latest?: UpdateReleaseInfo;
};

export type UpdateDownloadProgressEvent = {
  downloadId: string;
  status: 'starting' | 'downloading' | 'completed' | 'error' | 'cancelled';
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
  bytesPerSecond?: number;
  filePath?: string;
  error?: string;
};

export type AutoUpdateStatus = {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'cancelled';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  progress?: {
    bytesPerSecond: number;
    percent: number;
    transferred: number;
    total: number;
  };
  error?: string;
  downloadedFilePath?: string;
};

export {};
