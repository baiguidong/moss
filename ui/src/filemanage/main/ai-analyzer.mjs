/**
 * AI 分析服务
 * 复用现有 Agent 机制进行文件内容分析
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// AI 分析配置
const AI_CONFIG = {
  maxBatchSize: 10,        // 每批处理的最大文件数
  timeout: 30000,          // 单个文件分析超时时间
  retryCount: 2,           // 失败重试次数
};

// 图片分析提示词
const IMAGE_ANALYSIS_PROMPT = `分析这张图片，请提供以下信息：
1. 场景类型（如：风景、人物、美食、宠物、建筑、室内等）
2. 主要主体描述
3. 如果有人，描述人物特征
4. 如果有文字，提取主要文字内容
5. 图片风格（如：自然、艺术、证件照等）
6. 情感氛围

请以 JSON 格式返回结果：
{
  "scene": "场景类型",
  "subject": "主体描述",
  "people": ["人物描述"],
  "text": "提取的文字",
  "style": "风格",
  "mood": "氛围",
  "confidence": 0.8
}`;

// 文档分析提示词
const DOCUMENT_ANALYSIS_PROMPT = `分析这个文档内容，请提供以下信息：
1. 文档类型（如：报告、合同、论文、简历、表格等）
2. 主要主题
3. 关键关键词（最多5个）
4. 语言
5. 总结（不超过100字）

请以 JSON 格式返回结果：
{
  "docType": "文档类型",
  "topic": "主题",
  "keywords": ["关键词"],
  "language": "语言",
  "summary": "总结",
  "confidence": 0.8
}`;

/**
 * 将图片转换为 base64
 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB

async function imageToBase64(filePath) {
  const stat = await fsp.stat(filePath);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large to analyze (${Math.round(stat.size / 1024 / 1024)}MB, max 20MB)`);
  }
  const content = await fsp.readFile(filePath);
  return content.toString('base64');
}

/**
 * 获取文件的 MIME 类型
 */
function getFileMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 使用 Agent API 分析图片
 */
async function analyzeImageWithAgent(filePath, agentClient) {
  try {
    const base64 = await imageToBase64(filePath);
    const mimeType = getFileMimeType(filePath);

    // 构造消息
    const message = {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: base64,
          },
        },
        {
          type: 'text',
          text: IMAGE_ANALYSIS_PROMPT,
        },
      ],
    };

    // 发送请求
    const response = await agentClient.sendMessage({
      messages: [message],
      max_tokens: 1024,
    });

    // 解析响应
    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || '';
    return parseAnalysisResult(text);
  } catch (err) {
    console.error('[AI] Image analysis failed:', err.message);
    return null;
  }
}

/**
 * 使用 Agent API 分析文档
 */
async function analyzeDocumentWithAgent(filePath, agentClient) {
  try {
    // 只读取文件开头, 避免把超大文件全部载入内存
    const READ_PREFIX_BYTES = 64 * 1024; // 64KB
    let truncatedContent;
    const fh = await fsp.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(READ_PREFIX_BYTES);
      const { bytesRead } = await fh.read(buf, 0, READ_PREFIX_BYTES, 0);
      truncatedContent = buf.subarray(0, bytesRead).toString('utf-8').substring(0, 5000);
    } finally {
      await fh.close();
    }

    const message = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${DOCUMENT_ANALYSIS_PROMPT}\n\n文档内容：\n${truncatedContent}`,
        },
      ],
    };

    const response = await agentClient.sendMessage({
      messages: [message],
      max_tokens: 1024,
    });

    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || '';
    return parseAnalysisResult(text);
  } catch (err) {
    console.error('[AI] Document analysis failed:', err.message);
    return null;
  }
}

/**
 * 解析 AI 返回的结果
 */
function parseAnalysisResult(text) {
  try {
    // 尝试直接解析 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    // 解析失败，返回文本描述
  }

  return {
    description: text,
    confidence: 0.5,
  };
}

/**
 * 分析单个文件
 */
export async function analyzeFile(file, agentClient) {
  if (file.file_type === 'image') {
    return await analyzeImageWithAgent(file.path, agentClient);
  } else if (file.file_type === 'document') {
    return await analyzeDocumentWithAgent(file.path, agentClient);
  }

  return null;
}

/**
 * 批量分析文件
 */
export async function analyzeFilesBatch(files, agentClient, onProgress) {
  const results = new Map();
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    try {
      const result = await analyzeFile(file, agentClient);
      if (result) {
        results.set(file.id || file.path, result);
      }
    } catch (err) {
      errors.push({
        file: file.path,
        error: err.message,
      });
    }

    if (onProgress) {
      onProgress(i + 1, files.length);
    }
  }

  return { results, errors };
}

/**
 * 根据分析结果推荐分类
 */
export function recommendCategory(analysisResult, categories) {
  if (!analysisResult) return null;

  // 根据场景推荐分类
  if (analysisResult.scene) {
    const sceneMap = {
      '风景': '风景',
      '人物': '人物',
      '美食': '美食',
      '宠物': '宠物',
      '建筑': '风景',
      '室内': '室内',
    };

    const matchedCategory = sceneMap[analysisResult.scene];
    if (matchedCategory) {
      return categories.find(c => c.name === matchedCategory);
    }
  }

  // 根据文档类型推荐
  if (analysisResult.docType) {
    const docTypeMap = {
      '报告': '文档',
      '合同': '文档',
      '论文': '文档',
      '简历': '文档',
      '表格': '文档',
    };

    const matchedCategory = docTypeMap[analysisResult.docType];
    if (matchedCategory) {
      return categories.find(c => c.name === matchedCategory);
    }
  }

  return null;
}

/**
 * 生成文件描述
 */
export function generateDescription(analysisResult) {
  if (!analysisResult) return '';

  if (analysisResult.description) {
    return analysisResult.description;
  }

  const parts = [];

  if (analysisResult.scene) {
    parts.push(`场景: ${analysisResult.scene}`);
  }

  if (analysisResult.subject) {
    parts.push(`主体: ${analysisResult.subject}`);
  }

  if (analysisResult.people?.length > 0) {
    parts.push(`人物: ${analysisResult.people.join(', ')}`);
  }

  if (analysisResult.topic) {
    parts.push(`主题: ${analysisResult.topic}`);
  }

  if (analysisResult.summary) {
    parts.push(`摘要: ${analysisResult.summary}`);
  }

  return parts.join('; ');
}

export default {
  analyzeFile,
  analyzeFilesBatch,
  recommendCategory,
  generateDescription,
};