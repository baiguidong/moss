import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
        maxTurns: 1, thinkingConfig: { type: 'disabled' }, permissionMode: 'default', allowedTools: [],
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
        else if (message.type === 'result' && message.is_error) throw new Error('记忆模型请求失败。');
      }
      signal.throwIfAborted();
      return latestText || streamedText;
    } finally {
      try { await runtime?.dispose(); }
      finally { await fs.rm(runDir, { recursive: true, force: true }).catch(() => {}); }
    }
  };
}
