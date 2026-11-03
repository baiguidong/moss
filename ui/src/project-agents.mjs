import path from 'node:path';
import * as fs from 'node:fs/promises';

import { normalizeGeneratedProjectInstructions } from './shared/project-instructions.mjs';

export const PROJECT_AGENTS_FILENAME = 'AGENTS.md';

const DEFAULT_PROJECT_AGENTS = `# AGENTS.md

本文件为 Moss 和其他兼容代理提供项目协作指引。

## 协作规则

- 先了解项目资料和用户目标，再给出清晰、可执行的建议。
- 区分长期项目约定与当前会话任务；一次性任务只在当前会话中处理。
- 使用项目中已有的资料、资源和工作方式，不臆造事实或约束。
`;

function normalizeAgentsText(value) {
  const normalized = normalizeGeneratedProjectInstructions(value);
  if (!normalized) return `${DEFAULT_PROJECT_AGENTS.trim()}\n`;
  const body = normalized.trim().replace(/^#\s+AGENTS\.md\s*\n+/i, '');
  return `# AGENTS.md\n\n${body}\n`;
}

export function projectAgentsPath(directory) {
  return path.join(directory, PROJECT_AGENTS_FILENAME);
}

/**
 * Create the project instruction file without overwriting a user's existing
 * AGENTS.md. Existing content becomes the project instruction snapshot.
 */
export async function ensureProjectAgentsFile(directory, instructions = '') {
  const filePath = projectAgentsPath(directory);
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    if (existing.trim()) return { path: filePath, content: normalizeAgentsText(existing), created: false };
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`无法读取项目指令文件：${filePath}（${error.message}）`);
  }
  const content = normalizeAgentsText(instructions);
  await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' }).catch(async error => {
    if (error.code !== 'EEXIST') throw new Error(`无法创建项目指令文件：${filePath}（${error.message}）`);
    return null;
  });
  return { path: filePath, content, created: true };
}

/** Save an explicit project settings edit back to the instruction file. */
export async function writeProjectAgentsFile(directory, instructions = '') {
  const filePath = projectAgentsPath(directory);
  const content = normalizeAgentsText(instructions);
  await fs.writeFile(filePath, content, 'utf8');
  return { path: filePath, content };
}
