/**
 * 文件管理模块 - 类型定义
 */

export interface FileManagerFile {
  id: number;
  path: string;
  filename: string;
  extension: string;
  file_type: 'image' | 'video' | 'document' | 'audio' | 'other';
  mime_type: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  created_at: string;
  modified_at: string;
  scan_date: string;
  exif_date?: string;
  checksum?: string;
  thumbnail_path?: string;
  is_encrypted: boolean;
  is_duplicate: boolean;
  duplicate_of?: number;
}

export interface ScanTask {
  id: number;
  name: string;
  source_paths: string[];
  target_path: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'paused';
  progress: number;
  total_files: number;
  processed_files: number;
  error_files: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  config?: ScanConfig;
}

export interface ScanConfig {
  name?: string;
  targetPath?: string;
  recursive?: boolean;
  fileTypes?: string[];
  maxSize?: number;
}

export interface EncryptedFile {
  id: number;
  original_id: number;
  encrypted_path: string;
  original_filename: string;
  file_type: string;
  original_size: number;
  encrypted_size: number;
  password_hint?: string;
  encryption_algo: string;
  created_at: string;
  last_accessed?: string;
}

export interface Category {
  id: number;
  name: string;
  parent_id?: number;
  path_pattern: string;
  ai_prompt?: string;
  color?: string;
  icon?: string;
  sort_order: number;
}

export interface FileFilter {
  fileType?: string;
  category?: string;
  isEncrypted?: boolean;
  limit?: number;
  offset?: number;
}

export interface ScanProgress {
  taskId: number;
  progress: number;
  totalFiles: number;
  processedFiles: number;
  errorFiles: number;
  status?: string;
}

export interface FileManagerStats {
  totalFiles: number;
  organizedFiles: number;
  encryptedFiles: number;
  byType: Array<{ file_type: string; count: number }>;
}

// IPC API 类型
export interface FileManagerAPI {
  // 扫描
  startScan: (paths: string[], config: ScanConfig) => Promise<ScanTask>;
  executeScan: (taskId: number) => Promise<{ success: boolean; totalFiles: number; processedFiles: number; errorFiles: number }>;
  stopScan: (taskId: number) => Promise<{ success: boolean }>;
  getScanProgress: (taskId: number) => Promise<ScanTask>;
  getScanTasks: () => Promise<ScanTask[]>;

  // 文件操作
  getFiles: (filter: FileFilter) => Promise<FileManagerFile[]>;
  getFileDetail: (fileId: number) => Promise<FileManagerFile>;
  readFile: (filePath: string, asDataUrl?: boolean) => Promise<{ dataUrl?: string; data?: string; error?: string }>;

  // 分类
  getCategories: () => Promise<Category[]>;

  // 加密
  getEncryptedFiles: () => Promise<EncryptedFile[]>;
  encryptFile: (fileId: number, password: string, hint?: string) => Promise<{ success: boolean; encryptedPath?: string; error?: string }>;
  decryptFile: (encryptedId: number, password: string) => Promise<{ success: boolean; tempPath?: string; error?: string }>;

  // 统计
  getStats: () => Promise<FileManagerStats>;

  // 事件
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
}

declare global {
  interface Window {
    fileManager?: FileManagerAPI;
  }
}