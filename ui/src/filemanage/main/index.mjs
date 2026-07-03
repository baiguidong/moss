/**
 * 文件管理模块 - 入口文件
 * 导出所有主进程服务
 */

import { initFileManagerDatabase, registerFileManagerIpcHandlers } from './bridge.mjs';
import { registerTranscribeIpcHandlers } from './transcribe-bridge.mjs';
import { scanFile, scanDirectory, detectDuplicates, getFileType, getMimeType } from './scanner.mjs';
import { organizeFiles, previewOrganize, organizeByDate } from './organizer.mjs';
import { analyzeFile, analyzeFilesBatch, recommendCategory } from './ai-analyzer.mjs';
import { generateThumbnail, extractExif, getImageDimensions } from './thumbnail.mjs';
import {
  MEDIA_SCHEME,
  registerMediaScheme,
  installMediaProtocol,
  allowMediaRoot,
  toMediaUrl,
} from './media-protocol.mjs';

export {
  initFileManagerDatabase,
  registerFileManagerIpcHandlers,
  // 语音转写
  registerTranscribeIpcHandlers,
  // 流媒体协议
  MEDIA_SCHEME,
  registerMediaScheme,
  installMediaProtocol,
  allowMediaRoot,
  toMediaUrl,
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
  registerTranscribeIpcHandlers,
};