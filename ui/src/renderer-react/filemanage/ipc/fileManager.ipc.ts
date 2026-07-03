/**
 * 文件管理模块 - IPC 客户端
 * 前端调用后端 API 的封装
 */

import type { FileManagerAPI, ScanConfig, FileFilter, ScanProgress, ScanTask, FileManagerFile, Category, EncryptedFile, FileManagerStats, ThumbnailProgress, AudioTrackMeta, AnalyzeProgress, FileEvent, DuplicateFile, SlideshowOptions, SlideshowFile, SlideshowProgress, TranscriptResult, TranscribeProgress, ModelDownloadProgress } from './types';

// 创建 IPC 调用函数
function createIpcCall<T>(channel: string): (...args: unknown[]) => Promise<T> {
  return async (...args: unknown[]) => {
    // 将参数包装为对象格式 { param1: value1, param2: value2 }
    const params = args.length > 0 ? args[0] : {};
    const result = await window.agentDesktop.ipcInvoke(channel, params);
    return result as T;
  };
}

// 创建事件监听函数
// preload 的 ipcOn 已剥离 event、只回传 data，并返回包装后的 handler 供 ipcOff 使用
function createIpcListener<T>(channel: string): (callback: (data: T) => void) => () => void {
  return (callback: (data: T) => void) => {
    const wrapped = (window.agentDesktop.ipcOn as unknown as (
      channel: string,
      cb: (data: T) => void,
    ) => unknown)(channel, (data) => callback(data));
    return () => window.agentDesktop.ipcOff(channel, wrapped);
  };
}

