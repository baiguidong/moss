import type { AskUserQuestion, AskUserQuestionAnnotations, AskUserQuestionOption, AskUserQuestionRequest } from "../types";

type AnswerState = Record<string, string[]>;
type NotesState = Record<string, string>;

export function normalizeQuestions(request: AskUserQuestionRequest | null): AskUserQuestion[] {
  const questions = request?.input?.questions;
  if (!Array.isArray(questions)) return [];
  return questions
    .map((question): AskUserQuestion | null => {
      if (!question || typeof question.question !== "string") return null;

      const seenLabels = new Set<string>();
      const normalizedOptions = (Array.isArray(question.options) ? question.options : [])
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

      if (!question.question.trim()) return null;

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

function questionKey(question: AskUserQuestion) {
  return question.question;
}

export function buildFinalAnswers(questions: AskUserQuestion[], answers: AnswerState, notes: NotesState) {
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

export function buildAnnotations(questions: AskUserQuestion[], answers: AnswerState, notes: NotesState) {
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
