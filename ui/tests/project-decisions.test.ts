import { describe, expect, test } from 'bun:test';
import {
  buildProjectDecisionPolicyResolution,
  buildProjectDecisionRecommendation,
  buildProjectDecisionRuntimeAnnotations,
  classifyProjectDecisionKind,
  getPendingProjectDecisionIds,
  getProjectDecisionExpirationDelay,
  normalizeProjectDecision,
  normalizeProjectDecisionPolicy,
  shouldAutoResolveProjectDecision,
} from '../src/shared/project-decisions.mjs';

describe('project decisions', () => {
  const questions = [{
    question: '报告格式？',
    header: '格式',
    options: [
      { label: 'Markdown（推荐）', description: '便于沉淀和继续编辑' },
      { label: '纯文本', description: '兼容性更好' },
    ],
    multiSelect: false,
  }];

  test('extracts an explicit AI recommendation without inventing one', () => {
    expect(buildProjectDecisionRecommendation(questions)).toEqual({
      answers: { '报告格式？': 'Markdown（推荐）' },
      reason: '便于沉淀和继续编辑',
    });
    expect(buildProjectDecisionRecommendation([{ ...questions[0], options: [{ label: 'A' }, { label: 'B' }] }])).toBeNull();
    expect(normalizeProjectDecision({
      id: 'decision-manual',
      projectId: 'project-1',
      requestId: 'request-manual',
      questions,
      recommendation: null,
    }).recommendation).toBeNull();
  });

  test('only auto-resolves explicitly low-risk preferences', () => {
    const decision = normalizeProjectDecision({
      id: 'decision-1',
      projectId: 'project-1',
      requestId: 'request-1',
      kind: 'preference',
      riskLevel: 'low',
      questions,
    });
    expect(shouldAutoResolveProjectDecision({ mode: 'auto_low_risk' }, decision)).toBe(true);
    expect(shouldAutoResolveProjectDecision({ mode: 'recommend' }, decision)).toBe(false);
    expect(shouldAutoResolveProjectDecision({ mode: 'auto_low_risk' }, {
      ...decision,
      kind: 'external_action',
      riskLevel: 'high',
    })).toBe(false);
  });

  test('auto-resolves every answerable decision under the allow-all policy', () => {
    const externalDecision = normalizeProjectDecision({
      id: 'decision-external',
      projectId: 'project-1',
      requestId: 'request-external',
      kind: 'external_action',
      riskLevel: 'high',
      questions: [{
        question: '是否发送邮件？',
        options: [
          { label: '确认发送', description: '发送当前预览' },
          { label: '取消', description: '不发送' },
        ],
      }],
      recommendation: null,
    });
    expect(buildProjectDecisionPolicyResolution({ mode: 'auto_all' }, externalDecision)).toMatchObject({
      answers: { '是否发送邮件？': '确认发送' },
    });
    expect(shouldAutoResolveProjectDecision({ mode: 'auto_all' }, externalDecision)).toBe(true);

    const multiSelectDecision = normalizeProjectDecision({
      id: 'decision-multi',
      projectId: 'project-1',
      requestId: 'request-multi',
      questions: [{
        question: '包含哪些章节？',
        multiSelect: true,
        options: [{ label: '风险' }, { label: '建议' }],
      }],
      recommendation: null,
    });
    expect(buildProjectDecisionPolicyResolution({ mode: 'auto_all' }, multiSelectDecision)).toMatchObject({
      answers: { '包含哪些章节？': '风险, 建议' },
    });

    expect(buildProjectDecisionPolicyResolution({ mode: 'auto_all' }, {
      ...externalDecision,
      questions: [{ question: '缺少选项', options: [] }],
    })).toBeNull();
  });

  test('normalizes policy and keeps multiple pending requests independently', () => {
    expect(normalizeProjectDecisionPolicy(null)).toEqual({ mode: 'auto_all' });
    expect(normalizeProjectDecisionPolicy({ mode: 'recommend' })).toEqual({ mode: 'recommend' });
    expect(getPendingProjectDecisionIds([
      { id: 'a', status: 'pending', taskId: 'task-1' },
      { id: 'b', status: 'pending', taskId: 'task-1' },
      { id: 'c', status: 'resolved', taskId: 'task-1' },
      { id: 'd', status: 'pending', taskId: 'task-2' },
    ], { taskId: 'task-1' })).toEqual(['a', 'b']);
  });

  test('keeps tool permissions and external actions outside low-risk automation', () => {
    expect(classifyProjectDecisionKind({ metadata: { source: 'project:tool-permission' } }))
      .toEqual({ kind: 'tool_permission', riskLevel: 'medium' });
    expect(classifyProjectDecisionKind({ metadata: { source: 'project:external-side-effect' } }))
      .toEqual({ kind: 'external_action', riskLevel: 'high' });
    expect(classifyProjectDecisionKind({
      metadata: { source: 'project:preference' },
      questions: [{
        question: '是否发送邮件？',
        options: [{ label: '发送（推荐）', preview: 'confirmation_token=secret' }],
      }],
    })).toEqual({ kind: 'external_action', riskLevel: 'high' });
  });

  test('expires live decisions at their persisted deadline', () => {
    expect(getProjectDecisionExpirationDelay(1_500, 1_000)).toBe(500);
    expect(getProjectDecisionExpirationDelay(500, 1_000)).toBe(0);
    expect(getProjectDecisionExpirationDelay(null, 1_000)).toBe(24 * 60 * 60 * 1000);
  });

  test('returns only the selected option preview to the running agent', () => {
    expect(buildProjectDecisionRuntimeAnnotations({
      questions: [{
        question: '是否发送？',
        options: [
          { label: '发送', preview: 'recipient=a@example.com\nconfirmation_token=abc' },
          { label: '取消', preview: '不执行' },
        ],
      }],
    }, { '是否发送？': '发送' }, null)).toEqual({
      '是否发送？': {
        preview: 'recipient=a@example.com\nconfirmation_token=abc',
      },
    });
    expect(buildProjectDecisionRuntimeAnnotations({
      questions: [{ question: '说明？', options: [] }],
    }, { '说明？': '自定义回答' }, null)).toBeNull();
  });

  test('redacts secrets from persisted decision previews', () => {
    const decision = normalizeProjectDecision({
      id: 'decision-1',
      projectId: 'project-1',
      requestId: 'request-1',
      questions: [{
        question: '确认操作？',
        header: '确认',
        options: [
          { label: '允许（推荐）', description: 'confirmation_token=secret', preview: 'api_key=secret' },
          { label: '拒绝', description: '取消' },
        ],
      }],
    });
    expect(decision.questions[0].options[0].description).toContain('[REDACTED]');
    expect(decision.questions[0].options[0].preview).toContain('[REDACTED]');
  });
});
