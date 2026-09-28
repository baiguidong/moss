"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, HelpCircle, MessageSquareText, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { buildAnnotations, buildFinalAnswers, normalizeQuestions } from "@/lib/ask-user-question";
import { cn } from "@/lib/utils";
import type { AskUserQuestionAnnotations, AskUserQuestionRequest } from "../../types";

export type AskUserQuestionCardProps = {
  request: AskUserQuestionRequest;
  onSubmit: (request: AskUserQuestionRequest, answers: Record<string, string>, annotations?: AskUserQuestionAnnotations) => Promise<void>;
  onDiscuss: (request: AskUserQuestionRequest, message: string) => Promise<void>;
};

// Keyed by requestId at the call site, so a new request starts with a clean form.
export function AskUserQuestionCard({ request, onSubmit, onDiscuss }: AskUserQuestionCardProps) {
  const questions = React.useMemo(() => normalizeQuestions(request), [request]);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [selections, setSelections] = React.useState<Record<string, string[]>>({});
  const [freeTexts, setFreeTexts] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState("");
  const id = React.useId();
  const question = questions[activeIndex];
  const answers = buildFinalAnswers(questions, selections, freeTexts);
  const allAnswered = questions.length > 0 && questions.every((q) => Boolean(answers[q.question]));
  const preview = question?.options.filter((option) => selections[question.question]?.includes(option.label) && option.preview)
    .map((option) => option.preview).join("\n\n---\n\n");

  async function respond(discuss: boolean) {
    if (busyRef.current || (!discuss && !allAnswered)) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (discuss) {
        await onDiscuss(request, buildQuestionDiscussionMessage(questions, answers));
      } else {
        await onSubmit(request, answers, buildAnnotations(questions, selections, freeTexts));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="my-2 w-full overflow-hidden rounded-xl border border-primary/35 bg-card">
      <header className="flex items-center gap-2 bg-muted/35 px-3 py-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><HelpCircle className="h-4 w-4" /></span>
        <h2 id={`${id}-title`} className="text-sm font-semibold">Moss 需要你的输入</h2>
      </header>
      {questions.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-border/70 px-3 py-1.5" aria-label="问题列表">
          {questions.map((q, index) => (
            <Button key={`${q.question}-${index}`} size="sm" className="h-7 text-xs" variant={index === activeIndex ? "secondary" : "ghost"}
              disabled={busy} aria-current={index === activeIndex ? "step" : undefined} onClick={() => setActiveIndex(index)}>
              {answers[q.question] ? <Check className="h-3.5 w-3.5" /> : `${index + 1}.`} {q.header || `问题 ${index + 1}`}
            </Button>
          ))}
        </div>
      )}
      <div className="space-y-2 px-3 py-2.5">
        {question ? (
          <>
            <fieldset disabled={busy} className="min-w-0">
              <legend className="mb-2 text-sm font-semibold leading-5">{question.question}{question.multiSelect && <span className="ml-2 text-xs font-normal text-muted-foreground">可多选</span>}</legend>
              <div className="space-y-1.5">
              {question.options.map((option, index) => {
                const selected = selections[question.question]?.includes(option.label) || false;
                return (
                  <label key={option.label} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors focus-within:ring-2 focus-within:ring-ring", selected ? "border-primary/60 bg-primary/5" : "border-border bg-background hover:bg-muted/30", busy && "cursor-default opacity-60")}>
                    <input type={question.multiSelect ? "checkbox" : "radio"} name={`${id}-${activeIndex}`} checked={selected}
                      aria-labelledby={`${id}-option-${activeIndex}-${index}`} aria-describedby={option.description ? `${id}-description-${activeIndex}-${index}` : undefined}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      onChange={() => {
                        setSelections((prev) => ({ ...prev, [question.question]: question.multiSelect
                          ? selected ? (prev[question.question] || []).filter((label) => label !== option.label) : [...(prev[question.question] || []), option.label]
                          : [option.label] }));
                        setFreeTexts((prev) => ({ ...prev, [question.question]: "" }));
                        if (!question.multiSelect && activeIndex < questions.length - 1) setActiveIndex(activeIndex + 1);
                      }} />
                    <span className="min-w-0">
                      <span id={`${id}-option-${activeIndex}-${index}`} className="block text-[13px] font-medium leading-5">{option.label}</span>
                      {option.description && <span id={`${id}-description-${activeIndex}-${index}`} className="mt-0.5 block text-xs leading-4 text-muted-foreground">{option.description}</span>}
                    </span>
                  </label>
                );
              })}
              </div>
            </fieldset>
            <div>
              <label htmlFor={`${id}-answer`} className="sr-only">或输入自定义回复：</label>
              <Textarea id={`${id}-answer`} rows={1} value={freeTexts[question.question] || ""} disabled={busy} placeholder="或输入自定义回复…"
                className="min-h-9 max-h-32 resize-y rounded-lg bg-background py-2 text-sm leading-5 shadow-none"
                onChange={(event) => {
                  const value = event.target.value;
                  setFreeTexts((prev) => ({ ...prev, [question.question]: value }));
                  if (value.trim()) setSelections((prev) => ({ ...prev, [question.question]: [] }));
                }} />
            </div>
            {preview && <div className="rounded-lg border border-border bg-muted/25 p-2"><MarkdownRenderer content={preview} variant="compact" /></div>}
          </>
        ) : <p role="alert" className="text-sm text-destructive">问题格式不可用，可以和 Moss 聊聊。</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/35 px-3 py-2">
        <Button size="sm" className="h-7 rounded-lg text-xs" disabled={busy || !allAnswered} onClick={() => void respond(false)}><Send className="h-4 w-4" />{busy ? "提交中…" : "提交"}</Button>
        <Button size="sm" variant="outline" className="h-7 rounded-lg text-xs" disabled={busy} onClick={() => void respond(true)}><MessageSquareText className="h-4 w-4" />和 Moss 聊聊</Button>
        {questions.length > 1 && <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="上一题" disabled={busy || activeIndex === 0} onClick={() => setActiveIndex(activeIndex - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground">{activeIndex + 1} / {questions.length}</span>
          <Button variant="ghost" size="icon-sm" aria-label="下一题" disabled={busy || !answers[question?.question] || activeIndex === questions.length - 1} onClick={() => setActiveIndex(activeIndex + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>}
      </footer>
    </section>
  );
}

export function buildQuestionDiscussionMessage(questions: ReturnType<typeof normalizeQuestions>, answers: Record<string, string>) {
  return `用户希望先讨论这些问题，请继续对话，询问用户想澄清什么，不要把当前选择视为最终确认。\n${questions.map((question) => `- ${question.question}\n  ${answers[question.question] ? `尚未确认的回答：${answers[question.question]}` : '尚未回答'}`).join("\n")}`;
}
