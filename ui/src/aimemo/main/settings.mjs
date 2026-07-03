/**
 * 读取 ~/.moss/settings.json,提取 LLM / 语音模型配置
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getMossHome() {
  return process.env.MOSS_HOME || path.join(os.homedir(), '.moss');
}

export function readSettings() {
  const settingsPath = path.join(getMossHome(), 'settings.json');
  try {
    if (!fs.existsSync(settingsPath)) return {};
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch (err) {
    console.error('[AiMemo] Failed to read settings.json:', err.message);
    return {};
  }
}

/**
 * 聊天 LLM 配置(与对话同一供应商,Anthropic 兼容协议)
 */
export function getLLMConfig() {
  const s = readSettings();
  const env = s && typeof s.env === 'object' ? s.env : {};
  return {
    baseURL: (env.ANTHROPIC_BASE_URL || '').trim(),
    apiKey: (env.ANTHROPIC_AUTH_TOKEN || '').trim(),
    model: (typeof s.model === 'string' && s.model.trim()) || 'claude-sonnet-4-6',
  };
}

/**
 * 独立的语音模型配置,没配置则返回 null
 */
export function getVoiceConfig() {
  const s = readSettings();
  const v = s && typeof s.voice === 'object' ? s.voice : null;
  if (!v || !v.apiKey || !String(v.apiKey).trim()) return null;
  return {
    provider: (v.provider || 'minimax').trim(),
    baseURL: (v.baseURL || '').trim(),
    apiKey: String(v.apiKey).trim(),
    model: (v.model || '').trim(),
  };
}
