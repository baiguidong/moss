import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { calculateFileSha256, isPathInsideDirectory } from './shared/file-path-utils.mjs';
import { countSessionMessages } from './shared/session-message-count.mjs';
import { REMOTE_WORKSPACE_SCHEME, parseRemoteWorkspaceUrl } from './remote-workspace-protocol.mjs';

export function createSessionPromptPreparation({
  emitSessionMeta,
  emitToRenderer,
  emitWorkspaceChanged,
  ensureRemoteSessionConnection,
  schedulePersistSession,
  takeRemoteAttachmentSource,
  uploadFileToRemoteSessionWorkspace,
  uploadRemoteDirectWorkspaceData,
}) {
  const execAsync = promisify(exec);
  const BASH_MODE_TIMEOUT_MS = 120 * 1000;
  const BASH_MODE_MAX_OUTPUT_CHARS = 200 * 1024;
  const BASH_MODE_CONTEXT_CHARS = 8 * 1024;

  // "!" prefix runs the command directly in the session workspace (CLI REPL
  // bash mode). The result is shown in the UI and injected as context into the
  // next model turn instead of querying the model now.
  async function runDirectBashCommand(sessionRecord, sender, command) {
    let output = '';
    let exitCode = 0;
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: sessionRecord.workspace,
        timeout: BASH_MODE_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
      });
      output = [stdout, stderr].filter(Boolean).join('\n');
    } catch (err) {
      exitCode = typeof err?.code === 'number' ? err.code : 1;
      output = [err?.stdout, err?.stderr].filter(Boolean).join('\n') || String(err?.message || err);
      if (err?.killed) {
        output += '\n(命令超时，已终止)';
      }
    }
    if (output.length > BASH_MODE_MAX_OUTPUT_CHARS) {
      output = `${output.slice(0, BASH_MODE_MAX_OUTPUT_CHARS)}\n…(输出已截断)`;
    }

    const bashEvent = {
      type: 'bash_command',
      command,
      output,
      exitCode,
      timestamp: Date.now(),
    };
    sessionRecord.history.push(bashEvent);
    sessionRecord.messageCount = countSessionMessages(sessionRecord.history);
    sessionRecord.updatedAt = Date.now();
    sessionRecord.preview = `$ ${command}`;
    if (!Array.isArray(sessionRecord.pendingBashContexts)) {
      sessionRecord.pendingBashContexts = [];
    }
    sessionRecord.pendingBashContexts.push({
      command,
      output: output.slice(0, BASH_MODE_CONTEXT_CHARS),
      exitCode,
    });
    schedulePersistSession(sessionRecord, true);
    emitSessionMeta(sessionRecord);
    emitToRenderer('agent:event', { sessionId: sessionRecord.id, payload: bashEvent });
    return { ok: true, bash: true, exitCode };
  }

  function consumePendingBashContexts(sessionRecord) {
    const pending = sessionRecord.pendingBashContexts;
    if (!Array.isArray(pending) || pending.length === 0) return '';
    sessionRecord.pendingBashContexts = [];
    const blocks = pending.map(({ command, output, exitCode }) => {
      const body = output?.trim() ? output : '(no output)';
      const exit = exitCode ? `\n(exit code: ${exitCode})` : '';
      return `$ ${command}\n${body}${exit}`;
    });
    return `[Shell commands the user ran directly in the workspace]\n${blocks.join('\n\n')}\n\n---\n\n`;
  }

  const INLINE_IMAGE_MEDIA_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  // Anthropic API rejects oversized images; the runtime downsamples inline
  // blocks, but reading huge files into memory is wasteful — fall back to the
  // Read tool (which streams with a token budget) beyond this size.
  const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
  const DEFAULT_LARGE_PROMPT_SPILL_CHARS = 120_000;
  const MIN_LARGE_PROMPT_SPILL_CHARS = 10_000;

  function getLargePromptSpillThreshold() {
    const parsed = Number.parseInt(String(process.env.MOSS_LARGE_PROMPT_SPILL_CHARS || ''), 10);
    if (Number.isFinite(parsed) && parsed >= MIN_LARGE_PROMPT_SPILL_CHARS) {
      return parsed;
    }
    return DEFAULT_LARGE_PROMPT_SPILL_CHARS;
  }

  async function prepareRemoteFileAttachments(sessionRecord, filePaths) {
    const runtimePaths = [];
    const visiblePaths = [];
    const inlineSources = new Map();

    for (const filePath of filePaths) {
      if (filePath.startsWith(`${REMOTE_WORKSPACE_SCHEME}:`)) {
        const parsed = parseRemoteWorkspaceUrl(filePath);
        if (parsed.sessionId !== sessionRecord.id) {
          throw new Error('Remote workspace attachment belongs to a different session.');
        }
        const source = takeRemoteAttachmentSource(sessionRecord, filePath);
        runtimePaths.push(parsed.filePath);
        visiblePaths.push(filePath);
        if (source) inlineSources.set(parsed.filePath, source);
        continue;
      }

      let localFile = false;
      try {
        localFile = (await fsp.stat(filePath)).isFile();
      } catch {}
      if (!localFile) {
        runtimePaths.push(filePath);
        visiblePaths.push(filePath);
        continue;
      }

      const uploaded = await uploadFileToRemoteSessionWorkspace(sessionRecord, {
        sourcePath: filePath,
        fileName: path.basename(filePath),
      });
      const runtimePath = uploaded.remotePath || uploaded.relativePath;
      runtimePaths.push(runtimePath);
      visiblePaths.push(uploaded.path);
      const source = takeRemoteAttachmentSource(sessionRecord, uploaded.path);
      if (source) inlineSources.set(runtimePath, source);
    }

    return { runtimePaths, visiblePaths, inlineSources };
  }

  async function buildInlineImageBlocks(filePaths, sourceByPath = new Map()) {
    const blocks = [];
    const inlinedPaths = new Set();
    for (const filePath of filePaths) {
      const source = sourceByPath.get(filePath);
      const sourcePath = source?.sourcePath || filePath;
      const mediaType = INLINE_IMAGE_MEDIA_TYPES[path.extname(sourcePath).toLowerCase()];
      if (!mediaType) continue;
      try {
        let data;
        if (source?.data) {
          data = Buffer.isBuffer(source.data) ? source.data : Buffer.from(source.data);
        } else {
          const stat = await fsp.stat(sourcePath);
          if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INLINE_IMAGE_BYTES) continue;
          data = await fsp.readFile(sourcePath);
        }
        if (data.byteLength === 0 || data.byteLength > MAX_INLINE_IMAGE_BYTES) continue;
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: data.toString('base64'),
          },
        });
        inlinedPaths.add(filePath);
      } catch (err) {
        console.warn('[agent:send] Failed to inline image attachment:', sourcePath, err?.message || err);
      }
    }
    return { blocks, inlinedPaths };
  }

  function formatLargePromptCharCount(value) {
    return new Intl.NumberFormat('en-US').format(value);
  }

  function buildLargePromptFileContent(prompt, createdAt) {
    return [
      '# Large User Prompt',
      '',
      `Created: ${createdAt}`,
      `Characters: ${formatLargePromptCharCount(prompt.length)}`,
      '',
      'The desktop client saved this prompt to a file because it was too large to inline safely in the model request.',
      '',
      '---',
      '',
      prompt,
      '',
    ].join('\n');
  }

  async function maybeSpillLargePromptToWorkspace(sessionRecord, prompt) {
    const threshold = getLargePromptSpillThreshold();
    if (typeof prompt !== 'string' || prompt.length <= threshold) {
      return null;
    }

    const createdAt = new Date().toISOString();
    const safeTimestamp = createdAt.replace(/[:.]/g, '-');
    const fileName = `user-prompt-${safeTimestamp}-${randomUUID().slice(0, 8)}.md`;
    if (sessionRecord.agentMode === 'remote-direct') {
      const config = await ensureRemoteSessionConnection(sessionRecord);
      const remoteFile = await uploadRemoteDirectWorkspaceData({
        ...config,
        fileName,
        data: Buffer.from(buildLargePromptFileContent(prompt, createdAt), 'utf8'),
      });
      emitWorkspaceChanged(sessionRecord, 'upload', remoteFile.path);
      return {
        filePath: remoteFile.path,
        charCount: prompt.length,
        threshold,
      };
    }

    const promptDir = path.join(sessionRecord.workspace, '.moss', 'large-prompts');
    const filePath = path.join(promptDir, fileName);

    await fsp.mkdir(promptDir, { recursive: true });
    await fsp.writeFile(filePath, buildLargePromptFileContent(prompt, createdAt), 'utf8');

    return {
      filePath,
      charCount: prompt.length,
      threshold,
    };
  }

  function buildLargePromptRuntimePrompt(spill) {
    return [
      '[Large user prompt saved to workspace]',
      '',
      `The user sent a prompt with ${formatLargePromptCharCount(spill.charCount)} characters, which is too large to inline safely in the model request.`,
      `The full prompt is saved at: ${spill.filePath}`,
      '',
      'Read that file first, then continue based on the user request in that file.',
      'Do not treat this message as a request to summarize the file unless the saved prompt asks for that.',
    ].join('\n');
  }

  function buildLargePromptVisiblePrompt(spill) {
    return [
      `用户发送了一段较长内容（${formatLargePromptCharCount(spill.charCount)} 字符），已自动保存到：`,
      spill.filePath,
      '',
      '请读取该文件后继续处理。',
    ].join('\n');
  }

  async function localizeProjectSessionAttachments(sessionRecord, filePaths) {
    if (!sessionRecord.projectId || sessionRecord.agentMode === 'remote-direct') return filePaths;
    const workspace = path.resolve(sessionRecord.workspace);
    const realWorkspace = await fsp.realpath(workspace).catch(() => workspace);
    const inputsDir = path.join(workspace, 'inputs');
    await fsp.mkdir(inputsDir, { recursive: true });
    const localized = [];
    for (const filePath of filePaths) {
      const resolvedSource = path.resolve(filePath);
      const realSource = await fsp.realpath(resolvedSource);
      const stat = await fsp.stat(realSource);
      if (!stat.isFile()) throw new Error(`附件不是文件：${path.basename(resolvedSource)}`);
      if (
        isPathInsideDirectory(workspace, resolvedSource) &&
        isPathInsideDirectory(realWorkspace, realSource)
      ) {
        localized.push(resolvedSource);
        continue;
      }
      const rawName = path.basename(resolvedSource);
      const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'attachment';
      const parsed = path.parse(safeName);
      let targetPath = path.join(inputsDir, safeName);
      let suffix = 1;
      let sourceHash = null;
      while (fs.existsSync(targetPath)) {
        sourceHash ||= await calculateFileSha256(realSource);
        const targetHash = await calculateFileSha256(targetPath).catch(() => null);
        if (sourceHash === targetHash) break;
        targetPath = path.join(inputsDir, `${parsed.name || 'attachment'}-${suffix}${parsed.ext || ''}`);
        suffix += 1;
      }
      if (!fs.existsSync(targetPath)) await fsp.copyFile(realSource, targetPath);
      localized.push(targetPath);
    }
    return localized;
  }

  return {
    buildInlineImageBlocks,
    buildLargePromptRuntimePrompt,
    buildLargePromptVisiblePrompt,
    consumePendingBashContexts,
    localizeProjectSessionAttachments,
    maybeSpillLargePromptToWorkspace,
    prepareRemoteFileAttachments,
    runDirectBashCommand,
  };
}
