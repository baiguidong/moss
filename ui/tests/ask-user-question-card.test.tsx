import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskUserQuestionCard, buildQuestionDiscussionMessage } from "../src/renderer-react/components/chat/ask-user-question-card";
import { buildAnnotations, buildFinalAnswers, normalizeQuestions } from "../src/renderer-react/lib/ask-user-question";
import type { AskUserQuestionRequest } from "../src/renderer-react/types";

const request: AskUserQuestionRequest = {
  requestId: 'q1', sessionId: 's1', requestedAt: 1,
  input: { questions: [{ question: '你接下来最想先学习哪一块？', header: '学习方向', options: [
    { label: 'Markdown', description: '学习标题、列表、表格、代码块等基础写法。', preview: '# 示例' },
    { label: '运行项目', description: '学习怎么看项目结构、安装依赖、启动项目。' },
  ] }] },
};

test("questions render inside the conversation without a modal or dialog overlay", () => {
  const html = renderToStaticMarkup(<AskUserQuestionCard request={request} onSubmit={async () => {}} onDiscuss={async () => {}} />);
  expect(html).toContain('Moss 需要你的输入');
  expect(html).toContain('你接下来最想先学习哪一块？');
  expect(html).toContain('type="radio"');
  expect(html).toContain('或输入自定义回复');
  expect(html).toContain('和 Moss 聊聊');
  expect(html).not.toContain('fixed inset-0');
  expect(html).not.toContain('role="dialog"');
  expect(html).not.toContain('checked=""');
});

test("answers preserve per-question values, multi-select, previews, and free text", () => {
  const questions = normalizeQuestions(request);
  const key = questions[0].question;
  expect(buildFinalAnswers(questions, { [key]: ['Markdown', '运行项目'] }, {})).toEqual({ [key]: 'Markdown, 运行项目' });
  expect(buildFinalAnswers(questions, {}, { [key]: '  我想先了解 Git  ' })).toEqual({ [key]: '我想先了解 Git' });
  expect(buildAnnotations(questions, { [key]: ['Markdown'] }, {})).toEqual({ [key]: { preview: '# 示例' } });
});

test("free-text-only questions and duplicate option labels are normalized", () => {
  const questions = normalizeQuestions({ ...request, input: { questions: [{ question: '请说明需求', header: '', options: [] }, { ...request.input.questions![0], options: [{ label: ' A ' }, { label: 'A' }] }] } });
  expect(questions).toHaveLength(2);
  expect(questions[1].options).toEqual([{ label: 'A', description: '' }]);
});

test("discussion sends partial answers as unconfirmed context rather than approval", () => {
  const questions = normalizeQuestions(request);
  const message = buildQuestionDiscussionMessage(questions, { [questions[0].question]: 'Markdown' });
  expect(message).toContain('请继续对话');
  expect(message).toContain('不要把当前选择视为最终确认');
  expect(message).toContain('尚未确认的回答：Markdown');
});
