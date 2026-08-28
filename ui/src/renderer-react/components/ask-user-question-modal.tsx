"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, HelpCircle, MessageSquareText, ShieldCheck, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { cn } from "@/lib/utils";
import type {
  AskUserQuestion,
  AskUserQuestionAnnotations,
  AskUserQuestionOption,
  AskUserQuestionRequest,
} from "../types";

type AnswerState = Record<string, string[]>;
type NotesState = Record<string, string>;

type Props = {
  request: AskUserQuestionRequest | null;
  activeSessionId: string | null;
  onSwitchToSession: (sessionId: string) => void;
  onSubmit: (
    request: AskUserQuestionRequest,
    answers: Record<string, string>,
    annotations?: AskUserQuestionAnnotations,
  ) => Promise<void>;
  onReject: (request: AskUserQuestionRequest) => Promise<void>;
};

function normalizeQuestions(request: AskUserQuestionRequest | null): AskUserQuestion[] {
  const questions = request?.input?.questions;
  const minimumOptionCount = request?.input?.metadata?.source === "session:tool-permission" ? 1 : 2;
  if (!Array.isArray(questions)) return [];
  return questions
    .map((question): AskUserQuestion | null => {
      if (!question || typeof question.question !== "string") return null;
      if (!Array.isArray(question.options)) return null;

      const seenLabels = new Set<string>();
      const normalizedOptions = question.options
        .filter((option): option is AskUserQuestionOption => (
          Boolean(option && typeof option.label === "string" && option.label.trim())
        ))
        .map((option) => ({
          label: option.label.trim(),
          description: typeof option.description === "string" ? option.description : "",
          ...(typeof option.preview === "string" ? { preview: option.preview } : {}),
        }))
        .filter((option) => {
          if (seenLabels.has(option.label)) return false;
          seenLabels.add(option.label);
          return true;
        })
        .slice(0, 4);

      if (!question.question.trim() || normalizedOptions.length < minimumOptionCount) return null;

      return {
        question: question.question.trim(),
        header: typeof question.header === "string" ? question.header.trim() : "",
        multiSelect: Boolean(question.multiSelect),
        options: normalizedOptions,
      };
    })
    .filter((question): question is AskUserQuestion => Boolean(question))
    .slice(0, 4);
}

function optionKey(option: AskUserQuestionOption) {
  return option.label;
}

function questionKey(question: AskUserQuestion) {
  return question.question;
}

function questionAnswered(question: AskUserQuestion, answers: AnswerState, notes: NotesState) {
  const key = questionKey(question);
  return Boolean((answers[key] || []).length > 0 || notes[key]?.trim());
}

function buildFinalAnswers(questions: AskUserQuestion[], answers: AnswerState, notes: NotesState) {
  const finalAnswers: Record<string, string> = {};
  for (const question of questions) {
    const key = questionKey(question);
    const selected = answers[key] || [];
    const note = notes[key]?.trim();
    if (selected.length > 0) {
      finalAnswers[key] = selected.join(", ");
    } else if (note) {
      finalAnswers[key] = note;
    }
  }
  return finalAnswers;
}

