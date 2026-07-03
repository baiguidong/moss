/**
 * 漫剧模块配置
 * - LLM 配置复用全局 settings.json 的 env.ANTHROPIC_*(与聊天同供应商)
 * - ComfyUI 配置为模块本地文件 ~/.moss/comicdrama/config.json(自包含, 不侵入全局设置)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getMossHome() {
  return process.env.MOSS_HOME || path.join(os.homedir(), '.moss');
}

/** 模块根目录 ~/.moss/comicdrama */
export function getComicHome() {
  const dir = path.join(getMossHome(), 'comicdrama');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 某个项目的目录 ~/.moss/comicdrama/<projectId> */
export function getProjectDir(projectId) {
  const dir = path.join(getComicHome(), String(projectId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 某个项目的分镜画面目录 */
export function getShotsDir(projectId) {
  const dir = path.join(getProjectDir(projectId), 'shots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 项目参考图/pose图等素材目录 ~/.moss/comicdrama/<projectId>/assets */
export function getAssetsDir(projectId) {
  const dir = path.join(getProjectDir(projectId), 'assets');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 由画幅比例推导生成尺寸(唯一真源, 供 art-worker / 单镜 / 合成共用)。
 * 短边 = base, 长边按比例放大并对齐到 8 的倍数; 长边上限 1024 以适配 SD1.5 与 8GB 显存。
 * 支持任意 "W:H"(如 9:16 / 16:9 / 4:3 / 1:1), 非法输入回退竖屏 9:16。
 */
export function dimsFor(aspect, base = 512) {
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(String(aspect || '').trim());
  let w = 9, h = 16;
  if (m && Number(m[1]) > 0 && Number(m[2]) > 0) { w = Number(m[1]); h = Number(m[2]); }
  const round8 = (n) => Math.max(64, Math.round(n / 8) * 8);
  const ratio = Math.max(w, h) / Math.min(w, h);
  const shortEdge = round8(base);
  const longEdge = Math.min(round8(base * ratio), 1024);
  return w >= h ? { width: longEdge, height: shortEdge } : { width: shortEdge, height: longEdge };
}

function readGlobalSettings() {
  const settingsPath = path.join(getMossHome(), 'settings.json');
  try {
    if (!fs.existsSync(settingsPath)) return {};
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch (err) {
    console.error('[ComicDrama] Failed to read settings.json:', err.message);
    return {};
  }
}

/** 聊天 LLM 配置(与对话同供应商, Anthropic 兼容协议) */
export function getLLMConfig() {
  const s = readGlobalSettings();
  const env = s && typeof s.env === 'object' ? s.env : {};
  return {
    baseURL: (env.ANTHROPIC_BASE_URL || '').trim(),
    apiKey: (env.ANTHROPIC_AUTH_TOKEN || '').trim(),
    model: (typeof s.model === 'string' && s.model.trim()) || 'claude-sonnet-4-6',
  };
}

const DEFAULT_COMFY_CONFIG = {
  url: 'http://127.0.0.1:8188',
  workflow: '',            // 空则用 comfy.mjs 内置默认 workflow 模板
  negativePrompt:
    'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, '
    + 'fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, '
    + 'watermark, username, blurry',
  steps: 20,
  cfg: 7,
  sampler: 'dpmpp_2m',     // 低步数下画质优于 euler
  scheduler: 'karras',
  checkpoint: '',          // 空则用 workflow 模板里写死的 ckpt, 或自动取第一个
  vae: '',                 // 空则用 checkpoint 内置 VAE
  baseSize: 512,           // 生成短边基准(SD1.5 建议 512), dimsFor 据此推导宽高
};

function comfyConfigPath() {
  return path.join(getComicHome(), 'config.json');
}

/** 读取 ComfyUI 配置(带默认值) */
export function getComfyConfig() {
  const p = comfyConfigPath();
  let saved = {};
  try {
    if (fs.existsSync(p)) saved = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    console.error('[ComicDrama] Failed to read comfy config:', err.message);
  }
  return { ...DEFAULT_COMFY_CONFIG, ...saved };
}

/** 写入 ComfyUI 配置(合并) */
export function saveComfyConfig(patch) {
  const merged = { ...getComfyConfig(), ...(patch || {}) };
  try {
    fs.writeFileSync(comfyConfigPath(), JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error('[ComicDrama] Failed to write comfy config:', err.message);
  }
  return merged;
}
