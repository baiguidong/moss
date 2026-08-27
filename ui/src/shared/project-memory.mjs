function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function redactProjectMemorySecrets(value) {
  return text(value)
    .replace(/(\b(?:authorization|cookie)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n]+)/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|subject[_-]?token|confirmation[_-]?token|assertion|password|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/([?&](?:code|token|access_token|refresh_token|id_token|client_secret|api_key)=)[^&\s]+/gi, '$1[REDACTED]');
}

function textList(value, limit = 20) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    const normalized = redactProjectMemorySecrets(entry).slice(0, 2000);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function assetCandidates(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const filePath = text(entry.path).slice(0, 4096);
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    result.push({
      path: filePath,
      name: redactProjectMemorySecrets(entry.name).slice(0, 256),
      reason: redactProjectMemorySecrets(entry.reason).slice(0, 1000),
    });
    if (result.length >= 10) break;
  }
  return result;
}

export function normalizeProjectFinalizerResult(value, fallbackConclusion = '') {
  const source = value && typeof value === 'object' ? value : {};
  return {
    conclusion: (redactProjectMemorySecrets(source.conclusion) || redactProjectMemorySecrets(fallbackConclusion) || '会话已完成，暂无可提取结论。').slice(0, 4000),
    decisions: textList(source.decisions),
    facts: textList(source.facts),
    completedWork: textList(source.completedWork),
    unresolvedQuestions: textList(source.unresolvedQuestions),
    assetCandidates: assetCandidates(source.assetCandidates),
    projectMemory: redactProjectMemorySecrets(source.projectMemory).slice(0, 30000),
  };
}

export function parseProjectFinalizerResponse(responseText, fallbackConclusion = '') {
  const raw = text(responseText);
  if (!raw) return normalizeProjectFinalizerResult(null, fallbackConclusion);
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return normalizeProjectFinalizerResult(
        JSON.parse(withoutFence.slice(start, end + 1)),
        fallbackConclusion,
      );
    } catch {}
  }
  return normalizeProjectFinalizerResult({ conclusion: raw }, fallbackConclusion);
}

function markdownList(values, emptyLabel = '无') {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join('\n')
    : `- ${emptyLabel}`;
}

export function formatProjectMemoryForDisplay(value) {
  const memory = text(value);
  if (!memory) return '';
  return memory
    .replace(/^#\s+项目记忆\s*\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderProjectSessionMemory({
  projectId,
  sessionId,
  sessionTitle,
  completedAt,
  result,
  publishedAssets = [],
}) {
  const normalized = normalizeProjectFinalizerResult(result);
  const timestamp = new Date(completedAt).toISOString();
  return [
    `# ${text(sessionTitle) || '项目会话总结'}`,
    '',
    `- Project: ${projectId}`,
    `- Session: ${sessionId}`,
    `- Completed: ${timestamp}`,
    '',
    '## 结论',
    '',
    normalized.conclusion,
    '',
    '## 已完成工作',
    '',
    markdownList(normalized.completedWork),
    '',
    '## 决策',
    '',
    markdownList(normalized.decisions),
    '',
    '## 已确认事实',
    '',
    markdownList(normalized.facts),
    '',
    '## 未解决问题',
    '',
    markdownList(normalized.unresolvedQuestions),
    '',
    '## 发布资产',
    '',
    markdownList(publishedAssets.map((asset) => asset.name || asset.fileName)),
    '',
  ].join('\n');
}

export function renderFallbackProjectMemory(existingMemory, result, sessionTitle, completedAt) {
  const normalized = normalizeProjectFinalizerResult(result);
  const existing = text(existingMemory) || [
    '# 项目记忆',
    '',
    '## 当前上下文',
    '',
    '- 暂无项目背景。',
  ].join('\n');
  return [
    existing,
    '',
    `## 会话结论：${text(sessionTitle) || '项目会话'}`,
    '',
    `更新时间：${new Date(completedAt).toISOString()}`,
    '',
    normalized.conclusion,
    '',
    '### 关键决策',
    markdownList(normalized.decisions),
    '',
    '### 已确认事实',
    markdownList(normalized.facts),
    '',
    '### 待处理问题',
    markdownList(normalized.unresolvedQuestions),
  ].join('\n');
}