// 文件管理 API 实现
export const fileManagerAPI: FileManagerAPI = {
  // 扫描
  startScan: async (paths: string[], config: ScanConfig) => {
    return await window.agentDesktop.ipcInvoke('fileManager:startScan', { paths, config }) as ScanTask;
  },
  executeScan: async (taskId: number) => {
    return await window.agentDesktop.ipcInvoke('fileManager:executeScan', { taskId });
  },
  stopScan: async (taskId: number) => {
    return await window.agentDesktop.ipcInvoke('fileManager:stopScan', { taskId });
  },
  getScanProgress: async (taskId: number) => {
    return await window.agentDesktop.ipcInvoke('fileManager:getScanProgress', { taskId }) as ScanTask;
  },
  getScanTasks: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:getScanTasks') as ScanTask[];
  },

  // 文件操作
  getFiles: async (filter: FileFilter) => {
    return await window.agentDesktop.ipcInvoke('fileManager:getFiles', { filter }) as FileManagerFile[];
  },
  getFileDetail: async (fileId: number) => {
    return await window.agentDesktop.ipcInvoke('fileManager:getFileDetail', { fileId }) as FileManagerFile;
  },
  getAudioTracks: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:getAudioTracks') as AudioTrackMeta[];
  },
  readFile: async (filePath: string, asDataUrl: boolean = true) => {
    return await window.agentDesktop.ipcInvoke('fileManager:readFile', { filePath, asDataUrl });
  },
  revealInFolder: async (filePath: string) => {
    return await window.agentDesktop.ipcInvoke('fileManager:revealInFolder', { filePath }) as { success: boolean; error?: string };
  },
  openFile: async (filePath: string) => {
    return await window.agentDesktop.ipcInvoke('fileManager:openFile', { filePath }) as { success: boolean; error?: string };
  },

  // 分类
  getCategories: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:getCategories') as Category[];
  },

  // 加密
  getEncryptedFiles: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:getEncryptedFiles') as EncryptedFile[];
  },
  encryptFile: async (fileId: number, password: string, hint?: string) => {
    return await window.agentDesktop.ipcInvoke('fileManager:encryptFile', { fileId, password, hint });
  },
  decryptFile: async (encryptedId: number, password: string) => {
    return await window.agentDesktop.ipcInvoke('fileManager:decryptFile', { encryptedId, password });
  },

  // 统计
  getStats: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:getStats') as FileManagerStats;
  },

  // 缩略图 / 媒体增强
  generateThumbnails: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:generateThumbnails');
  },

  // 本地分析 (去重 / 质量 / 事件)
  analyzePhotos: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:analyzePhotos');
  },
  getEvents: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:getEvents') as FileEvent[];
  },
  getEventFiles: async (eventId: number) => {
    return await window.agentDesktop.ipcInvoke('fileManager:getEventFiles', { eventId }) as FileManagerFile[];
  },
  getDuplicates: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:getDuplicates') as DuplicateFile[];
  },

  // 集锦短视频导出
  renderSlideshow: async (options: SlideshowOptions) => {
    return await window.agentDesktop.ipcInvoke('fileManager:renderSlideshow', options) as { success?: boolean; output?: string; error?: string };
  },
  listSlideshows: async () => {
    return await window.agentDesktop.ipcInvoke('fileManager:listSlideshows') as SlideshowFile[];
  },
  cancelSlideshow: async (taskId?: string) => {
    return await window.agentDesktop.ipcInvoke('fileManager:cancelSlideshow', { taskId }) as { success: boolean };
  },

  // 事件
  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const handler = (data: ScanProgress) => {
      console.log('[FileManager] Received scanProgress:', data);
      callback(data);
    };
    window.agentDesktop.ipcOn('fileManager:scanProgress', handler);
    return () => window.agentDesktop.ipcOff('fileManager:scanProgress', handler);
  },

  onThumbnailProgress: (callback: (progress: ThumbnailProgress) => void) => {
    const handler = (data: ThumbnailProgress) => callback(data);
    window.agentDesktop.ipcOn('fileManager:thumbnailProgress', handler);
    return () => window.agentDesktop.ipcOff('fileManager:thumbnailProgress', handler);
  },

  onAnalyzeProgress: (callback: (progress: AnalyzeProgress) => void) => {
    const handler = (data: AnalyzeProgress) => callback(data);
    window.agentDesktop.ipcOn('fileManager:analyzeProgress', handler);
    return () => window.agentDesktop.ipcOff('fileManager:analyzeProgress', handler);
  },

  onSlideshowProgress: (callback: (progress: SlideshowProgress) => void) => {
    const handler = (data: SlideshowProgress) => callback(data);
    window.agentDesktop.ipcOn('fileManager:slideshowProgress', handler);
    return () => window.agentDesktop.ipcOff('fileManager:slideshowProgress', handler);
  },

  // 语音转写 (本地 whisper.cpp)
  transcribeFile: async (fileId: number, model?: string) => {
    return await window.agentDesktop.ipcInvoke('fileManager:transcribeFile', { fileId, model }) as { success?: boolean; message?: string; error?: string };
  },
  getTranscript: async (fileId: number) => {
    return await window.agentDesktop.ipcInvoke('fileManager:getTranscript', { fileId }) as TranscriptResult | null;
  },
  stopTranscribe: async (fileId: number) => {
    return await window.agentDesktop.ipcInvoke('fileManager:stopTranscribe', { fileId }) as { success: boolean };
  },
  onTranscribeProgress: (callback: (progress: TranscribeProgress) => void) => {
    const handler = (data: TranscribeProgress) => callback(data);
    window.agentDesktop.ipcOn('fileManager:transcribeProgress', handler);
    return () => window.agentDesktop.ipcOff('fileManager:transcribeProgress', handler);
  },
  onModelDownloadProgress: (callback: (progress: ModelDownloadProgress) => void) => {
    const handler = (data: ModelDownloadProgress) => callback(data);
    window.agentDesktop.ipcOn('fileManager:modelDownloadProgress', handler);
    return () => window.agentDesktop.ipcOff('fileManager:modelDownloadProgress', handler);
  },
};

// 导出为 window.fileManager
if (typeof window !== 'undefined') {
  (window as unknown as { fileManager: FileManagerAPI }).fileManager = fileManagerAPI;
}

export default fileManagerAPI;
