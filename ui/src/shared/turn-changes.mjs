import { applyPatch, structuredPatch } from 'diff';

const POSSIBLY_UNTRACKED_TOOLS = new Set(['Bash', 'NotebookEdit']);

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isTopLevelUserMessage(event) {
  if (!isObject(event) || event.type !== 'user') return false;
  if (event.isMeta === true || event.isSynthetic === true) return false;
  if (event.origin?.kind && event.origin.kind !== 'human') return false;
  if (event.toolUseResult || event.tool_use_result) return false;
  const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
  return !blocks.some((block) => block?.type === 'tool_result');
}

function userMessageText(event) {
  if (typeof event?.prompt === 'string') return event.prompt.trim();
  const content = event?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export function backfillVisibleUserMessageIds(history, sourceHistory) {
  const target = Array.isArray(history) ? history : [];
  const sourceUsers = (Array.isArray(sourceHistory) ? sourceHistory : [])
    .filter(isTopLevelUserMessage)
    .filter((event) => typeof event.uuid === 'string' && event.uuid.trim());
  if (sourceUsers.length === 0) return target;

  const claimedSourceIds = new Set(
    target
      .filter(isTopLevelUserMessage)
      .map((event) => (typeof event.uuid === 'string' ? event.uuid.trim() : ''))
      .filter(Boolean),
  );
  let sourceCursor = 0;
  let changed = false;
  const result = target.map((event) => {
    if (!isTopLevelUserMessage(event)) {
      return event;
    }

    const existingId = typeof event.uuid === 'string' ? event.uuid.trim() : '';
    if (existingId) {
      const existingSourceIndex = sourceUsers.findIndex((source, index) => (
        index >= sourceCursor && source.uuid === existingId
      ));
      if (existingSourceIndex >= 0) sourceCursor = existingSourceIndex + 1;
      return event;
    }

    const targetText = userMessageText(event);
    let sourceIndex = sourceUsers.findIndex((source, index) => (
      index >= sourceCursor
      && !claimedSourceIds.has(source.uuid)
      && targetText
      && userMessageText(source) === targetText
    ));
    if (sourceIndex < 0) {
      sourceIndex = sourceUsers.findIndex((source, index) => (
        index >= sourceCursor && !claimedSourceIds.has(source.uuid)
      ));
    }
    const source = sourceUsers[sourceIndex];
    if (!source) return event;
    claimedSourceIds.add(source.uuid);
    sourceCursor = sourceIndex + 1;
    changed = true;
    return { ...event, uuid: source.uuid };
  });

  return changed ? result : target;
}

function normalizeHunks(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((hunk) => {
    if (!isObject(hunk) || !Array.isArray(hunk.lines)) return [];
    return [{
      oldStart: Number(hunk.oldStart) || 0,
      oldLines: Number(hunk.oldLines) || 0,
      newStart: Number(hunk.newStart) || 0,
      newLines: Number(hunk.newLines) || 0,
      lines: hunk.lines.map((line) => String(line)),
    }];
  });
}

function countHunkLines(hunks) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
      if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
    }
  }
  return { additions, deletions };
}

function syntheticCreateHunk(content) {
  const lines = String(content || '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return [{
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: lines.map((line) => `+${line}`),
  }];
}

function resultFileContents(rawResult, filePath, hunks) {
  const before = rawResult.originalFile === null
    ? ''
    : typeof rawResult.originalFile === 'string'
      ? rawResult.originalFile
      : null;
  if (before === null) return null;

  if (
    (rawResult.type === 'create' || rawResult.type === 'update')
    && typeof rawResult.content === 'string'
  ) {
    return { before, after: rawResult.content };
  }
  if (hunks.length === 0) return null;
  try {
    const after = applyPatch(before, {
      oldFileName: filePath,
      newFileName: filePath,
      oldHeader: '',
      newHeader: '',
      hunks,
    });
    return typeof after === 'string' ? { before, after } : null;
  } catch {
    return null;
  }
}

function netHunks(filePath, before, after) {
  try {
    const patch = structuredPatch(
      filePath,
      filePath,
      before,
      after,
      '',
      '',
      { context: 3, timeout: 1_000 },
    );
    return normalizeHunks(patch?.hunks);
  } catch {
    return [];
  }
}

