/**
 * AI 分类 + 结构化提取
 * 直接用 @anthropic-ai/sdk 调聊天供应商,一次产出 JSON
 */

import Anthropic from '@anthropic-ai/sdk';
import { getLLMConfig } from './settings.mjs';

function buildPrompt(text, categories) {
  const catLines = categories
    .map((c) => `- ${c.name}${c.ai_prompt ? `:${c.ai_prompt}` : ''}`)
    .join('\n');
  const today = new Date().toISOString().slice(0, 10);

  return `你是一个备忘录整理助手。今天是 ${today}。请分析下面这条备忘内容,完成:
1. 写一句不超过 30 字的摘要。
2. 从给定分类中选择最贴切的一个(只能选一个,必须是列表里的名字)。
3. 提取 1-5 个关键词作为标签。
4. 如果内容里包含需要去做的事项,提取成待办列表;没有就返回空数组。每个待办给出标题、可选细节、可选截止时间(ISO 8601,推断不出就 null)、优先级(low/med/high)。

可选分类:
${catLines}

备忘内容:
"""
${text}
"""

只返回 JSON,不要任何解释,格式:
{
  "summary": "string",
  "category": "分类名",
  "tags": ["string"],
  "tasks": [
    { "title": "string", "detail": "string 或 null", "due_at": "ISO 时间 或 null", "priority": "low|med|high" }
  ]
}`;
}

/**
 * 从模型输出里抠出 JSON 对象(容错)
 */
function parseResult(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 分析一条备忘
 * @returns { summary, category, tags[], tasks[] } 或抛错
 */
export async function analyzeNote(text, categories) {
  const cfg = getLLMConfig();
  if (!cfg.apiKey) {
    throw new Error('未配置 LLM(settings.json 的 env.ANTHROPIC_AUTH_TOKEN 为空)');
  }

  const client = new Anthropic({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL || undefined,
  });

  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildPrompt(text, categories) }],
  });

  const out = (response?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || '';
  const parsed = parseResult(out);
  if (!parsed) {
    throw new Error('AI 返回结果无法解析为 JSON');
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    category: typeof parsed.category === 'string' ? parsed.category : '',
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === 'string') : [],
    tasks: Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter((t) => t && typeof t.title === 'string')
          .map((t) => ({
            title: t.title,
            detail: typeof t.detail === 'string' ? t.detail : '',
            due_at: typeof t.due_at === 'string' ? t.due_at : null,
            priority: ['low', 'med', 'high'].includes(t.priority) ? t.priority : 'med',
          }))
      : [],
  };
}

export default { analyzeNote };
