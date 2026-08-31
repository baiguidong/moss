# Moss Desktop Data Layout Plan

> The project/session portion of this document has been superseded by
> `project-data-layout.md`. That module uses the new layout directly and does
> not provide a legacy `app-projects` fallback.

## Purpose

Moss Desktop should have a stable local data layout before more project,
assistant, skill, app, connector, and automation features are added. The current
layout works, but many desktop modules construct `~/.moss` paths independently.
That makes later migrations harder and blurs which files are durable user data,
which files are caches, and which files are runtime artifacts.

The most valuable small step is to define a desktop data contract and route new
code through it. Existing paths can remain compatible while future features use
clear ownership boundaries.

## Design Goals

1. Keep user data durable and inspectable.
2. Separate durable state from cache, runtime, logs, and build output.
3. Make every top-level directory have one owner and one cleanup policy.
4. Support gradual migration from the existing `~/.moss` layout.
5. Keep Markdown for human-readable identity, instructions, and memory.
6. Keep SQLite for query-heavy state and migrations.
7. Keep marketplace/plugin packages manifest-driven and versioned.

## Proposed Logical Layout

```text
~/.moss/
  profile/
    IDENTITY.md
    USER.md
    MEMORY.md

  state/
    moss.db
    migrations/
    settings.json
    app-registry.json
    cron-tasks.json
    cron-bindings.json

  projects/
    <project-id>/
      project.json
      instructions.md
      tasks/
      assets/
      sessions/
      team-runs/
      deliverables/

  sessions/
    <session-id>/
      session.json
      transcript.jsonl
      workspace/
      artifacts/
      attempts/

  artifacts/
    index/
    files/

  apps/
    installed/
    builds/
    data/
    bundled-workspace/

  assistants/
    system/
    hub/
    custom/

  skills/
    system/
    hub/
    custom/

  plugins/
    marketplaces/
    cache/
    installed-plugins.json
    known-marketplaces.json

  connectors/
    accounts/
    credentials/
    marketplace/

  runtime/
    binaries/
    sockets/
    tmp/
    managed-runtimes.json

  observability/
    logs/
    traces/
    audit-log/
    shell-snapshots/

  cache/
    media/
    previews/
    downloads/
```

This is a logical target. It should not be applied as a one-shot filesystem
migration.

## Ownership And Cleanup Policy

| Area | Owner | Durability | Cleanup Policy |
| --- | --- | --- | --- |
| `profile/` | user/profile layer | durable | never automatic |
| `state/` | desktop core | durable | backup before schema migration |
| `projects/` | project system | durable | archive/delete only by user action |
| `sessions/` | session runtime | semi-durable | retention setting, preserve pinned/project sessions |
| `artifacts/` | artifact service | durable if referenced | prune only unreferenced expired files |
| `apps/installed/` | app platform | durable | explicit uninstall only |
| `apps/builds/` | app builder | rebuildable | prune old builds by version policy |
| `apps/data/` | app platform | durable | app-scoped delete/export |
| `assistants/` | assistant store | durable | uninstall only, preserve custom |
| `skills/` | skill store | durable | uninstall only, preserve custom |
| `plugins/marketplaces/` | plugin marketplace | rebuildable source cache | refresh/prune by marketplace version |
| `connectors/credentials/` | connector credential store | secret | move to keychain when possible |
| `runtime/` | runtime manager | rebuildable/volatile | keep current and previous versions |
| `observability/logs/` | diagnostics | non-durable | rotate by size and TTL |
| `observability/traces/` | diagnostics | non-durable | TTL cleanup |
| `cache/` | feature cache | rebuildable | safe TTL cleanup |

## Compatibility Mapping

Current desktop paths can map into the logical layout without moving data first:

| Current Path | Logical Slot |
| --- | --- |
| `~/.moss/settings.json` | `state/settings.json` |
| `~/.moss/moss.db` | `state/moss.db` |
| `~/.moss/projects/` | Shared root; desktop app projects are identified by their record kind |
| `~/.moss/app-projects/` | Retired; the desktop project module does not read this path |
| `~/.moss/workspace/` | `runtime/tmp/workspaces/` or `sessions/*/workspace/` |
| `~/.moss/generated-app-data/` | `apps/data/` |
| `~/.moss/generated-apps/` | `apps/builds/` |
| `~/.moss/bundled-apps-workspace/` | `apps/bundled-workspace/` |
| `~/.moss/apps/` | `apps/installed/` |
| `~/.moss/skills/` | `skills/custom/` plus legacy skill root |
| `~/.moss/assistants/` | `assistants/custom/` plus legacy assistant root |
| `~/.moss/logs/` | `observability/logs/` |
| `~/.moss/shell-snapshots/` | `observability/shell-snapshots/` |
| `~/.moss/runtimes/` | `runtime/binaries/` |

## Smallest High-Value Implementation Step

Add a single desktop path contract module, for example:

```text
ui/src/desktop-paths.mjs
```

It should export semantic paths instead of raw directory constants:

```js
desktopPaths.home
desktopPaths.state.settingsFile
desktopPaths.state.databaseFile
desktopPaths.projects.root
desktopPaths.sessions.root
desktopPaths.apps.installed
desktopPaths.apps.builds
desktopPaths.apps.data
desktopPaths.skills.root
desktopPaths.assistants.root
desktopPaths.runtime.tmp
desktopPaths.runtime.binaries
desktopPaths.observability.logs
desktopPaths.observability.traces
```

