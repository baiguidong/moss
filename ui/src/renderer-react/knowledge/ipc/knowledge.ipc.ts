/**
 * 知识库模块 - IPC 客户端
 * 封装渲染层对主进程的调用。
 */

export interface KbDocument {
  id: number;
  source_path: string;
  file_name: string;
  source_mtime: number | null;
  source_size: number | null;
  status: 'pending' | 'parsing' | 'done' | 'error';
  page_count: number;
  block_count: number;
  parse_seconds: number | null;
  output_dir: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbScanProgress {
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  currentFile: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  error?: string;
}

export interface KbConnectionResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export type KbBackend = 'pipeline' | 'vlm-engine' | 'hybrid-engine';

export interface KbStartScanParams {
  dir: string;
  lang?: string;
  recursive?: boolean;
  serverUrl?: string;
  backend?: KbBackend;
}

export const knowledgeAPI = {
  testConnection: (serverUrl?: string) =>
    window.agentDesktop.ipcInvoke('knowledge:testConnection', { serverUrl }) as Promise<KbConnectionResult>,

  startScan: (params: KbStartScanParams) =>
    window.agentDesktop.ipcInvoke('knowledge:startScan', params) as Promise<{ started: boolean; total?: number; error?: string }>,

  stopScan: () =>
    window.agentDesktop.ipcInvoke('knowledge:stopScan', {}) as Promise<{ success: boolean }>,

  getDocuments: () =>
    window.agentDesktop.ipcInvoke('knowledge:getDocuments', {}) as Promise<KbDocument[]>,

  getDocumentMarkdown: (id: number) =>
    window.agentDesktop.ipcInvoke('knowledge:getDocumentMarkdown', { id }) as Promise<{ markdown?: string; error?: string }>,

  onScanProgress: (callback: (data: KbScanProgress) => void) => {
    const handler = (data: KbScanProgress) => callback(data);
    window.agentDesktop.ipcOn('knowledge:scanProgress', handler);
    return () => window.agentDesktop.ipcOff('knowledge:scanProgress', handler);
  },
};

export default knowledgeAPI;
