/**
 * 文件管理模块 - 入口文件
 * 导出所有主进程服务
 */

import { initFileManagerDatabase, registerFileManagerIpcHandlers } from './bridge.mjs';
import { scanFile, scanDirectory, detectDuplicates, getFileType, getMimeType } from './scanner.mjs';
import { organizeFiles, previewOrganize, organizeByDate } from './organizer.mjs';
import { analyzeFile, analyzeFilesBatch, recommendCategory } from './ai-analyzer.mjs';
import { generateThumbnail, extractExif, getImageDimensions } from './thumbnail.mjs';

export {
  initFileManagerDatabase,
  registerFileManagerIpcHandlers,
  // 扫描服务
  scanFile,
  scanDirectory,
  detectDuplicates,
  getFileType,
  getMimeType,
  // 整理服务
  organizeFiles,
  previewOrganize,
  organizeByDate,
  // AI分析服务
  analyzeFile,
  analyzeFilesBatch,
  recommendCategory,
  // 缩略图服务
  generateThumbnail,
  extractExif,
  getImageDimensions,
};

export default {
  initFileManagerDatabase,
  registerFileManagerIpcHandlers,
};