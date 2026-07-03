/**
 * 语音转写(STT)
 * 走 settings.json 里独立配置的语音模型供应商的 ASR 接口
 * 采用 OpenAI 兼容的 /audio/transcriptions(multipart)协议,baseURL/model 可配
 */

import { getVoiceConfig } from './settings.mjs';

function extFromMime(mimeType = '') {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * 转写一段音频
 * @param {string} audioBase64 - 不含 data: 前缀的纯 base64
 * @param {string} mimeType
 * @returns {Promise<{ text: string }>}
 */
export async function transcribe(audioBase64, mimeType) {
  const cfg = getVoiceConfig();
  if (!cfg) {
    throw new Error('未配置语音模型(settings.json 的 voice 块缺失或 apiKey 为空)');
  }
  if (!cfg.baseURL) {
    throw new Error('语音模型 baseURL 未配置');
  }

  const endpoint = `${cfg.baseURL.replace(/\/$/, '')}/audio/transcriptions`;
  const buffer = Buffer.from(audioBase64, 'base64');
  const blob = new Blob([buffer], { type: mimeType || 'audio/webm' });

  const form = new FormData();
  form.append('file', blob, `audio.${extFromMime(mimeType)}`);
  if (cfg.model) form.append('model', cfg.model);
  form.append('response_format', 'json');

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`ASR 请求失败 ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json().catch(() => null);
  const text = data?.text || data?.result || '';
  if (!text) {
    throw new Error('ASR 返回为空');
  }
  return { text };
}

export default { transcribe };
