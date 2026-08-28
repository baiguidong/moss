import { redactProjectMemorySecrets } from './project-memory.mjs';

export const PROJECT_DECISION_POLICY_MODES = Object.freeze([
  'auto_all',
  'recommend',
  'auto_low_risk',
]);
export const PROJECT_DECISION_TTL_MS = 24 * 60 * 60 * 1000;

const POLICY_MODE_SET = new Set(PROJECT_DECISION_POLICY_MODES);
const DECISION_STATUSES = new Set(['pending', 'resolved', 'rejected', 'expired']);

function text(value, limit = 2000) {
  return redactProjectMemorySecrets(typeof value === 'string' ? value : '').trim().slice(0, limit);
}

function normalizeOption(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = text(raw.label, 200);
  if (!label) return null;
  return {
    label,
    description: text(raw.description, 1000),
    preview: text(raw.preview, 4000),
  };
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const question = text(raw.question, 1000);
  if (!question) return null;
  return {
    question,
    header: text(raw.header, 100) || '需要判断',
    options: Array.isArray(raw.options) ? raw.options.map(normalizeOption).filter(Boolean).slice(0, 4) : [],
    multiSelect: raw.multiSelect === true,
  };
}

function isRecommendedLabel(value) {
  return /(?:\(recommended\)|（推荐）|\(推荐\))\s*$/i.test(String(value || '').trim());
}

export function normalizeProjectDecisionPolicy(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    mode: POLICY_MODE_SET.has(source.mode) ? source.mode : 'auto_all',
  };
}

export function classifyProjectDecisionKind(input) {
  const source = typeof input?.metadata?.source === 'string' ? input.metadata.source.trim() : '';
  if (source === 'project:external-side-effect') return { kind: 'external_action', riskLevel: 'high' };
  if (source === 'project:auth') return { kind: 'authorization', riskLevel: 'high' };
  if (source === 'project:tool-permission') return { kind: 'tool_permission', riskLevel: 'medium' };
  const questionText = (Array.isArray(input?.questions) ? input.questions : [])
    .flatMap((question) => [
      question?.question,
      ...(Array.isArray(question?.options)
        ? question.options.flatMap((option) => [option?.label, option?.description, option?.preview])
        : []),
    ])
    .filter((value) => typeof value === 'string')
    .join('\n');
  if (
    /confirmation[_-]?token|确认令牌/i.test(questionText) ||
    /(?:发送|分享|删除|发布|授权|邀请|发起会议|创建会议|收款|付款|send|share|delete|publish|authori[sz]e|invite|create\s+(?:a\s+)?meeting)/i.test(questionText)
  ) {
    return { kind: 'external_action', riskLevel: 'high' };
  }
  if (source === 'project:preference') return { kind: 'preference', riskLevel: 'low' };
  return { kind: 'clarification', riskLevel: 'medium' };
}

export function buildProjectDecisionRecommendation(questions) {
  const answers = {};
  const reasons = [];
  for (const question of Array.isArray(questions) ? questions : []) {
    if (question.multiSelect) return null;
    const recommended = question.options.find((option) => isRecommendedLabel(option.label));
    if (!recommended) return null;
    answers[question.question] = recommended.label;
    if (recommended.description) reasons.push(recommended.description);
  }
  if (Object.keys(answers).length === 0) return null;
  return {
    answers,
    reason: reasons.join('；').slice(0, 2000),
  };
}

function hasCompleteDecisionAnswers(decision, answers) {
  return Boolean(
    answers &&
    Object.keys(answers).length === decision.questions.length &&
    decision.questions.every((question) => Boolean(answers[question.question])),
  );
}

export function buildProjectDecisionPolicyResolution(policy, decision) {
  const normalizedPolicy = normalizeProjectDecisionPolicy(policy);
  const recommendedAnswers = decision?.recommendation?.answers || {};
  if (
    normalizedPolicy.mode === 'auto_low_risk' &&
    decision?.kind === 'preference' &&
    decision?.riskLevel === 'low' &&
    decision.questions.every((question) => question.multiSelect !== true) &&
    hasCompleteDecisionAnswers(decision, recommendedAnswers)
  ) {
    return {
      answers: recommendedAnswers,
      reason: decision.recommendation?.reason || '已自动采用 AI 推荐的低风险偏好。',
    };
  }
  if (normalizedPolicy.mode !== 'auto_all' || !Array.isArray(decision?.questions)) return null;
  const answers = {};
  for (const question of decision.questions) {
    const optionLabels = Array.isArray(question.options)
      ? question.options.map((option) => option?.label).filter(Boolean)
      : [];
    const recommended = recommendedAnswers[question.question];
    if (recommended && optionLabels.includes(recommended)) {
      answers[question.question] = recommended;
    } else if (question.multiSelect) {
      if (optionLabels.length === 0) return null;
      answers[question.question] = optionLabels.join(', ');
    } else {
      if (!optionLabels[0]) return null;
      answers[question.question] = optionLabels[0];
    }
  }
  if (!hasCompleteDecisionAnswers(decision, answers)) return null;
  return {
    answers,
    reason: decision.recommendation?.reason || '项目决策策略为“全部允许”，已自动采用可执行选项。',
  };
}

