/**
 * 文件整理服务
 * 非破坏性文件整理，保留原始文件引用
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * 将用户提供的分段安全拼接到 root 下, 防止 `../` 目录穿越
 */
function confineToRoot(root, ...segments) {
  const base = path.resolve(root);
  const joined = path.resolve(base, ...segments.map((s) => String(s)));
  const rel = path.relative(base, joined);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes target directory: ${segments.join('/')}`);
  }
  return joined;
}

/**
 * 创建整理目录结构
 */
export function createOrganizeStructure(targetPath, categories) {
  const dirs = new Set();

  // 收集所有需要创建的目录
  for (const category of categories) {
    if (category.path_pattern) {
      try {
        dirs.add(confineToRoot(targetPath, category.path_pattern));
      } catch {
        // 跳过会穿越目标目录的非法 path_pattern
      }
    }
  }

  // 创建目录
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * 根据分类获取目标路径
 */
export function getOrganizedPath(file, targetPath, categories) {
  const fileType = file.file_type;

  // 查找匹配的分类
  let category = categories.find(c => c.name === fileType);
  if (!category) {
    category = categories.find(c => c.name === '其他');
  }

  const categoryPath = category?.path_pattern || fileType;
  const filename = path.basename(file.filename);

  return confineToRoot(targetPath, categoryPath, filename);
}

/**
 * 整理单个文件（复制，不移动）
 */
export async function organizeFile(file, targetPath, categories, options = {}) {
  const sourcePath = file.path;

  // 检查源文件是否存在
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  // 获取目标路径
  const destPath = getOrganizedPath(file, targetPath, categories);

  // 检查目标目录是否存在
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // 如果目标文件已存在，添加序号
  let finalDestPath = destPath;
  let counter = 1;
  while (fs.existsSync(finalDestPath)) {
    const ext = path.extname(destPath);
    const baseName = path.basename(destPath, ext);
    finalDestPath = path.join(destDir, `${baseName}_${counter}${ext}`);
    counter++;
  }

  // 复制文件
  if (!options.dryRun) {
    await fsp.copyFile(sourcePath, finalDestPath);
  }

  return {
    originalPath: sourcePath,
    organizedPath: finalDestPath,
    category: categories.find(c => file.file_type === c.name)?.name || '其他',
  };
}

/**
 * 批量整理文件
 */
export async function organizeFiles(files, targetPath, categories, options = {}, onProgress) {
  const results = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    try {
      const result = await organizeFile(file, targetPath, categories, options);
      results.push(result);
    } catch (err) {
      errors.push({
        file: file.path,
        error: err.message
      });
    }

    if (onProgress) {
      onProgress(i + 1, files.length);
    }
  }

  return { results, errors };
}

/**
 * 预览整理结果（不实际执行）
 */
export function previewOrganize(files, targetPath, categories) {
  return files.map(file => ({
    file,
    organizedPath: getOrganizedPath(file, targetPath, categories),
    category: categories.find(c => file.file_type === c.name)?.name || '其他',
  }));
}

/**
 * 按时间整理文件
 */
export function organizeByDate(files, targetPath, options = {}) {
  const results = [];

  for (const file of files) {
    const date = file.exif_date || file.modified_at || file.created_at;
    const dateObj = new Date(date);

    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');

    const destPath = confineToRoot(targetPath, String(year), month, path.basename(file.filename));

    results.push({
      file,
      organizedPath: destPath,
      year,
      month,
    });
  }

  return results;
}

/**
 * 按自定义规则整理
 */
export function organizeByRule(file, targetPath, rule) {
  // rule: { type: 'date' | 'category' | 'custom', pattern: string }
  switch (rule.type) {
    case 'date':
      return organizeByDate([file], targetPath)[0];

    case 'category':
      return getOrganizedPath(file, targetPath, rule.categories || []);

    case 'custom':
      // 自定义路径模式，支持变量替换
      let pattern = rule.pattern;
      const date = new Date(file.exif_date || file.modified_at || file.created_at);

      pattern = pattern.replace('{year}', String(date.getFullYear()));
      pattern = pattern.replace('{month}', String(date.getMonth() + 1).padStart(2, '0'));
      pattern = pattern.replace('{day}', String(date.getDate()).padStart(2, '0'));
      pattern = pattern.replace('{type}', file.file_type);
      pattern = pattern.replace('{filename}', path.basename(file.filename));

      return confineToRoot(targetPath, pattern);

    default:
      return getOrganizedPath(file, targetPath, []);
  }
}

export default {
  createOrganizeStructure,
  getOrganizedPath,
  organizeFile,
  organizeFiles,
  previewOrganize,
  organizeByDate,
  organizeByRule,
};