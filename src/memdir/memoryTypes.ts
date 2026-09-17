/**
 * Memory type taxonomy.
 *
 * `project` remains parseable for legacy files, but new global memories are
 * constrained to user / feedback / reference. Project-scoped facts belong in
 * Moss project memory instead of the cross-project global directory.
 *
 * The prompt text is kept flat so edits do not require reasoning through a
 * helper's conditional rendering.
 */

export const MEMORY_TYPES = [
  'user',
  'feedback',
  'project',
  'reference',
] as const

export const GLOBAL_MEMORY_TYPES = [
  'user',
  'feedback',
  'reference',
] as const

export type MemoryType = (typeof MEMORY_TYPES)[number]

/**
 * Parse a raw frontmatter value into a MemoryType.
 * Invalid or missing values return undefined — legacy files without a
 * `type:` field keep working, files with unknown types degrade gracefully.
 */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined
  return MEMORY_TYPES.find(t => t === raw)
}

/**
 * `## Types of memory` section for the local auto-memory directory.
 */
export const TYPES_SECTION_INDIVIDUAL: readonly string[] = [
  '## Types of memory',
  '',
  'Global memory supports only these cross-project memory types:',
  '',
  '<types>',
  '<type>',
  '    <name>user</name>',
  "    <description>Contain information about the user's role, goals, responsibilities, and knowledge. Great user memories help you tailor your future behavior to the user's preferences and perspective. Your goal in reading and writing these memories is to build up an understanding of who the user is and how you can be most helpful to them specifically. For example, you should collaborate with a senior software engineer differently than a student who is coding for the very first time. Keep in mind, that the aim here is to be helpful to the user. Avoid writing memories about the user that could be viewed as a negative judgement or that are not relevant to the work you're trying to accomplish together.</description>",
  "    <when_to_save>When you learn any details about the user's role, preferences, responsibilities, or knowledge</when_to_save>",
  "    <how_to_use>When your work should be informed by the user's profile or perspective. For example, if the user is asking you to explain a part of the code, you should answer that question in a way that is tailored to the specific details that they will find most valuable or that helps them build their mental model in relation to domain knowledge they already have.</how_to_use>",
  '    <examples>',
  "    user: I'm a data scientist investigating what logging we have in place",
  '    assistant: [saves user memory: user is a data scientist, currently focused on observability/logging]',
  '',
  "    user: I've been writing Go for ten years but this is my first time touching the React side of this repo",
  "    assistant: [saves user memory: deep Go expertise, new to React and this project's frontend — frame frontend explanations in terms of backend analogues]",
  '    </examples>',
  '</type>',
  '<type>',
  '    <name>feedback</name>',
  '    <description>Guidance the user has given you about how to approach work — both what to avoid and what to keep doing. These are a very important type of memory to read and write as they allow you to remain coherent and responsive to the way you should approach work in the project. Record from failure AND success: if you only save corrections, you will avoid past mistakes but drift away from approaches the user has already validated, and may grow overly cautious.</description>',
  '    <when_to_save>Any time the user corrects your approach ("no not that", "don\'t", "stop doing X") OR confirms a non-obvious approach worked ("yes exactly", "perfect, keep doing that", accepting an unusual choice without pushback). Corrections are easy to notice; confirmations are quieter — watch for them. In both cases, save what is applicable to future conversations, especially if surprising or not obvious from the code. Include *why* so you can judge edge cases later.</when_to_save>',
  '    <how_to_use>Let these memories guide your behavior so that the user does not need to offer the same guidance twice.</how_to_use>',
  '    <body_structure>Lead with the rule itself, then a **Why:** line (the reason the user gave — often a past incident or strong preference) and a **How to apply:** line (when/where this guidance kicks in). Knowing *why* lets you judge edge cases instead of blindly following the rule.</body_structure>',
  '    <examples>',
  "    user: don't mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed",
  '    assistant: [saves feedback memory: integration tests must hit a real database, not mocks. Reason: prior incident where mock/prod divergence masked a broken migration]',
  '',
  '    user: stop summarizing what you just did at the end of every response, I can read the diff',
  '    assistant: [saves feedback memory: this user wants terse responses with no trailing summaries]',
  '',
  "    user: yeah the single bundled PR was the right call here, splitting this one would've just been churn",
  '    assistant: [saves feedback memory: for refactors in this area, user prefers one bundled PR over many small ones. Confirmed after I chose this approach — a validated judgment call, not a correction]',
  '    </examples>',
  '</type>',
  '<type>',
  '    <name>reference</name>',
  '    <description>Stores pointers to where information can be found in external systems. These memories allow you to remember where to look to find up-to-date information outside of the project directory.</description>',
  '    <when_to_save>When you learn about resources in external systems and their purpose. For example, that bugs are tracked in a specific project in Linear or that feedback can be found in a specific Slack channel.</when_to_save>',
  '    <how_to_use>When the user references an external system or information that may be in an external system.</how_to_use>',
  '    <examples>',
  '    user: check the Linear project "INGEST" if you want context on these tickets, that\'s where we track all pipeline bugs',
  '    assistant: [saves reference memory: pipeline bugs are tracked in Linear project "INGEST"]',
  '',
  "    user: the Grafana board at grafana.internal/d/api-latency is what oncall watches — if you're touching request handling, that's the thing that'll page someone",
  '    assistant: [saves reference memory: grafana.internal/d/api-latency is the oncall latency dashboard — check it when editing request-path code]',
  '    </examples>',
  '</type>',
  '</types>',
  '',
]

