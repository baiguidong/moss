/**
 * 文件管理模块 - IPC 客户端
 * 前端调用后端 API 的封装
 */

import type { FileManagerAPI, ScanConfig, FileFilter, ScanProgress, ScanTask, FileManagerFile, Category, EncryptedFile, FileManagerStats } from './types';

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
function createIpcListener<T>(channel: string): (callback: (data: T) => void) => () => void {
  return (callback: (data: T) => void) => {
    const handler = (_event: unknown, data: T) => callback(data);
    window.agentDesktop.ipcOn(channel, handler);
    return () => window.agentDesktop.ipcOff(channel, handler);
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
  readFile: async (filePath: string, asDataUrl: boolean = true) => {
    return await window.agentDesktop.ipcInvoke('fileManager:readFile', { filePath, asDataUrl });
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

  // 事件
  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const handler = (data: ScanProgress) => {
      console.log('[FileManager] Received scanProgress:', data);
      callback(data);
    };
    window.agentDesktop.ipcOn('fileManager:scanProgress', handler);
    return () => window.agentDesktop.ipcOff('fileManager:scanProgress', handler);
  },
};

// 导出为 window.fileManager
if (typeof window !== 'undefined') {
  (window as unknown as { fileManager: FileManagerAPI }).fileManager = fileManagerAPI;
}

export default fileManagerAPI;
