import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildThinkingConfig } from './desktop-settings.mjs';
import { redactProjectMemorySecrets } from './shared/project-memory.mjs';

function memoryQueryError(message, apiKey) {
  const details = (typeof message.result === 'string' && message.result.trim())
    || (Array.isArray(message.errors) && message.errors.filter(error => typeof error === 'string').join('; '))
    || (typeof message.subtype === 'string' && message.subtype !== 'success' ? message.subtype : '');
  const redacted = redactProjectMemorySecrets(apiKey ? details.split(apiKey).join('[REDACTED]') : details).slice(0, 2000);
  return new Error(redacted ? `记忆模型请求失败：${redacted}` : '记忆模型请求失败。');
}

/** A disposable, tool-free runtime; it never borrows a source session's runtime. */
export function createProjectMemoryQuery({ prepareRuntime, getSessionConstructor, getSettings, getProjectRunsDir,
  getProjectWorkspaceDir, mossHome, onUsage = () => {} }) {
  return async ({ project, source, prompt, signal }) => {
    await prepareRuntime();
    signal.throwIfAborted();
    const ClaudeSession = await getSessionConstructor();
    const settings = getSettings();
    const runId = `memory-${randomUUID()}`;
    const runDir = path.join(getProjectRunsDir(project.id), runId);
    await fs.mkdir(runDir, { recursive: true });
    let runtime;
    try {
      runtime = new ClaudeSession({
        cwd: getProjectWorkspaceDir(project.id), model: settings.fastModel || settings.model,
        fastModel: settings.fastModel || undefined,
        customSystemPrompt: 'You maintain project memory from supplied evidence. Return only the requested JSON. Never call tools.',
        // Reasoning-only models reject a forced disabled mode. Use the same
        // explicit/default thinking configuration as ordinary desktop sessions.
        maxTurns: 1, thinkingConfig: buildThinkingConfig(settings), permissionMode: 'default', allowedTools: [],
        url: settings.url || undefined, apiKey: settings.apiKey || undefined,
        mcpServers: {}, addDirs: [], workspaceDirectories: [],
        environment: {
          MOSS_TRACE_SCOPE: mossHome, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0',
          MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
          MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
          MOSS_RUNTIME_ADVANCED_SETTINGS: JSON.stringify({ moss_response_language: settings.language }),
        },
        projectDir: runDir, taskScope: { kind: 'session', sessionId: runId }, coordinatorMode: false,
        onUsage: event => onUsage(event, { sessionId: source?.id || runId, projectId: project.id }),
        onPermissionRequest: async () => ({ behavior: 'deny', message: 'Memory maintenance has no tools.' }),
      });
      let latestText = '', streamedText = '';
      for await (const message of runtime.send(prompt, signal)) {
        if (message.type === 'assistant') {
          const content = message.message?.content;
          latestText = (typeof content === 'string' ? content : Array.isArray(content)
            ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n') : '') || latestText;
        } else if (message.type === 'stream_event' && message.event?.delta?.type === 'text_delta') streamedText += message.event.delta.text || '';
        else if (message.type === 'result') {
          if (message.is_error) throw memoryQueryError(message, settings.apiKey);
          if (typeof message.result === 'string') latestText = message.result || latestText;
        }
      }
      signal.throwIfAborted();
      return latestText || streamedText;
    } finally {
      try { await runtime?.dispose(); }
      finally { await fs.rm(runDir, { recursive: true, force: true }).catch(() => {}); }
    }
  };
}