export const GLOBAL_MEMORY_ADMISSION_SECTION: readonly string[] = [
  '## Global-memory admission gate',
  '',
  'Save a global memory only when every condition below is true:',
  '',
  '- It will remain useful in future conversations across unrelated projects, not only in the current repository, task, incident, or setup attempt.',
  '- It is expected to stay valid for weeks or months, or the user explicitly stated a durable personal preference.',
  '- It cannot be recovered reliably from source code, git history, project instructions, documentation, or the current state of an external system.',
  '- It changes how you should collaborate with this user or points to a stable external resource they repeatedly use.',
  '',
  'Project-specific decisions, status, failures, deadlines, paths, implementation details, and work history belong in Moss Project Memory, never global memory. Do not create new global memories with `type: project`. When uncertain, do not save anything.',
]

/**
 * `## What NOT to save in memory` section. Identical across both modes.
 */
export const WHAT_NOT_TO_SAVE_SECTION: readonly string[] = [
  '## What NOT to save in memory',
  '',
  '- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.',
  '- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.',
  '- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.',
  '- Anything already documented in project instruction files.',
  '- Ephemeral task details: in-progress work, temporary state, current conversation context.',
  '',
  // H2: explicit-save gate. Eval-validated (memory-prompt-iteration case 3,
  // 0/2 → 3/3): prevents "save this week's PR list" → activity-log noise.
  'These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.',
]

/**
 * Recall-side drift caveat. Single bullet under `## When to access memories`.
 * Proactive: verify memory against current state before answering.
 */
export const MEMORY_DRIFT_CAVEAT =
  '- Memory records can become stale over time. Use memory as context for what was true at a given point in time. Before answering the user or building assumptions based solely on information in memory records, verify that the memory is still correct and up-to-date by reading the current state of the files or resources. If a recalled memory conflicts with current information, trust what you observe now — and update or remove the stale memory rather than acting on it.'

/**
 * `## When to access memories` section. Includes MEMORY_DRIFT_CAVEAT.
 *
 * H6 (branch-pollution evals #22856, case 5 1/3 on capy): the "ignore" bullet
 * is the delta. Failure mode: user says "ignore memory about X" → Claude reads
 * code correctly but adds "not Y as noted in memory" — treats "ignore" as
 * "acknowledge then override" rather than "don't reference at all." The bullet
 * names that anti-pattern explicitly.
 *
 * Token budget (H6a): merged old bullets 1+2, tightened both. Old 4 lines
 * were ~70 tokens; new 4 lines are ~73 tokens. Net ~+3.
 */
export const WHEN_TO_ACCESS_SECTION: readonly string[] = [
  '## When to access memories',
  '- When memories seem relevant, or the user references prior-conversation work.',
  '- You MUST access memory when the user explicitly asks you to check, recall, or remember.',
  '- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty. Do not apply remembered facts, cite, compare against, or mention memory content.',
  MEMORY_DRIFT_CAVEAT,
]

/**
 * `## Trusting what you recall` section. Heavier-weight guidance on HOW to
 * treat a memory once you've recalled it — separate from WHEN to access.
 *
 * Eval-validated (memory-prompt-iteration.eval.ts, 2026-03-17):
 *   H1 (verify function/file claims): 0/2 → 3/3 via appendSystemPrompt. When
 *      buried as a bullet under "When to access", dropped to 0/3 — position
 *      matters. The H1 cue is about what to DO with a memory, not when to
 *      look, so it needs its own section-level trigger context.
 *   H5 (read-side noise rejection): 0/2 → 3/3 via appendSystemPrompt, 2/3
 *      in-place as a bullet. Partial because "snapshot" is intuitively closer
 *      to "when to access" than H1 is.
 *
 * Known gap: H1 doesn't cover slash-command claims (0/3 on the /fork case —
 * slash commands aren't files or functions in the model's ontology).
 */
export const TRUSTING_RECALL_SECTION: readonly string[] = [
  // Header wording matters: "Before recommending" (action cue at the decision
  // point) tested better than "Trusting what you recall" (abstract). The
  // appendSystemPrompt variant with this header went 3/3; the abstract header
  // went 0/3 in-place. Same body text — only the header differed.
  '## Before recommending from memory',
  '',
  'A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. It may have been renamed, removed, or never merged. Before recommending it:',
  '',
  '- If the memory names a file path: check the file exists.',
  '- If the memory names a function or flag: grep for it.',
  '- If the user is about to act on your recommendation (not just asking about history), verify first.',
  '',
  '"The memory says X exists" is not the same as "X exists now."',
  '',
  'A memory that summarizes repo state (activity logs, architecture snapshots) is frozen in time. If the user asks about *recent* or *current* state, prefer `git log` or reading the code over recalling the snapshot.',
]

/**
 * Frontmatter format example with the `type` field.
 */
export const MEMORY_FRONTMATTER_EXAMPLE: readonly string[] = [
  '```markdown',
  '---',
  'name: {{memory name}}',
  'description: {{one-line description — used to decide relevance in future conversations, so be specific}}',
  `type: {{${GLOBAL_MEMORY_TYPES.join(', ')}}}`,
  '---',
  '',
  '{{memory content — for feedback memories, structure as: rule, then **Why:** and **How to apply:** lines}}',
  '```',
]