export function shouldAutoResolveProjectDecision(policy, decision) {
  return Boolean(buildProjectDecisionPolicyResolution(policy, decision));
}

export function getProjectDecisionExpirationDelay(expiresAt, now = Date.now()) {
  const deadline = Number.isFinite(expiresAt) ? expiresAt : now + PROJECT_DECISION_TTL_MS;
  return Math.max(0, Math.min(PROJECT_DECISION_TTL_MS, deadline - now));
}

export function buildProjectDecisionRuntimeAnnotations(input, answers, annotations) {
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  const answerMap = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const annotationMap = annotations && typeof annotations === 'object' && !Array.isArray(annotations)
    ? annotations
    : {};
  const result = {};
  for (const question of questions) {
    if (!question || typeof question.question !== 'string' || !question.question.trim()) continue;
    const key = question.question;
    const answer = typeof answerMap[key] === 'string' ? answerMap[key] : '';
    const selectedLabels = question.multiSelect
      ? answer.split(',').map((entry) => entry.trim()).filter(Boolean)
      : [answer];
    const selectedPreview = (Array.isArray(question.options) ? question.options : [])
      .filter((option) => selectedLabels.includes(option?.label) && typeof option?.preview === 'string')
      .map((option) => option.preview.trim())
      .filter(Boolean)
      .join('\n\n---\n\n');
    const explicit = annotationMap[key] && typeof annotationMap[key] === 'object'
      ? annotationMap[key]
      : {};
    const preview = typeof explicit.preview === 'string' && explicit.preview.trim()
      ? explicit.preview
      : selectedPreview;
    const notes = typeof explicit.notes === 'string' ? explicit.notes.trim() : '';
    if (preview || notes) {
      result[key] = {
        ...(preview ? { preview } : {}),
        ...(notes ? { notes } : {}),
      };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function normalizeProjectDecision(raw, fallbackProjectId = '') {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const projectId = typeof raw.projectId === 'string' && raw.projectId.trim()
    ? raw.projectId.trim()
    : fallbackProjectId;
  const requestId = typeof raw.requestId === 'string' ? raw.requestId.trim() : '';
  if (!id || !projectId || !requestId) return null;
  const questions = Array.isArray(raw.questions)
    ? raw.questions.map(normalizeQuestion).filter(Boolean).slice(0, 4)
    : [];
  const recommendation = raw.recommendation === null
    ? null
    : raw.recommendation && typeof raw.recommendation === 'object'
      ? {
      answers: Object.fromEntries(Object.entries(raw.recommendation.answers || {})
        .map(([key, value]) => [text(key, 1000), text(value, 1000)])
        .filter(([key, value]) => key && value)),
      reason: text(raw.recommendation.reason, 2000),
      }
      : buildProjectDecisionRecommendation(questions);
  return {
    id,
    projectId,
    requestId,
    toolUseId: typeof raw.toolUseId === 'string' && raw.toolUseId.trim() ? raw.toolUseId.trim() : null,
    taskId: typeof raw.taskId === 'string' && raw.taskId.trim() ? raw.taskId.trim() : null,
    parentSessionId: typeof raw.parentSessionId === 'string' ? raw.parentSessionId.trim() : '',
    originSessionId: typeof raw.originSessionId === 'string' ? raw.originSessionId.trim() : '',
    originAgentId: typeof raw.originAgentId === 'string' && raw.originAgentId.trim() ? raw.originAgentId.trim() : null,
    originAgentType: typeof raw.originAgentType === 'string' && raw.originAgentType.trim() ? raw.originAgentType.trim() : null,
    originLabel: text(raw.originLabel, 300),
    kind: ['preference', 'clarification', 'external_action', 'authorization', 'tool_permission'].includes(raw.kind)
      ? raw.kind
      : 'clarification',
    riskLevel: ['low', 'medium', 'high'].includes(raw.riskLevel) ? raw.riskLevel : 'medium',
    status: DECISION_STATUSES.has(raw.status) ? raw.status : 'pending',
    blocking: raw.blocking !== false,
    questions,
    recommendation,
    resolution: raw.resolution && typeof raw.resolution === 'object' ? {
      answers: Object.fromEntries(Object.entries(raw.resolution.answers || {})
        .map(([key, value]) => [text(key, 1000), text(value, 1000)])
        .filter(([key, value]) => key && value)),
      source: ['user', 'policy', 'system'].includes(raw.resolution.source) ? raw.resolution.source : 'user',
      note: text(raw.resolution.note, 2000),
    } : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    resolvedAt: Number.isFinite(raw.resolvedAt) ? raw.resolvedAt : null,
    expiresAt: Number.isFinite(raw.expiresAt) ? raw.expiresAt : null,
  };
}

export function getPendingProjectDecisionIds(decisions, filters = {}) {
  return (Array.isArray(decisions) ? decisions : [])
    .filter((decision) => decision?.status === 'pending')
    .filter((decision) => !filters.taskId || decision.taskId === filters.taskId)
    .filter((decision) => !filters.parentSessionId || decision.parentSessionId === filters.parentSessionId)
    .map((decision) => decision.id);
}