function appendFileChange(files, rawResult) {
  if (!isObject(rawResult) || typeof rawResult.filePath !== 'string') return false;
  const filePath = rawResult.filePath.trim();
  if (!filePath) return false;
  const isNewFile = rawResult.type === 'create';
  let hunks = normalizeHunks(rawResult.structuredPatch);
  if (hunks.length === 0 && isNewFile && typeof rawResult.content === 'string') {
    hunks = syntheticCreateHunk(rawResult.content);
  }
  if (hunks.length === 0 && !(isNewFile && typeof rawResult.content === 'string')) {
    return false;
  }

  const existing = files.get(filePath) || {
    filePath,
    isNewFile: false,
    structuredPatch: [],
    additions: 0,
    deletions: 0,
    initialContent: undefined,
    finalContent: undefined,
    netContentComplete: undefined,
  };
  existing.isNewFile ||= isNewFile;
  const contents = resultFileContents(rawResult, filePath, hunks);
  if (contents && existing.netContentComplete !== false) {
    existing.netContentComplete = true;
    existing.initialContent ??= contents.before;
    existing.finalContent = contents.after;
    const finalHunks = netHunks(
      filePath,
      existing.initialContent,
      existing.finalContent,
    );
    if (existing.initialContent === existing.finalContent || finalHunks.length > 0) {
      existing.structuredPatch = finalHunks;
      const stats = countHunkLines(finalHunks);
      existing.additions = stats.additions;
      existing.deletions = stats.deletions;
    } else {
      const stats = countHunkLines(hunks);
      existing.structuredPatch.push(...hunks);
      existing.additions += stats.additions;
      existing.deletions += stats.deletions;
    }
  } else {
    existing.netContentComplete = false;
    const stats = countHunkLines(hunks);
    existing.structuredPatch.push(...hunks);
    existing.additions += stats.additions;
    existing.deletions += stats.deletions;
  }
  if (existing.structuredPatch.length === 0 && !existing.isNewFile) {
    files.delete(filePath);
    return true;
  }
  files.set(filePath, existing);
  return true;
}

function collectToolUses(event, toolNames) {
  if (event?.type !== 'assistant' || !Array.isArray(event.message?.content)) return;
  for (const block of event.message.content) {
    if (block?.type !== 'tool_use') continue;
    const toolUseId = typeof block.id === 'string' ? block.id : '';
    const toolName = typeof block.name === 'string' ? block.name : 'Tool';
    if (toolUseId) toolNames.set(toolUseId, toolName);
  }
}

function collectToolResults(event, files, toolNames) {
  if (event?.type !== 'user' || !Array.isArray(event.message?.content)) {
    return false;
  }
  const blocks = event.message.content.filter((block) => block?.type === 'tool_result');
  let hasUnverifiedChanges = false;
  for (const block of blocks) {
    const toolName = toolNames.get(block.tool_use_id) || block.tool_name || 'Tool';
    const rawResult = blocks.length === 1
      ? (event.toolUseResult ?? event.tool_use_result ?? block.content)
      : block.content;
    const recorded = appendFileChange(files, rawResult);
    if (POSSIBLY_UNTRACKED_TOOLS.has(toolName) || (!recorded && ['Edit', 'Write'].includes(toolName))) {
      hasUnverifiedChanges = true;
    }
  }
  return hasUnverifiedChanges;
}

export function collectTurnChanges(history) {
  const turns = [];
  let current = null;

  const finish = () => {
    if (!current || current.files.size === 0) {
      current = null;
      return;
    }
    const files = [...current.files.values()].map((file) => {
      const {
        initialContent: _initialContent,
        finalContent: _finalContent,
        netContentComplete: _netContentComplete,
        ...summary
      } = file;
      return summary;
    });
    turns.push({
      userMessageId: current.userMessageId,
      files,
      stats: {
        filesChanged: files.length,
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      },
      hasUnverifiedChanges: current.hasUnverifiedChanges,
    });
    current = null;
  };

  for (const event of Array.isArray(history) ? history : []) {
    if (isTopLevelUserMessage(event)) {
      finish();
      const userMessageId = typeof event.uuid === 'string' ? event.uuid.trim() : '';
      current = userMessageId ? {
        userMessageId,
        files: new Map(),
        toolNames: new Map(),
        hasUnverifiedChanges: false,
      } : null;
      continue;
    }
    if (!current) continue;
    collectToolUses(event, current.toolNames);
    current.hasUnverifiedChanges ||= collectToolResults(
      event,
      current.files,
      current.toolNames,
    );
  }
  finish();
  return turns;
}

export function truncateHistoryBeforeUserMessage(history, userMessageId) {
  const source = Array.isArray(history) ? history : [];
  const index = source.findIndex((event) => (
    isTopLevelUserMessage(event) && event.uuid === userMessageId
  ));
  if (index < 0) return null;
  return source.slice(0, index);
}
