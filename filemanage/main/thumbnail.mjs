/**
 * 缩略图生成服务
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// 缩略图配置
const THUMBNAIL_SIZE = 256;
const THUMBNAIL_QUALITY = 80;
const THUMBNAIL_DIR = path.join(os.homedir(), '.moss', 'thumbnails');

// 确保缩略图目录存在
function ensureThumbnailDir() {
  if (!fs.existsSync(THUMBNAIL_DIR)) {
    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  }
  return THUMBNAIL_DIR;
}

// 支持的图片格式
const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

/**
 * 检查文件是否为图片
 */
export function isImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_IMAGE_FORMATS.includes(ext);
}

/**
 * 生成缩略图路径
 */
export function getThumbnailPath(originalPath) {
  const hash = require('crypto')
    .createHash('md5')
    .update(originalPath)
    .digest('hex');
  return path.join(THUMBNAIL_DIR, `${hash}.jpg`);
}

/**
 * 使用 Sharp 生成缩略图
 */
export async function generateThumbnail(filePath) {
  if (!isImageFile(filePath)) {
    return null;
  }

  try {
    ensureThumbnailDir();

    const thumbnailPath = getThumbnailPath(filePath);

    // 如果缩略图已存在，直接返回
    if (fs.existsSync(thumbnailPath)) {
      return thumbnailPath;
    }

    // 动态导入 sharp（可能不存在）
    let sharp;
    try {
      sharp = (await import('sharp')).default;
    } catch {
      console.warn('[Thumbnail] Sharp not available, skipping thumbnail generation');
      return null;
    }

    // 生成缩略图
    await sharp(filePath)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toFile(thumbnailPath);

    return thumbnailPath;
  } catch (err) {
    console.error('[Thumbnail] Failed to generate thumbnail:', err.message);
    return null;
  }
}

/**
 * 批量生成缩略图
 */
export async function generateThumbnailsBatch(filePaths, onProgress) {
  const results = new Map();
  let processed = 0;

  for (const filePath of filePaths) {
    const thumbnailPath = await generateThumbnail(filePath);
    results.set(filePath, thumbnailPath);
    processed++;

    if (onProgress) {
      onProgress(processed, filePaths.length);
    }
  }

  return results;
}

/**
 * 获取图片尺寸
 */
export async function getImageDimensions(filePath) {
  try {
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(filePath).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
    };
  } catch (err) {
    return null;
  }
}

/**
 * 提取 EXIF 信息
 */
export async function extractExif(filePath) {
  try {
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(filePath).metadata();

    const exif = metadata.exif;
    if (!exif) return null;

    // 解析 EXIF 中的日期
    // EXIF 日期格式: "2023:12:25 10:30:00"
    const exifDate = metadata.exif?.DateTimeOriginal ||
                     metadata.exif?.CreateDate ||
                     metadata.DateTimeOriginal;

    if (exifDate) {
      // 转换 EXIF 日期格式
      const dateStr = exifDate.replace(/:/g, '-').replace(/\//, ' ');
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return {
          date: date.toISOString(),
          width: metadata.width,
          height: metadata.height,
          orientation: metadata.orientation,
        };
      }
    }

    return {
      width: metadata.width,
      height: metadata.height,
      orientation: metadata.orientation,
    };
  } catch (err) {
    return null;
  }
}

export default {
  generateThumbnail,
  generateThumbnailsBatch,
  getImageDimensions,
  extractExif,
  isImageFile,
  getThumbnailPath,
};