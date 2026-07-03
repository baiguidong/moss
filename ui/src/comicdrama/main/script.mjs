/**
 * 剧情 / 分镜生成
 * 复用聊天供应商(@anthropic-ai/sdk + getLLMConfig), 一次产出结构化 JSON:
 *   { title, synopsis, characters[], shots[] }
 */

import Anthropic from '@anthropic-ai/sdk';
import { getLLMConfig } from './settings.mjs';

function buildPrompt({ logline, style, aspect, shotCount }) {
  const orientation = aspect === '16:9' ? '横屏(适合番剧观感)' : '竖屏(适合短视频分发)';
  const styleLine = style && style.trim()
    ? `整体画风: "${style.trim()}"。image_prompt 里不要重复画风词(画风会统一追加), 但请让画面内容与该画风气质协调。`
    : 'image_prompt 里不要包含画风词(画风会统一追加)。';
  return `你是一个漫剧(动态漫画剧)编剧兼分镜师。请根据下面的题材构思一集漫剧, 通过 emit_script 工具输出结构化数据。

题材/梗概:
"""
${logline}
"""

${styleLine}

要求:
1. 起一个吸引人的标题。
2. 写 60 字以内的剧情简介(synopsis)。
3. 设计 1-4 个主要角色, 每个给出: 名字(name)、外观描述(appearance, 用于稳定画面, 尽量具体: 发色/发型/瞳色/服装/年龄气质, 英文关键词更利于绘图)。
4. 拆成 ${shotCount} 个分镜(shots), 按顺序。每个分镜:
   - scene: 一句中文场景描述(给人看)
   - image_prompt: 用于 AI 绘图的英文提示词(画面内容/构图/光影/氛围)
   - subtitle: 该镜的台词或旁白(中文, 不超过 25 字, 没有可留空字符串)
   - character: 该镜主要出场角色的 name(必须是上面 characters 里的名字之一; 无人物场景填空字符串)
   - duration_ms: 建议展示时长(毫秒, 2000-6000, 台词长的给长一点)
   - camera: 运镜方向, 从 in/out/left/right 里选一个

排版为 ${orientation}。`;
}

/** emit_script 工具 schema(强约束结构化输出) */
const EMIT_SCRIPT_TOOL = {
  name: 'emit_script',
  description: '输出一集漫剧的标题、简介、角色与分镜',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      synopsis: { type: 'string' },
      characters: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, appearance: { type: 'string' } },
          required: ['name'],
        },
      },
      shots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            scene: { type: 'string' },
            image_prompt: { type: 'string' },
            subtitle: { type: 'string' },
            character: { type: 'string' },
            duration_ms: { type: 'number' },
            camera: { type: 'string', enum: ['in', 'out', 'left', 'right'] },
          },
          required: ['image_prompt'],
        },
      },
    },
    required: ['title', 'shots'],
  },
};

function parseResult(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
    /* ignore */
  }
  return null;
}

const CAMERAS = ['in', 'out', 'left', 'right'];

/**
 * 生成剧本 + 分镜
 * @returns {{ title, synopsis, characters:[{name,appearance}], shots:[{scene,image_prompt,subtitle,character,duration_ms,camera}] }}
 */
export async function generateScript({ logline, style, aspect, shotCount }) {
  const cfg = getLLMConfig();
  if (!cfg.apiKey) {
    throw new Error('未配置 LLM(设置 → 文本模型 的 API Key 为空)');
  }

  const count = Math.min(Math.max(Number(shotCount) || 10, 4), 20);
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || undefined });

  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: 4096,
    tools: [EMIT_SCRIPT_TOOL],
    tool_choice: { type: 'tool', name: 'emit_script' },
    messages: [{ role: 'user', content: buildPrompt({ logline, style, aspect, shotCount: count }) }],
  });

  // 优先取 tool_use 的结构化 input; 回退到文本 JSON 解析
  let parsed = null;
  const toolBlock = Array.isArray(response?.content)
    ? response.content.find((b) => b?.type === 'tool_use' && b?.name === 'emit_script')
    : null;
  if (toolBlock && toolBlock.input && typeof toolBlock.input === 'object') {
    parsed = toolBlock.input;
  } else {
    const textBlock = Array.isArray(response?.content)
      ? response.content.find((b) => b?.type === 'text')
      : null;
    parsed = parseResult(textBlock?.text || '');
  }
  if (!parsed) throw new Error('AI 返回结果无法解析为结构化剧本');

  const characters = Array.isArray(parsed.characters)
    ? parsed.characters
        .filter((c) => c && typeof c.name === 'string' && c.name.trim())
        .map((c) => ({ name: c.name.trim(), appearance: typeof c.appearance === 'string' ? c.appearance : '' }))
    : [];

  const shots = Array.isArray(parsed.shots)
    ? parsed.shots.map((s, i) => ({
        scene: typeof s.scene === 'string' ? s.scene : '',
        image_prompt: typeof s.image_prompt === 'string' ? s.image_prompt : '',
        subtitle: typeof s.subtitle === 'string' ? s.subtitle : '',
        character: typeof s.character === 'string' ? s.character.trim() : '',
        duration_ms: Number.isFinite(s.duration_ms) ? Math.min(Math.max(s.duration_ms, 1500), 8000) : 3000,
        camera: CAMERAS.includes(s.camera) ? s.camera : 'in',
        idx: i,
      }))
    : [];

  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : '未命名漫剧',
    synopsis: typeof parsed.synopsis === 'string' ? parsed.synopsis : '',
    characters,
    shots,
  };
}

export default { generateScript };
