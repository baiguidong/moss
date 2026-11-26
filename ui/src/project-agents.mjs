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

const fileQueue = new Map();
const projectDefaults = readFileSync(new URL('./project-session-defaults.md', import.meta.url), 'utf8');

export function ensureProjectAgentsFile(directory, instructions = '', { creating = false } = {}) {
  const filePath = projectAgentsPath(directory);
  return runInKeyedQueue(fileQueue, filePath, async () => {
    let existing;
    try {
      existing = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const configured = normalizeAgentsText(instructions);
    const base = existing ?? configured;
    const additions = [];
    if (existing !== undefined && creating && instructions.trim()) {
      const body = configured.replace(/^# AGENTS\.md\s*\n/i, '').trim();
      if (body && !existing.includes(body)) additions.push(body);
    }
    if (creating && ![base, ...additions].some(text => text.includes(projectDefaults.trim()))) {
      additions.push(projectDefaults.trim());
    }
    const separator = base.endsWith('\n') ? '\n' : '\n\n';
    const suffix = additions.length ? separator + additions.join('\n\n') + '\n' : '';
    const content = base + suffix;
    if (existing === undefined) {
      await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    } else if (suffix) {
      await fs.appendFile(filePath, suffix);
    }
    return { path: filePath, content, created: existing === undefined };
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
