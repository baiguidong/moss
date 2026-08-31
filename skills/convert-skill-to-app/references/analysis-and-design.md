# Analysis and App Implementation Brief

## Contents

1. Analysis boundary
2. Capability extraction
3. Product brief
4. Input and output modeling
5. AI-assisted behavior
6. Coverage report

## Analysis Boundary

Treat the target Skill as a specification assembled from `SKILL.md`, directly referenced resources, deterministic scripts, and assets. Preserve its user outcomes and domain rules without copying conversational instructions blindly into generated code.

Build a source map. For every generated capability, record the originating file and a short evidence note. Record `sourceReview.reviewedFiles` and the dependency-closure files that affect implemented behavior. Mark statements that are ambiguous, contradictory, platform-specific, or dependent on unavailable services.

Never run a target script merely to discover what it does. Prefer static source inspection, `package.json`, parser definitions, function signatures, schemas, documented examples, and the inspector's local dependency graph. A `--help` invocation is execution and must wait until the implementation/test phase when it is known to be read-only.

For every source module selected as an implementation entry, read its full `localDependencyClosure`. Reliability and correctness often live below the public wrapper: connection pools, retries, validation, cleanup, pagination, caching, and error normalization are part of the behavior to preserve. Do not infer equivalence from matching function names.

## Capability Extraction

Extract user outcomes rather than command lines. Merge commands that form one workflow and split commands that represent materially different user intents.

For each capability, determine:

- Stable identifier and user-facing title.
- User goal and success condition.
- Inputs, defaults, validation, examples, and sensitive fields.
- Preconditions and environment checks.
- Read/write/network/install/destructive effects.
- Expected duration and whether progress is observable.
- Output shapes, files, warnings, partial success, and recovery actions.
- Dependencies on earlier actions or shared state.
- External-service availability, retry/fallback behavior, and the minimum meaningful success result.
- Source evidence and confidence.

Classify implementation:

- `visual`: deterministic UI and a typed App Backend action.
- `ai-assisted`: dedicated interaction plus model reasoning provided by the App Backend.
- `manual`: safe automation is unavailable in current App constraints.
- `excluded`: outside requested scope or unsuitable, with an explicit reason.

## Product Brief

Recommend one coherent product model for the target domain so the App Builder can implement it. Record the recommendation in the report; do not create UI or App source files from this toolkit. Flag these generator artifacts for the App Builder to avoid:

- A grid of unrelated cards for every command.
- A permanent raw JSON panel as the primary result.
- A generic sidebar containing command names copied from a CLI.
- Large explanatory hero text instead of the actual work surface.
- Nested cards or decorative sections that do not support a task.

Recommend the smallest navigation model that supports the workflows. A single focused workspace is better than several shallow pages. Recommend tabs for peer views, a stepper for ordered setup, a split view for list/detail work, and an inspector only when the domain needs persistent context.

Specify the main task, current state, and primary action that the first viewport must expose. Supply domain language from the Skill and suggested user-facing labels instead of internal implementation terms.

List the required states for the App Builder: first use, no data, loading, long-running work, partial completion, validation errors, Backend stopped, dependency missing, permission denied, operation failure, and success.

## Input and Output Modeling

Use appropriate controls:

- Text/name/query: text or search input.
- Known finite choices: select, menu, radio group, or segmented control.
- Boolean behavior: checkbox or toggle.
- Numeric limits: numeric input, stepper, or slider when a bounded range is meaningful.
- Repeated strings: editable list or tag input.
- Files and directories: use only paths obtained through a supported flow; do not fake a native picker when Moss does not expose one.
- Destructive confirmation: explicit confirmation UI naming the affected object.

Specify result-rendering requirements from actual outputs: tables for repeated records, metrics for counts, progress for stages, logs for execution detail, file links for artifacts, diffs for changes, and focused summaries for completion. Tell the App Builder to retain raw output only as a secondary diagnostic view.

Normalize Backend responses per action. A practical base shape is:

```json
{
  "ok": true,
  "data": {},
  "summary": "Completed",
  "warnings": [],
  "artifacts": [],
  "diagnostics": {}
}
```

Actions may extend this shape, but their UI must not depend on parsing human prose.

## AI-Assisted Behavior

Classify a capability as AI-assisted only when it inherently requires interpretation, generation, summarization, classification, or conversational recovery.

Describe a purpose-specific assistant surface for the App Builder. Define the minimal context contract: relevant current form values, selected records, previous result, and errors. Require a schema for model responses and validate it in the Backend before returning it to the UI.

Never allow model output to become a command string. Convert accepted model suggestions into the same typed App actions available to ordinary controls. Require the user to confirm write, install, network-submit, and destructive actions.

When no provider or credentials contract is available, record the workflow as a conversion gap. Do not silently call a guessed endpoint or access a hidden Moss API.

## Coverage Report

Write `generated/skill-app-analysis.json` before App implementation. Treat initial generated targets as a planned mapping, then reconcile the report after the App Builder and this toolkit have produced their respective files. Keep it as an auditable map between the Skill and the self-contained App.

The report must include:

- Target Skill identity and source fingerprint.
- Product concept and recommended information architecture for App Builder.
- Every discovered capability and its disposition.
- Declared App Backend action names.
- Required environment and dependencies.
- Security and portability notes.
- Reviewed source files and relevant unresolved imports.
- A resource mapping that says whether each source is reused directly, bundled, adapted, or reimplemented.
- `implementationSources` on each implemented capability, referencing entries in that resource mapping.
- Equivalence-test IDs for every reimplemented behavior.
- Coverage totals and unresolved gaps.

Reconcile the report during pair validation. A capability counts as implemented only when the App Builder's UI, this toolkit's action, result rendering, error handling, and executable representative tests all exist. Test names in the report are references to test-plan case IDs, not evidence that tests ran.
