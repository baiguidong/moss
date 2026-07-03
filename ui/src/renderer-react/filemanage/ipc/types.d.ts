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
  insertedFiles?: number;
  indeterminate?: boolean;
  currentFile?: string;
  status?: string;
  error?: string;
}

export interface AudioTrackMeta {
  id: number;
  path: string;
  filename: string;
  duration?: number;
  thumbnail_path?: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  track?: number;
  year?: number;
  cover_path?: string;
}

export interface ThumbnailProgress {
  taskId: number | string;
  processed: number;
  total: number;
  currentFile?: string;
  status?: string;
  error?: string;
}

export interface AnalyzeProgress {
  processed?: number;
  total?: number;
  phase?: string;
  status?: string;
  images?: number;
  duplicates?: number;
  events?: number;
  error?: string;
}

export interface FileEvent {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  photo_count: number;
  cover_file_id?: number;
  ai_named?: number;
  cover_path?: string;
  cover_thumbnail?: string;
}

export interface DuplicateFile {
  id: number;
  path: string;
  filename: string;
  thumbnail_path?: string;
  duplicate_of: number;
  quality_score?: number;
}

export interface FileManagerStats {
  totalFiles: number;
  organizedFiles: number;
  encryptedFiles: number;
  byType: Array<{ file_type: string; count: number }>;
}

export interface SlideshowOptions {
  images?: string[];        // 显式照片绝对路径
  fileIds?: number[];       // 或按文件 id 选材
  eventId?: number;         // 或按事件取选优照片
  maxPhotos?: number;       // 按事件取材时的上限
  audio?: string;           // 背景音乐绝对路径
  audioId?: number;         // 或从音频库选一首
  output?: string;          // 输出 mp4 路径(默认 ~/.moss/exports)
  width?: number;
  height?: number;
  perImage?: number;        // 每张展示秒数(含转场)
  transition?: number;      // 转场秒数
  fps?: number;
}

export interface SlideshowFile {
  path: string;
  name: string;
  size: number;
  mtime: number; // ms since epoch
}

export interface SlideshowProgress {
  taskId: string;
  percent?: number;
  outTime?: number;
  status?: 'running' | 'completed' | 'error';
  output?: string;
  error?: string;
}

// 语音转写
export interface TranscriptResult {
  text?: string;
  language?: string;
  model?: string;
  status?: 'done' | 'error';
}

export interface TranscribeProgress {
  fileId: number;
  progress: number;          // 0-100, -1 表示转码中(不确定)
  status?: 'running' | 'completed' | 'cancelled' | 'error';
  length?: number;
  error?: string;
}

export interface ModelDownloadProgress {
  model: string;
  percent: number;
  received?: number;   // 已下载字节
  total?: number;      // 总字节 (0 表示未知)
  speed?: number;      // 瞬时速度, 字节/秒
  dir?: string;        // 模型保存目录
  path?: string;       // 模型文件绝对路径
  status?: 'downloading' | 'completed' | 'error' | 'cancelled';
  error?: string;
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
  getAudioTracks: () => Promise<AudioTrackMeta[]>;
  readFile: (filePath: string, asDataUrl?: boolean) => Promise<{ dataUrl?: string; data?: string; error?: string }>;
  revealInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;

  // 分类
  getCategories: () => Promise<Category[]>;

  // 加密
  getEncryptedFiles: () => Promise<EncryptedFile[]>;
  encryptFile: (fileId: number, password: string, hint?: string) => Promise<{ success: boolean; encryptedPath?: string; error?: string }>;
  decryptFile: (encryptedId: number, password: string) => Promise<{ success: boolean; tempPath?: string; error?: string }>;

  // 统计
  getStats: () => Promise<FileManagerStats>;

  // 缩略图 / 媒体增强
  generateThumbnails: () => Promise<{ success: boolean; started?: boolean; error?: string }>;

  // 本地分析 (去重 / 质量 / 事件)
  analyzePhotos: () => Promise<{ success: boolean; error?: string }>;
  getEvents: () => Promise<FileEvent[]>;
  getEventFiles: (eventId: number) => Promise<FileManagerFile[]>;
  getDuplicates: () => Promise<DuplicateFile[]>;

  // 集锦短视频导出
  renderSlideshow: (options: SlideshowOptions) => Promise<{ success?: boolean; output?: string; error?: string }>;
  listSlideshows: () => Promise<SlideshowFile[]>;
  cancelSlideshow: (taskId?: string) => Promise<{ success: boolean }>;

  // 语音转写 (本地 whisper.cpp)
  transcribeFile: (fileId: number, model?: string) => Promise<{ success?: boolean; message?: string; error?: string }>;
  getTranscript: (fileId: number) => Promise<TranscriptResult | null>;
  stopTranscribe: (fileId: number) => Promise<{ success: boolean }>;

  // 事件
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
  onThumbnailProgress: (callback: (progress: ThumbnailProgress) => void) => () => void;
  onAnalyzeProgress: (callback: (progress: AnalyzeProgress) => void) => () => void;
  onSlideshowProgress: (callback: (progress: SlideshowProgress) => void) => () => void;
  onTranscribeProgress: (callback: (progress: TranscribeProgress) => void) => () => void;
  onModelDownloadProgress: (callback: (progress: ModelDownloadProgress) => void) => () => void;
}

declare global {
  interface Window {
    fileManager?: FileManagerAPI;
  }
}