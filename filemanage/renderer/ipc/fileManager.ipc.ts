/**
 * 文件管理模块 - IPC 客户端
 * 前端调用后端 API 的封装
 */

import type { FileManagerAPI, ScanConfig, FileFilter, ScanProgress } from './types';

// 创建 IPC 调用函数
function createIpcCall<T>(channel: string): (...args: unknown[]) => Promise<T> {
  return async (...args: unknown[]) => {
    const result = await window.electronAPI.ipcInvoke(channel, ...args);
    return result as T;
  };
}

// 创建事件监听函数
function createIpcListener<T>(channel: string): (callback: (data: T) => void) => () => void {
  return (callback: (data: T) => void) => {
    const handler = (_event: unknown, data: T) => callback(data);
    window.electronAPI.ipcOn(channel, handler);
    return () => window.electronAPI.ipcOff(channel, handler);
  };
}

// 文件管理 API 实现
export const fileManagerAPI: FileManagerAPI = {
  // 扫描
  startScan: createIpcCall<ScanTask>('fileManager:startScan'),
  executeScan: createIpcCall<{ success: boolean; totalFiles: number; processedFiles: number; errorFiles: number }>('fileManager:executeScan'),
  stopScan: createIpcCall<{ success: boolean }>('fileManager:stopScan'),
  getScanProgress: createIpcCall<ScanTask>('fileManager:getScanProgress'),
  getScanTasks: createIpcCall<ScanTask[]>('fileManager:getScanTasks'),

  // 文件操作
  getFiles: createIpcCall<FileManagerFile[]>('fileManager:getFiles'),
  getFileDetail: createIpcCall<FileManagerFile>('fileManager:getFileDetail'),

  // 分类
  getCategories: createIpcCall<Category[]>('fileManager:getCategories'),

  // 加密
  getEncryptedFiles: createIpcCall<EncryptedFile[]>('fileManager:getEncryptedFiles'),
  encryptFile: createIpcCall<{ success: boolean; encryptedPath?: string; error?: string }>('fileManager:encryptFile'),
  decryptFile: createIpcCall<{ success: boolean; tempPath?: string; error?: string }>('fileManager:decryptFile'),

  // 统计
  getStats: createIpcCall<FileManagerStats>('fileManager:getStats'),

  // 事件
  onScanProgress: createIpcListener<ScanProgress>('fileManager:scanProgress'),
};

// 导出为 window.fileManager
if (typeof window !== 'undefined') {
  (window as unknown as { fileManager: FileManagerAPI }).fileManager = fileManagerAPI;
}

export default fileManagerAPI;