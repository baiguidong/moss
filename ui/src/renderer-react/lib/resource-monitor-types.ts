export type ResourceProcess = {
  id: string;
  pid: number | null;
  ppid?: number;
  name: string;
  kind: 'main' | 'app' | 'renderer' | 'helper' | 'child';
  state: string;
  appId?: string;
  appName?: string;
  instanceId?: string;
  parentName?: string;
  lifecycle?: string;
  startedAt?: number;
  lastHeartbeatAt?: number;
  lastError?: string;
  recentCrashCount?: number;
  pendingActions?: number;
  canManage?: boolean;
  canRestart?: boolean;
  orphaned?: boolean;
  cpuPercent: number | null;
  memoryBytes: number | null;
  cpuHighSince: number | null;
};

export type ResourceFrame = {
  timestamp: number;
  cpuPercent: number | null;
  memoryBytes: number | null;
  processes: Array<Pick<ResourceProcess, 'id' | 'cpuPercent' | 'memoryBytes'>>;
};

export type ResourceAlert = {
  id: string;
  processId: string;
  name: string;
  kind: 'cpu' | 'crash' | 'runtime' | 'heartbeat' | 'orphan';
  message: string;
  startedAt: number;
  detectedAt: number;
  endedAt: number | null;
  peakCpu: number | null;
};

export type ResourceMonitorSnapshot = {
  sampledAt: number;
  lastSuccessAt: number;
  cpuPercent: number | null;
  memoryBytes: number | null;
  cpuCount: number;
  processCount: number;
  processes: ResourceProcess[];
  loopDelayMs: number | null;
  collectionMs: number;
  error: string;
  alerts: ResourceAlert[];
  events: ResourceAlert[];
  history: ResourceFrame[];
};
