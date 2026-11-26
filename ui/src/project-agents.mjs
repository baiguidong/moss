import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runInKeyedQueue } from './shared/keyed-queue.mjs';
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

export async function hasProjectAgentsFile(directory) {
  try {
    return (await fs.stat(projectAgentsPath(directory))).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

const fileQueue = new Map();
const projectDefaults = readFileSync(new URL('./project-session-defaults.md', import.meta.url), 'utf8');

export function ensureProjectAgentsFile(directory, instructions = '', { creating = false } = {}) {
  const filePath = projectAgentsPath(directory);
  return runInKeyedQueue(fileQueue, filePath, async () => {
    try {
      return { path: filePath, content: await fs.readFile(filePath, 'utf8'), created: false };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let content = normalizeAgentsText(instructions);
    const defaults = projectDefaults.trim();
    if (creating && !content.includes(defaults)) {
      content += `\n${defaults}\n`;
    }
    try {
      await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      // Another creator may have published the file after our first read.
      if (error.code === 'EEXIST') {
        return { path: filePath, content: await fs.readFile(filePath, 'utf8'), created: false };
      }
      throw error;
    }
    return { path: filePath, content, created: true };
  });
}

/** Save the complete Markdown document edited in project settings. */
export function writeProjectAgentsFile(directory, instructions = '') {
  const filePath = projectAgentsPath(directory);
  return runInKeyedQueue(fileQueue, filePath, async () => {
    const content = instructions;
    await fs.writeFile(filePath, content, 'utf8');
    return { path: filePath, content };
  });
}
