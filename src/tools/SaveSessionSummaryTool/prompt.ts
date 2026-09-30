// Keep the retention priorities aligned with getCompactPrompt in
// services/compact/prompt.ts. Do not copy its analysis/output wrapper: this
// tool accepts finished notes, not a separate summarization model request.
export const SAVE_SESSION_SUMMARY_PROMPT = `Save optional session notes when substantial progress or decisions are worth recording. Skip greetings, routine tool activity, and unchanged notes.
Preserve what would be needed to continue after context compaction:
- User requests, constraints, and corrections; follow the latest intent.
- Key technical decisions and reasons; essential files, symbols, edits, and verified results.
- Errors, fixes, failed approaches, and unresolved questions.
- Completed versus pending tasks; current work and the next authorized step.
Keep exact wording or code only where needed to avoid ambiguity. Use the conversation's language. Base notes on available conversation evidence; mark uncertainty and missing context, never invent full coverage.
The text replaces the previous summary. Saving does not compact the conversation; compaction independently summarizes conversation history without reading these notes.`
