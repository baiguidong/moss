# Project Data Layout

The desktop project module only reads and writes the layout defined here. It
does not fall back to `~/.moss/app-projects` or legacy project files.

## Project Directory

```text
~/.moss/projects/<project-id>/
  project.json
  workspace/
  assets.json
  events.json
  decisions.json
  memory/
    index.json
    overview.md
    sessions/
      <session-id>.md
      <session-id>.json
  sessions/
    <session-id>.json
  runtime/
    runs/
      <internal-run-id>/
```

- `project.json` is the canonical project configuration and carries
  `kind: "moss-project"` plus the current `layoutVersion`.
- `workspace/` is the only durable project file and asset directory.
- `assets.json` indexes files in `workspace/` and records provenance. It does
  not own file contents.
- Project tasks are the root project Coordinator sessions stored in `moss.db`.
  The task ID is the root session ID; Worker/SubAgent sessions reference it with
  `parent_session_id`. There is no separate goal, plan, DAG, scheduler, or task
  index under the project directory.
- `events.json` records project activity and `decisions.json` records durable
  Ask/confirmation decisions associated with root task sessions.
- `memory/overview.md` is the shared project memory supplied to later project
  sessions. `memory/sessions/` records each completed session finalization.
- `sessions/` contains project-to-session references only. Session metadata and
  history remain owned by the session store and `moss.db`.
- `runtime/runs/` contains internal Memory Finalizer runs. It is pruned to 50
  runs and 30 days.

## Session Directory

```text
~/.moss/sessions/<session-id>/
  session.json
  workspace/
    inputs/
    working/
    outputs/
    .moss/
      project-assets/
  runtime/
    resource-manifest.json
    engine/
      <engine-session-id>.jsonl
      <engine-session-id>/
        session-memory/
          summary.md
        subagents/
        tool-results/
        shell-snapshots/
```

- Every main session and subagent session owns one top-level session directory.
- `session.json` carries `kind: "moss-session"` and the current
  `layoutVersion`.
- `workspace/inputs/` contains localized source material,
  `workspace/working/` contains intermediate work, and `workspace/outputs/`
  contains final publish candidates.
- `.moss/project-assets/` is a read-only-style session snapshot of project
  assets. It is not durable project storage.
- `runtime/resource-manifest.json` is the resource snapshot used by that
  session. It is never a project-level source of truth.
- `runtime/engine/` owns the raw transcript and engine runtime state.
- A subagent raw transcript is materialized into its own session directory;
  `moss.db.parent_session_id` is the canonical parent relationship.

## Commit Flow

```text
session workspace output -> project workspace -> assets.json
session transcript -> Memory Finalizer -> memory/sessions -> memory/overview.md
root Coordinator session -> project task projection
Worker/SubAgent session -> root session through parent_session_id
```

Only Memory Finalizer results enter shared project memory. Engine
`session-memory/summary.md` remains session-local runtime context.