function buildAnnotations(questions: AskUserQuestion[], answers: AnswerState, notes: NotesState) {
  const annotations: AskUserQuestionAnnotations = {};
  for (const question of questions) {
    const key = questionKey(question);
    const note = notes[key]?.trim();
    const selectedLabels = new Set(answers[key] || []);
    const selectedPreview = question.options
      .filter((option) => selectedLabels.has(option.label) && option.preview)
      .map((option) => option.preview)
      .join("\n\n---\n\n");
    if (selectedPreview || note) {
      annotations[key] = {
        ...(selectedPreview ? { preview: selectedPreview } : {}),
        ...(note ? { notes: note } : {}),
      };
    }
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

export function AskUserQuestionModal({
  request,
  activeSessionId,
  onSwitchToSession,
  onSubmit,
  onReject,
}: Props) {
  const questions = React.useMemo(() => normalizeQuestions(request), [request]);
  const isToolPermission = request?.input?.metadata?.source === "session:tool-permission";
  const toolPermissionTitle = typeof request?.input?.metadata?.title === "string"
    ? request.input.metadata.title
    : "工具权限";
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<AnswerState>({});
  const [notes, setNotes] = React.useState<NotesState>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setCurrentIndex(0);
    setAnswers({});
    setNotes({});
    setSubmitting(false);
    setError("");
  }, [request?.requestId]);

  const currentQuestion = questions[currentIndex] || null;
  const isActiveSession = Boolean(request && request.sessionId === activeSessionId);
  const answeredCount = questions.filter((question) => questionAnswered(question, answers, notes)).length;
  const canSubmit = questions.length > 0 && answeredCount > 0;
  const selectedPreview = currentQuestion
    ? currentQuestion.options
        .filter((option) => (answers[questionKey(currentQuestion)] || []).includes(option.label) && option.preview)
        .map((option) => option.preview)
        .join("\n\n---\n\n")
    : "";

  function updateSelection(question: AskUserQuestion, option: AskUserQuestionOption) {
    const key = questionKey(question);
    const label = optionKey(option);
    setAnswers((prev) => {
      const current = prev[key] || [];
      if (question.multiSelect) {
        return {
          ...prev,
          [key]: current.includes(label)
            ? current.filter((item) => item !== label)
            : [...current, label],
        };
      }
      return { ...prev, [key]: [label] };
    });
  }

  const handleSubmit = React.useCallback(async () => {
    if (!request || submitting) return;
    const finalAnswers = buildFinalAnswers(questions, answers, notes);
    if (Object.keys(finalAnswers).length === 0) {
      setError("请至少回答一个问题，或选择暂不回答。");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit(request, finalAnswers, buildAnnotations(questions, answers, notes));
    } catch (err: any) {
      setError(err?.message || String(err));
      setSubmitting(false);
    }
  }, [answers, notes, onSubmit, questions, request, submitting]);

  const handleReject = React.useCallback(async () => {
    if (!request || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onReject(request);
    } catch (err: any) {
      setError(err?.message || String(err));
      setSubmitting(false);
    }
  }, [onReject, request, submitting]);

  React.useEffect(() => {
    if (!request) return;
    if (request.sessionId !== activeSessionId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void handleReject();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSessionId, handleReject, request]);

  if (!request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/62 p-4 backdrop-blur-md">
      <div className={cn(
        "flex max-h-[min(760px,calc(100vh-32px))] w-full flex-col overflow-hidden rounded-lg border border-border/80 bg-card shadow-[0_30px_100px_-45px_rgba(0,0,0,0.72)]",
        isToolPermission ? "max-w-2xl" : "max-w-4xl",
      )}>
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1.5 rounded-md">
                {isToolPermission
                  ? <ShieldCheck className="h-3.5 w-3.5" />
                  : <HelpCircle className="h-3.5 w-3.5" />}
                {isToolPermission ? "工具权限" : "需要你选择"}
              </Badge>
              {!isToolPermission ? (
                <span className="text-xs text-muted-foreground">
                  {answeredCount}/{questions.length} 已回答
                </span>
              ) : null}
              {!isActiveSession ? (
                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                  来自其他会话
                </span>
              ) : null}
            </div>
            <h2 className="mt-2 truncate text-base font-semibold text-foreground">
              {isToolPermission
                ? `${toolPermissionTitle}确认`
                : `${request.originLabel || 'Agent'} 正在等待你的回答`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isToolPermission
                ? "此操作会暂停等待，直到你明确允许或拒绝。"
                : "这些选择会直接回传给 agent，agent 会基于你的答案继续执行当前任务。"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={isActiveSession ? handleReject : () => onSwitchToSession(request.sessionId)}
            disabled={submitting}
            aria-label={isActiveSession ? "关闭问题" : "切换到问题所在会话"}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!isActiveSession ? (
          <div className="border-b border-border/70 bg-muted/35 px-5 py-3 text-sm text-muted-foreground">
            这个问题属于另一个会话。切换过去后再回答，可以避免把选择提交到错误上下文。
          </div>
        ) : null}

        <div className={cn(
          "min-h-0 flex-1",
          isToolPermission ? "block" : "grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]",
        )}>
          {!isToolPermission ? (
          <div className="border-b border-border/70 bg-muted/20 p-3 md:border-b-0 md:border-r">
            <div className="space-y-1">
              {questions.map((question, index) => {
                const answered = questionAnswered(question, answers, notes);
                const active = index === currentIndex;
                return (
                  <button
                    key={`${question.question}-${index}`}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/80"
                        : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-medium",
                        answered
                          ? "border-primary/30 bg-primary text-primary-foreground"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {answered ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{question.header || `问题 ${index + 1}`}</span>
                      <span className="block truncate text-xs opacity-75">{question.question}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          ) : null}

          <div className="min-h-0 overflow-y-auto p-5">
            {currentQuestion ? (
              <div className="mx-auto max-w-2xl">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageSquareText className="h-4 w-4" />
                  {currentQuestion.multiSelect ? "可多选" : "单选"}
                </div>
                <h3 className="mt-3 text-lg font-semibold leading-snug text-foreground">
                  {currentQuestion.question}
                </h3>

                <div className="mt-5 space-y-2">
                  {currentQuestion.options.map((option) => {
                    const key = questionKey(currentQuestion);
                    const selected = (answers[key] || []).includes(option.label);
                    return (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => updateSelection(currentQuestion, option)}
                        disabled={!isActiveSession || submitting}
                        className={cn(
                          "group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60",
                          selected
                            ? "border-primary/70 bg-primary/10 shadow-sm ring-1 ring-primary/30"
                            : "border-border/80 bg-background/60 hover:border-primary/35 hover:bg-background",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border transition-colors",
                            currentQuestion.multiSelect ? "rounded-md" : "rounded-full",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card group-hover:border-primary/50",
                          )}
                        >
                          {selected ? <Check className="h-3.5 w-3.5" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">{option.label}</span>
                          {option.description ? (
                            <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                          {option.preview ? (
                            <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              <Sparkles className="h-3 w-3" />
                              含预览
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {!isToolPermission ? (
                <div className="mt-5">
                  <label className="text-xs font-medium text-muted-foreground">其他说明</label>
                  <Textarea
                    value={notes[questionKey(currentQuestion)] || ""}
                    onChange={(event) =>
                      setNotes((prev) => ({
                        ...prev,
                        [questionKey(currentQuestion)]: event.target.value,
                      }))
                    }
                    placeholder="可选：补充约束、偏好；未选选项时会作为自定义答案"
                    disabled={!isActiveSession || submitting}
                    className="mt-2 min-h-20 resize-none bg-background disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                ) : null}

                {selectedPreview ? (
                  <div className="mt-5 rounded-lg border border-border/80 bg-muted/25 p-4">
                    <div className="mb-3 text-xs font-medium text-muted-foreground">选项预览</div>
                    <MarkdownRenderer
                      content={selectedPreview}
                      variant="document"
                      sourceId={`ask-user-question:${request.requestId}:${currentIndex}`}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                Agent 发来的问题格式不可用。
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border/70 bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-5 text-sm text-muted-foreground">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : isToolPermission ? (
              "请选择允许范围，或拒绝本次操作。"
            ) : (
              "可跳过暂不确定的问题；提交后当前 agent 会自动继续。"
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {!isToolPermission ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
                  disabled={submitting || currentIndex === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一题
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}
                  disabled={submitting || currentIndex >= questions.length - 1}
                >
                  下一题
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            ) : null}
            {isActiveSession ? (
              <>
                <Button variant="outline" onClick={handleReject} disabled={submitting}>
                  {isToolPermission ? "拒绝" : "暂不回答"}
                </Button>
                <Button onClick={handleSubmit} disabled={submitting || !canSubmit}>
                  {submitting ? "提交中..." : isToolPermission ? "确认选择" : "提交答案"}
                </Button>
              </>
            ) : (
              <Button onClick={() => onSwitchToSession(request.sessionId)} disabled={submitting}>
                切换会话
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
