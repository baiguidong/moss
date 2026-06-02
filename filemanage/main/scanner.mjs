/**
 * 文件扫描服务
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isImageFile, generateThumbnail, extractExif, getImageDimensions } from './thumbnail.mjs';

// 文件类型映射
const FILE_TYPE_MAP = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.raw', '.cr2', '.nef'],
  video: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg'],
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.ape', '.alac'],
  document: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.rtf', '.odt', '.ods', '.odp']
};

// MIME 类型映射
const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown'
};

/**
 * 获取文件类型
 */
export function getFileType(extension) {
  const ext = extension.toLowerCase();
  for (const [type, extensions] of Object.entries(FILE_TYPE_MAP)) {
    if (extensions.includes(ext)) {
      return type;
    }
  }
  return 'other';
}

/**
 * 获取 MIME 类型
 */
export function getMimeType(extension) {
  return MIME_MAP[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * 计算文件 MD5 校验值（分块计算，支持大文件）
 */
export async function calculateChecksum(filePath) {
  const hash = crypto.createHash('md5');
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 获取视频时长（使用 ffprobe 或简单估算）
 */
export async function getVideoDuration(filePath) {
  // TODO: 使用 ffprobe 获取准确时长
  // 目前返回 null，后续集成 FFmpeg
  return null;
}

/**
 * 扫描单个文件，提取完整元数据
 */
export async function scanFile(filePath, stats) {
  const ext = path.extname(filePath);
  const filename = path.basename(filePath);
  const fileType = getFileType(ext);
  const mimeType = getMimeType(ext);

  const fileInfo = {
    path: filePath,
    filename,
    extension: ext,
    file_type: fileType,
    mime_type: mimeType,
    size: stats.size,
    created_at: stats.birthtime.toISOString(),
    modified_at: stats.mtime.toISOString(),
    scan_date: new Date().toISOString(),
  };

  // 图片文件：提取尺寸和 EXIF
  if (fileType === 'image') {
    try {
      const dimensions = await getImageDimensions(filePath);
      if (dimensions) {
        fileInfo.width = dimensions.width;
        fileInfo.height = dimensions.height;
      }

      const exif = await extractExif(filePath);
      if (exif) {
        fileInfo.exif_date = exif.date;
        if (!fileInfo.width) fileInfo.width = exif.width;
        if (!fileInfo.height) fileInfo.height = exif.height;
      }

      // 生成缩略图
      const thumbnailPath = await generateThumbnail(filePath);
      if (thumbnailPath) {
        fileInfo.thumbnail_path = thumbnailPath;
      }
    } catch (err) {
      console.error('[Scanner] Failed to extract image metadata:', err.message);
    }
  }

  // 计算校验值（可选，用于重复检测）
  if (fileType === 'image' || fileType === 'video') {
    try {
      fileInfo.checksum = await calculateChecksum(filePath);
    } catch (err) {
      console.error('[Scanner] Failed to calculate checksum:', err.message);
    }
  }

  return fileInfo;
}

/**
 * 递归扫描目录
 */
export async function scanDirectory(dirPath, config, onProgress) {
  const files = [];
  const errors = [];

  const scanRecursive = async (currentPath) => {
    try {
      const entries = await fsp.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        // 跳过隐藏文件和目录
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          if (config.recursive !== false) {
            await scanRecursive(fullPath);
          }
        } else if (entry.isFile()) {
          // 文件类型筛选
          const ext = path.extname(entry.name);
          const fileType = getFileType(ext);

          if (config.fileTypes && config.fileTypes.length > 0) {
            if (!config.fileTypes.includes(fileType)) continue;
          }

          // 大小限制
          const stats = await fsp.stat(fullPath);
          if (config.maxSize && stats.size > config.maxSize) continue;

          try {
            const fileInfo = await scanFile(fullPath, stats);
            files.push(fileInfo);

            if (onProgress) {
              onProgress(files.length, fullPath);
            }
          } catch (err) {
            errors.push({ path: fullPath, error: err.message });
          }
        }
      }
    } catch (err) {
      errors.push({ path: currentPath, error: err.message });
    }
  };

  await scanRecursive(dirPath);

  return { files, errors };
}

/**
 * 检测重复文件
 */
export async function detectDuplicates(files) {
  const checksumMap = new Map();

  for (const file of files) {
    if (!file.checksum) continue;

    if (checksumMap.has(file.checksum)) {
      file.is_duplicate = true;
      file.duplicate_of = checksumMap.get(file.checksum);
    } else {
      checksumMap.set(file.checksum, file.id || file.path);
    }
  }

  return files;
}

export default {
  getFileType,
  getMimeType,
  calculateChecksum,
  scanFile,
  scanDirectory,
  detectDuplicates,
};