The first version should return legacy-compatible paths. It does not need to
move files. New desktop code should import this module instead of constructing
`path.join(os.homedir(), '.moss', ...)` directly.

## Migration Strategy

1. Introduce `desktop-paths.mjs` with legacy-compatible values.
2. Refactor only new or actively touched modules to use semantic paths.
3. Add a `layoutVersion` record under `state/` once actual migration begins.
4. Migrate one area at a time, starting with rebuildable data:
   - logs/traces/cache
   - app builds
   - runtime tmp
5. Migrate durable data only with backup and rollback:
   - settings
   - database
   - project records
   - app data
6. Keep old paths readable for at least one release cycle.

## Early Migration Candidates

Directory migration should start with rebuildable or diagnostic data. Durable
user content should move later, after path compatibility and backup behavior
are already proven.

### Wave 0: No File Moves

Add `ui/src/desktop-paths.mjs` and route new code through it. This is the
highest-value first change because it stops path sprawl without touching user
data.

Recommended legacy-compatible mappings:

```js
desktopPaths.home                // ~/.moss
desktopPaths.state.settingsFile  // ~/.moss/settings.json
desktopPaths.state.databaseFile  // ~/.moss/moss.db
desktopPaths.observability.logs  // ~/.moss/logs
desktopPaths.runtime.binaries    // ~/.moss/runtimes
desktopPaths.runtime.workspaces  // ~/.moss/workspace
```

### Wave 1: Low-Risk Rebuildable Or Diagnostic Data

Move these first, with read fallback from old paths:

| Current Path | Target Path | Why First |
| --- | --- | --- |
| `~/.moss/logs/` | `~/.moss/observability/logs/` | Diagnostic only, already size/TTL managed, low product risk. |
| `~/.moss/shell-snapshots/` | `~/.moss/observability/shell-snapshots/` | Runtime diagnostic snapshots, not primary user data. |
| `~/.moss/runtimes/` | `~/.moss/runtime/binaries/` | Managed and reinstallable. Keep current and previous versions only. |
| `~/.moss/generated-apps/` | `~/.moss/apps/builds/` | Build output, can be regenerated from app source/version records. |
| `~/.moss/app-build/` | `~/.moss/apps/builds/tmp/` | Temporary build output, safe to prune aggressively. |
| `~/.moss/bundled-apps-workspace/` | `~/.moss/apps/bundled-workspace/` | Seed/bundled workspace, not user-authored durable data. |

### Wave 2: High-Value But Needs Compatibility

Move these only after `desktop-paths.mjs` is used in the touched modules and
the app can read both old and new paths:

| Current Path | Target Path | Caution |
| --- | --- | --- |
| `~/.moss/workspace/` | `~/.moss/runtime/tmp/workspaces/` or `~/.moss/sessions/<id>/workspace/` | Large and mostly temporary, but may contain user-generated files. New sessions can use the target path first; old workspaces should stay readable. |
| `~/.moss/generated-app-data/` | `~/.moss/apps/data/` | App data may be user-owned. Move per app with backup. |
| `~/.moss/app-projects/` | Retired | New desktop projects are written directly to `~/.moss/projects/<project-id>/`; no fallback is provided. |
| `~/.moss/tasks/` | Retired for projects | Project tasks are root Coordinator sessions in `moss.db`; session-local runtime tasks stay inside the session runtime. |

### Wave 3: Durable Stores, Move Last

These should not be first migration targets:

| Current Path | Reason To Delay |
| --- | --- |
| `~/.moss/moss.db` | Central SQLite state; requires schema migration, backup, rollback, and WAL handling. |
| `~/.moss/settings.json` | Contains user configuration and currently some credentials. Keychain migration should happen before or alongside this. |
| `~/.moss/projects/` | Large and important for transcript/session resume behavior. Needs a compatibility index and retention policy. |
| `~/.moss/apps/` | Installed apps are user-visible durable assets. Migrate with app registry compatibility. |
| `~/.moss/skills/` | User and hub skills are durable capability packages. Needs system/hub/custom split. |
| `~/.moss/assistants/` | User and system assistants are durable. Needs system/hub/custom split. |
| `~/.moss/memory/` | Human-readable long-term context. Never migrate without explicit backup. |

### First Practical Refactor

The first code refactor should be path-only:

1. Add `ui/src/desktop-paths.mjs`.
2. Update `ui/src/log-ipc.mjs` to use `desktopPaths.observability.logs`, while
   keeping the legacy `~/.moss/logs` path as fallback for existing log download.
3. Update `ui/src/runtime/managed-runtimes.mjs` to use
   `desktopPaths.runtime.binaries`, while leaving existing installations
   discoverable.

This proves the contract on low-risk data before touching sessions, projects,
apps, skills, or settings.

## Practical Rule For Future Features

Every new desktop feature should answer these before adding files:

1. Is this durable user data, cache, runtime state, diagnostic output, or secret?
2. Who owns this directory?
3. Can it be deleted automatically?
4. Does it need export/import?
5. Does it need schema migration?
6. Should it be human-editable Markdown, JSON, SQLite, or opaque binary data?

If the answer is unclear, the feature should not create a new top-level
`~/.moss` directory.
