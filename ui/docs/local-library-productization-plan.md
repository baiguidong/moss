# Local Library Productization Plan

> Status: Implemented in Moss desktop on 2026-09-08. This document remains
> the product contract for subsequent Library extensions.
>
> This plan promoted the original `local-kb` workflow from Skill ownership
> into a first-class Moss desktop capability. The released v1 keeps SQLite
> FTS5 and the existing retrieval behavior, but runs a versioned standard-library
> parser worker and deterministic CJK tokenizer from the managed runtime. The
> legacy bundled Skill and CLI were removed after the native tools became the
> only supported workflow. Product state, lifecycle, UI, permissions, and
> project integration live in desktop-owned services.
>
> The companion architecture review is
> `local-library-productization-review.md`. The earlier
> `local-kb-unstructured-sqlite-fts5-plan.md` remains the engine history and is
> not the product contract.

## 1. Decision

`local-kb` must not remain solely a Skill if Moss intends to provide a durable
library comparable to a native project or workspace capability.

The target ownership model is:

```text
Library product capability
  owns resource identity, scopes, lifecycle, jobs, UI, and agent contracts

Knowledge index
  is a derived, rebuildable projection used for retrieval

Chat/Boss agent runtime
  uses first-party in-process Library tools when Library is enabled
```

The migration changes ownership before changing retrieval algorithms. SQLite
FTS5 remains the default retrieval engine until measured quality shows that a
semantic index or reranker is needed.

## 2. Existing Baseline

### 2.1 Reusable implementation

The original `skills/local-kb/scripts/kb.py` prototype provided:

- Multiple named knowledge bases.
- Registered corpus roots with include, exclude, extension, and depth rules.
- Incremental ingestion using file metadata and content hashes.
- Parsing for Markdown, text, HTML, DOCX, PDF, PPTX, XLSX, and structured text.
- Structure-aware chunking with Chinese tokenization.
- SQLite WAL storage and FTS5 BM25 search.
- Search filters, neighboring chunk context, status, errors, pruning, export,
  FTS rebuild, and environment diagnostics.
- Machine-readable JSON output suitable for a service wrapper.

This list is retained as implementation history. The shipped product no longer
contains or invokes that Skill script.

### 2.2 Existing project data contract

Moss already has a durable project resource source:

```text
~/.moss/projects/<project-id>/
  workspace/       # canonical project files
  assets.json      # canonical project asset metadata and provenance
```

Project assets have stable IDs, hashes, source session references, source
paths, and provenance. Project sessions receive a session-local snapshot under
`.moss/project-assets/`, and `runtime/resource-manifest.json` records the
session resource snapshot.

These contracts stay authoritative. The Library must consume them through a
provider; it must not replace `assets.json` or become a second writer for
project asset metadata.

### 2.3 Current ownership problems

The current Skill-owned implementation has these product gaps:

- Availability depends on Skill discovery and model invocation.
- Stateful operations are coordinated by prose in `SKILL.md`.
- Index refresh is user or agent initiated; there is no desktop job lifecycle.
- Parser dependencies may be installed during a conversation.
- The status UI is generated as a session artifact rather than being part of
  persistent desktop navigation.
- Document identity is `kb_id + path`, which cannot reliably represent project
  assets, task outputs, renamed resources, remote providers, or revisions.
- Project assets and local-kb paths can describe the same file without sharing
  identity or change events.
- Composer attachments are paths, not durable resource references.
- There is no typed product API for browsing, searching, indexing, or adding a
  library resource to a task.

## 3. Goals

The first product release must:

1. Provide a persistent Library entry in Moss desktop.
2. Support personal local sources and project assets.
3. Automatically index project asset changes without requiring an agent turn.
4. Expose browse, search, source management, status, error, retry, and removal
   through typed desktop APIs.
5. Let users add a file or a collection scope to a task as a structured
   resource reference.
6. Let completed task outputs be saved to a project library and indexed.
7. Preserve source identity, hash, scope, provenance, and revision in search
   results and session snapshots.
8. Run parsing through a managed runtime rather than conversational package
   installation.
9. Keep all initial content and indexes local.
10. Keep the index disposable and rebuildable from registered sources.

## 4. Non-goals

The first product release will not include:

- Multi-user team spaces or remote ACL administration.
- Cloud sync.
- External knowledge providers such as Tencent Docs, Notion, or Drive.
- A vector database or mandatory embedding model.
- Automatic indexing of arbitrary user directories without explicit consent.
- Editing proprietary office formats in place.
- A remote iframe implementation of the Library UI.
- Replacement of project memory with library search.
- Removal of the existing Skill before migration and compatibility are proven.

## 5. Product Terminology

- **Library**: The user-facing Moss capability for durable resources.
- **Scope**: Ownership boundary: personal or project in v1.
- **Source**: A registered provider location, such as a local directory or a
  project's asset workspace.
- **Collection**: A named retrieval scope that groups one or more sources
  without owning their content.
- **Resource**: A file, document, folder, or collection addressable by stable
  identity.
- **Revision**: A content state identified initially by content hash.
- **Provider**: An adapter that lists and reads resources from one source type.
- **Index**: A rebuildable search projection of resource revisions.
- **Task artifact**: A generated session output not yet committed to a durable
  Library scope.
- **Resource reference**: A structured task input that points to a resource or
  collection without embedding its full content in the composer.

Do not use "knowledge base" to mean both durable files and FTS rows. Library is
the product; knowledge index is one implementation detail.

## 6. Architectural Principles

### 6.1 One authority per kind of state

- Project files and provenance: project `workspace/` and `assets.json`.
- Personal source registrations: Library service database.
- Session-local resource snapshots: session workspace and resource manifest.
- Parsed documents and chunks: rebuildable Library index database.
- Skill behavior: workflow guidance only, never canonical state.

### 6.2 Stable identity before path

A path is a provider locator, not a durable resource identity. Project assets
use their existing asset ID. Personal local files receive a generated Library
resource ID on first discovery; normalized provider-relative path is stored as
the provider locator. A confidently reconciled rename updates that locator
while preserving the Library resource ID. Content hash and OS file identity,
where available, are reconciliation evidence rather than identity by
themselves.

### 6.3 Capability-based providers

The UI and agent contracts depend on provider capabilities rather than source
names. Providers may support different subsets of list, search, read, write,
move, version, and watch operations.

### 6.4 Explicit task context

Selecting a resource does not silently inject an entire library. A task input
records whether the selection is:

- A file attachment to localize in full.
- A collection search scope available to retrieval tools.
- A quoted excerpt with a source locator.

### 6.5 Idempotent asynchronous indexing

Indexing is a background job keyed by resource ID and revision. Repeating a job
for the same revision is safe. Desktop startup never waits for corpus parsing.

### 6.6 Local-first security

Only explicitly registered personal sources and active project assets are in
scope. Hidden files, credential directories, ignored build outputs, and paths
outside provider roots are rejected by default.

## 7. Target Architecture

```text
React renderer
  LibraryPage
  LibraryPicker
  Composer resource chips
  Project asset actions
        |
        | typed window.agentDesktop.library API
        v
Electron main process
  Library IPC validation
        |
  LibraryService
    ResourceCatalog
    ProviderRegistry
    IndexCoordinator
    SearchService
    ResourceLocalizer
        |
        +----------------------+----------------------+
        |                      |                      |
  ProjectAssetsProvider   LocalPathProvider   TaskArtifactsProvider
        |                      |                      |
  assets.json/workspace   approved roots       session outputs
        |
  Library engine worker
    versioned parser/deterministic CJK tokenizer/SQLite FTS5
        |
  ~/.moss/library/library.db
```

The renderer never invokes Python, opens the Library database, or trusts a path
received from a resource chip. The main process validates all resource IDs and
provider roots.

## 8. Resource Contracts

### 8.1 Renderer-safe resource model

```ts
type LibraryScope =
  | { kind: 'personal' }
  | { kind: 'project'; projectId: string };

type LibraryCapability =
  | 'list'
  | 'search'
  | 'read'
  | 'write'
  | 'move'
  | 'delete'
  | 'watch'
  | 'version';

type LibraryResource = {
  id: string;
  sourceId: string;
  provider: 'project-assets' | 'local-path' | 'task-artifacts';
  scope: LibraryScope;
  uri: string;
  parentId: string | null;
  kind: 'file' | 'folder' | 'collection';
  name: string;
  relativePath: string;
  mimeType: string;
  size: number;
  revision: string;
  indexedRevision: string | null;
  contentHash: string | null;
  sourceSessionId: string | null;
  provenance: Array<{
    sourceSessionId: string | null;
    sourcePath: string | null;
    recordedAt: number;
  }>;
  capabilities: LibraryCapability[];
  indexStatus: 'unindexed' | 'queued' | 'indexing' | 'ready' | 'stale' | 'error';
  indexError: string | null;
  createdAt: number;
  updatedAt: number;
};
```

Absolute local paths are returned only by privileged main-process operations
that need them. Normal renderer and transcript payloads use IDs, URIs, and
provider-relative display paths.

### 8.2 URI scheme

Use stable, non-file URI forms:

```text
moss-library://personal/<resource-id>
moss-library://project/<project-id>/<asset-id>
moss-library://task/<session-id>/<artifact-id>
```

The URI is for identity and display. It is never converted to a filesystem path
without a main-process catalog lookup.

### 8.3 Provider interface

```ts
interface LibraryProvider {
  id: string;
  capabilities: ReadonlySet<LibraryCapability>;

  list(input: ListResourcesInput): Promise<ListResourcesResult>;
  stat(resourceId: string): Promise<LibraryResource | null>;
  read(resourceId: string, options: ReadOptions): Promise<ReadableResource>;

  search?(input: ProviderSearchInput): Promise<ProviderSearchResult>;
  write?(input: WriteResourceInput): Promise<LibraryResource>;
  move?(input: MoveResourceInput): Promise<LibraryResource>;
  remove?(resourceId: string): Promise<void>;
  watch?(sourceId: string, listener: LibraryChangeListener): Disposable;
}
```

Provider methods receive stable IDs. Provider implementations alone resolve
paths, tokens, or remote IDs.

## 9. Storage Model

Use one desktop-owned database at:

```text
~/.moss/library/library.db
```

The database contains canonical personal source registrations plus derived
resource and index state. It does not own project files or project asset
provenance.

### 9.1 Tables

```sql
CREATE TABLE library_sources (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT,
  display_name TEXT NOT NULL,
  root_locator TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, scope_kind, scope_id, root_locator)
);

CREATE TABLE library_collections (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  scope_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(scope_kind, scope_id, name)
);

CREATE TABLE library_collection_sources (
  collection_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(collection_id, source_id),
  FOREIGN KEY(collection_id) REFERENCES library_collections(id) ON DELETE CASCADE,
  FOREIGN KEY(source_id) REFERENCES library_sources(id) ON DELETE CASCADE
);

CREATE TABLE library_resources (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_resource_id TEXT NOT NULL,
  uri TEXT NOT NULL UNIQUE,
  parent_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  revision TEXT NOT NULL,
  indexed_revision TEXT,
  content_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  discovered_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(source_id, provider_resource_id),
  FOREIGN KEY(source_id) REFERENCES library_sources(id) ON DELETE CASCADE
);

CREATE TABLE library_jobs (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  revision TEXT,
  operation TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE UNIQUE INDEX library_jobs_active_dedupe
ON library_jobs(dedupe_key)
WHERE status IN ('queued', 'blocked', 'running');

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  resource_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  title TEXT,
  ext TEXT,
  status TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  indexed_at INTEGER,
  UNIQUE(resource_id, revision),
  FOREIGN KEY(resource_id) REFERENCES library_resources(id) ON DELETE CASCADE
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  page_start INTEGER,
  page_end INTEGER,
  content TEXT NOT NULL,
  indexed_content TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(document_id, chunk_index),
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
```

FTS5 remains an external-content projection of `chunks`. Index rows for old
revisions are deleted after a new revision commits successfully, so failed
reindexing does not remove the last usable revision. `revision` is the newest
revision observed from the provider; `indexed_revision` is the revision used
by default search. Discovery may advance `revision` and mark the resource stale
without changing `indexed_revision`. A successful transactional commit advances
`indexed_revision` and then removes obsolete document revisions.

### 9.2 Database ownership and concurrency

- `LibraryStore` owns schema, source, collection, catalog, and job mutations.
- The IndexCoordinator grants at most one engine worker an index-write lease;
  the main process does not mutate the Library database while that lease is
  active. Incoming catalog changes are buffered and reconciled afterward.
- All main-process database mutations and worker write leases pass through the
  same single-writer queue.
- Schema migration and index commits are never concurrent.
- Read operations use separate read-only connections under WAL mode.
- Job claiming uses an atomic queued-to-running transition.
- Jobs left running after a crash are returned to queued state at startup with
  an incremented attempt count.
- Repeated failure is visible and retryable; it is not silently suppressed.

## 10. Engine Packaging

### 10.1 Initial implementation

Retain Python for document parsing and Chinese tokenization. Extract the engine
from Skill ownership into one shared package. The product worker and temporary
legacy CLI entrypoint import the same package; they must not carry copied parser
or indexing implementations. The desktop service invokes the product worker
with strict JSON input and consumes JSON output.

Recommended packaged layout:

```text
packages/local-library-engine/
  python/
    worker.py
    moss_library_engine/
      schema.py
      parsing.py
      chunking.py
      indexing.py
      search.py

ui/resources/library/
  engine-manifest.json
```

The desktop package includes the shared engine package as an extra resource.
The desktop-owned Library service and packaged parser are the only active
entrypoints. The old Skill command is not packaged; compatibility is limited to
the explicit, idempotent legacy database migration in the native service.

### 10.2 Runtime contract

- Use Moss managed-runtime infrastructure for Python and parser dependencies.
- Inject the packaged engine location into the managed worker environment; do
  not resolve it relative to the current repository or Skill directory.
- Never run `pip install` as part of a user conversation.
- The desktop reports runtime state as `not-installed`, `installing`, `ready`,
  or `error`.
- Metadata browsing remains available when the parser runtime is unavailable.
- Indexing jobs wait in a visible blocked state until runtime preparation
  succeeds.
- Use one process per bounded batch initially. Introduce a persistent worker
  only after startup overhead is measured.
- All process arguments are structured and all file paths are main-process
  validated before invocation.

### 10.3 Worker operations

The worker contract starts with:

```text
doctor
ingest-resource
remove-resource
search
rebuild
stats
```

Each response includes `schemaVersion`, operation ID, success state, structured
error code, and payload. Human-readable stderr is diagnostic only.

## 11. Desktop Service and IPC

### 11.1 Main-process modules

Add focused modules instead of extending the `main.mjs` implementation body:

```text
ui/src/library/
  library-ipc.mjs
  library-service.mjs
  library-store.mjs
  library-types.mjs
  provider-registry.mjs
  index-coordinator.mjs
  engine-worker.mjs
  resource-localizer.mjs
  providers/
    project-assets-provider.mjs
    local-path-provider.mjs
    task-artifacts-provider.mjs
```

`main.mjs` constructs the service, registers IPC, and forwards project asset
change events. It does not implement parsing or SQL.

### 11.2 Preload API

Expose a namespaced, typed API:

```ts
window.agentDesktop.library = {
  overview,
  listCollections,
  createCollection,
  updateCollection,
  setCollectionSources,
  removeCollection,
  listSources,
  addLocalSource,
  updateSource,
  removeSource,
  listResources,
  getResource,
  search,
  enqueueRefresh,
  retryJob,
  cancelJob,
  listJobs,
  addResourcesToTask,
  saveTaskArtifact,
};
```

All mutation payloads are validated in the main process. Renderer-provided
absolute paths are accepted only from an explicit native file or directory
picker result and are revalidated before registration.

### 11.3 Events

Renderer subscriptions use a small event set:

```text
library:source-changed
library:resource-changed
library:index-job-changed
library:runtime-changed
```

Events contain IDs and current status, not document content.

## 12. Provider Behavior

### 12.1 ProjectAssetsProvider

- Reads project assets from the existing project service.
- Uses existing asset ID as `provider_resource_id`.
- Uses content hash as revision when available.
- Preserves existing provenance without copying it into a second canonical
  record.
- Registers one implicit source per active project.
- Receives asset added, updated, removed, and project archived events.
- Does not write `assets.json` directly.
- Saving a task artifact calls the existing project asset commit flow, then
  observes the resulting asset event for indexing.

### 12.2 LocalPathProvider

- Registers only paths chosen explicitly by the user.
- Gives each newly discovered file a generated stable Library resource ID.
- Stores normalized source roots and selection rules.
- Rejects traversal outside a registered root.
- Ignores hidden files, `node_modules`, build output, VCS internals, and common
  credential files by default.
- Uses a file watcher where reliable and a debounced scan fallback elsewhere.
- Treats watcher events as hints; content hash reconciliation is authoritative.
- Supports read and watch in v1; writing and moving are deferred.

### 12.3 TaskArtifactsProvider

- Projects completed session outputs as transient resources.
- Does not index every intermediate file automatically.
- Shows final output candidates from session `outputs/` and artifact metadata.
- Supports preview, add to task, and save to personal or project scope.
- A saved artifact receives a new durable provider identity; the task artifact
  remains provenance rather than canonical identity.

## 13. Indexing Lifecycle

### 13.1 State transitions

```text
resource discovered
  -> unindexed
  -> queued
  -> indexing
  -> ready

indexing -> error -> queued on explicit retry or source revision change
ready + revision changed -> stale -> queued -> indexing -> ready
resource removed -> remove job -> catalog tombstone and index deletion
```

### 13.2 Change coalescing

- Debounce repeated file events for the same resource.
- Keep only the newest queued revision when no job is running.
- If a resource changes during indexing, finish or cancel the old job and queue
  the newest revision.
- Commit chunks transactionally only after parsing succeeds.
- A failed new revision leaves the previous searchable revision available and
  marks the resource stale with an error.

### 13.3 Default indexing policy

- Project assets: index automatically after commit.
- Explicit personal local sources: index automatically after registration and
  on detected changes.
- Task artifacts: do not index until saved to a durable scope.
- Unsupported or oversized files: catalog them, mark them unsupported, and
  keep preview/download actions where possible.
- Binary media: catalog only in v1 unless an existing deterministic extractor
  is available.

## 14. Search Contract

Search results must preserve evidence identity:

```ts
type LibrarySearchHit = {
  resourceId: string;
  resourceUri: string;
  revision: string;
  title: string;
  relativePath: string;
  scope: LibraryScope;
  provider: string;
  chunkId: number;
  chunkIndex: number;
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  snippet: string;
  score: number;
};
```

Requirements:

- Search is scoped explicitly to personal, one project, or selected sources.
- Default results never cross into another project.
- Results are deduplicated by resource revision and nearby chunk overlap.
- The UI can open the exact resource and show the matched heading/page when the
  provider supports it.
- Agent answers receive citations containing resource ID, display path,
  revision, and location.
- FTS queries and Chinese tokenization remain deterministic and testable.
- Semantic retrieval, if later added, merges through this same result contract.

## 15. Composer and Agent Integration

### 15.1 Composer model

Add `composerResources` alongside path attachments. A resource chip contains:

```ts
type ComposerResourceRef = {
  uri: string;
  resourceId: string;
  selection: 'full-file' | 'search-scope' | 'quote';
  displayName: string;
  revision: string | null;
  quote?: {
    text: string;
    heading?: string;
    page?: number;
  };
};
```

Draft persistence, session switching, visible user events, and transcript
replay must preserve these objects without resolving them to paths in the
renderer.

### 15.2 Send-time resolution

Before starting the engine turn, the main process:

1. Resolves each resource ID through the Library service.
2. Revalidates scope and current project access.
3. Verifies the requested revision or records that a newer revision is used.
4. Localizes full-file resources into the session inputs directory.
5. Adds collection scopes to the session resource manifest.
6. Writes citation metadata into `runtime/resource-manifest.json`.
7. Passes only localized paths and structured retrieval scopes to the agent.

The engine must never receive an arbitrary path copied from chip metadata.

### 15.3 Agent tool

Add a built-in Library tool with a narrow initial surface:

```text
library_search(query, scope, source_ids?, limit?)
library_read(resource_id, revision?, location?)
library_list(scope, parent_id?)
```

These are first-party Agent Runtime tools. They run in the embedded Agent
process and call the desktop-owned `LibraryService` through the session-scoped
host event bridge. Do not package or launch a stdio MCP server for Library;
MCP remains the extension boundary for external connectors.

Write, move, and delete operations remain desktop-mediated mutations until
their permission and confirmation contracts are complete.

Chat and Boss sessions use these tools directly when Library is enabled. The
directory-import system prompt supplies the specialized conversational
workflow without loading a Skill.

## 16. Product UI

### 16.1 Navigation

Add a top-level `Library` entry without changing session-first startup.

```text
Library
  Overview
  Personal sources
  Project libraries
  Task artifacts
  Index activity
```

### 16.2 Primary view

The first release should provide:

- Scope switcher: Personal / Projects / Task artifacts.
- Source and folder navigation.
- Search field with scope and file-type filters.
- Dense file list showing source, path, type, updated time, and index state.
- Preview or open action.
- Add to task action for files and folders/collections.
- Add local source, refresh, retry, and remove-source actions.
- Index activity drawer with progress, errors, and retry.
- Save task artifact to project action.

The normal product UI must not be generated by `app_build`. The existing HTML
dashboard remains a diagnostic fallback during migration only.

### 16.3 Project integration

Extend the project Assets tab rather than replacing it:

- Show index status per asset.
- Add search within project assets.
- Add selected assets to a new or current task.
- Add refresh/retry actions for failed assets.
- Preserve upload, open, and remove behavior.
- Route all indexing actions through Library IPC.

## 17. Retired Skill End State

Remove `skills/local-kb` from source and release packages. Native Library tools
and the directory-import system prompt own the conversational workflow. The
retired Skill must no longer:

- Own database location or schema.
- Instruct the agent to create a Python environment.
- Install parser dependencies.
- Require Bash to perform normal product operations.
- Generate the primary Library UI.
- Define refresh sequencing that belongs to the job coordinator.

Native Library UI and agent-contract responsibilities include:

- Turning "make this folder a research library" into source registration and
  an initial refresh.
- Choosing useful search scope and filters from user intent.
- Producing a knowledge-gap or stale-document audit from Library results.
- Combining search, summarization, and project task creation into a reusable
  workflow.
- Explaining parser failures and suggesting supported remediation.

## 18. Migration

### 18.1 Existing local-kb state

Migration from `~/.moss/local-kb/local-kb.db` is explicit and idempotent:

1. Detect the old database without modifying it.
2. Back up Library registration data before applying a migration.
3. Create one Library collection for each old knowledge base, preserving its
   name, description, and retrieval config.
4. Create one Library source for each old corpus path and attach it to the
   imported collection, preserving include, exclude, extension, recursion, and
   depth rules.
5. Do not copy old document and chunk rows into the new schema.
6. Queue rebuild jobs from the imported source registrations only after the
   user confirms the migration preview and source roots.
7. Record a migration marker containing old database hash and timestamp.
8. Keep the old database available for rollback until the user confirms or a
   later cleanup release removes it.

Rebuilding avoids carrying path-based identity and unknown partial index state
into the product database.

### 18.2 Compatibility window

- The first productized release keeps the old CLI read-only for inspection and
  export.
- The Skill prefers Library APIs and reports a clear compatibility error when
  the desktop capability is unavailable.
- No operation writes both databases.
- After migration validation, normal Skill commands stop referencing the old
  database.

## 19. Implementation Phases

### Phase 0: Contracts and fixtures

Deliverables:

- Resource, source, search-hit, job, and composer-ref type contracts.
- Provider interface and URI rules.
- Library database migration runner.
- Fixed parser/search fixtures for Chinese and English documents.
- Security fixtures for traversal, symlinks, hidden files, and stale IDs.

Exit criteria:

- Contracts are reviewed before UI or IPC implementation.
- Schema migration is repeatable on an empty and existing database.
- Project assets are explicitly documented as canonical project state.

### Phase 1: Headless Library service

Deliverables:

- `LibraryService`, store, provider registry, index coordinator, and IPC.
- Managed Python engine runtime and structured worker protocol.
- `LocalPathProvider` with explicit source registration.
- Overview, sources, resource listing, jobs, refresh, retry, and search APIs.
- Migration preview for existing local-kb registrations.

Exit criteria:

- All normal operations work without loading the Skill.
- No conversational package installation is required.
- Restart recovers queued/running jobs without database corruption.
- Existing search quality matches the CLI fixtures.

### Phase 2: Project assets and task artifacts

Deliverables:

- `ProjectAssetsProvider` and project asset change integration.
- Automatic project asset indexing.
- `TaskArtifactsProvider` and save-to-project flow.
- Project Assets tab index state and search actions.
- Resource-manifest entries for localized project Library resources.

Exit criteria:

- Uploading or publishing a project asset queues exactly one effective index
  revision.
- Rename, replacement, removal, and project archive converge correctly.
- Saving a task output preserves provenance and makes it searchable.
- Project A searches never return Project B resources.

### Phase 3: Library UI and composer references

Deliverables:

- Top-level Library navigation and persistent page.
- Resource browser, scoped search, job activity, preview, and errors.
- Resource picker and structured composer chips.
- Send-time resource validation and localization.
- Built-in read-only Library agent tool.

Exit criteria:

- A user can add a personal file, project asset, or project collection to a
  task without copying its path manually.
- Drafts and session switching preserve resource chips.
- Transcript replay displays stable resource names even after a rename.
- Tampered renderer payloads cannot access files outside registered sources.

### Phase 4: Skill retirement and migration

Deliverables:

- Removal of the bundled `local-kb` Skill and stale installed copies.
- Old-database migration UI with preview, progress, and rollback guidance.
- Native Library tool and directory-import prompt contracts.
- Removal of the old CLI from release packages.

Exit criteria:

- All existing supported user intents have a Library API path.
- Imported sources rebuild successfully or expose actionable per-source errors.
- No normal workflow writes `~/.moss/local-kb/local-kb.db`.

### Phase 5: Hardening and extension points

Deliverables:

- Performance profiling and pagination hardening.
- Data-management controls for source removal and index deletion.
- Optional provider SDK for connectors.
- Retrieval evaluation harness and relevance metrics.

Exit criteria:

- Package verification covers the engine and managed runtime on macOS and
  Windows.
- Large-source cancellation and restart behavior are tested.
- External provider work can begin without changing resource or search result
  contracts.

## 20. Testing Strategy

### 20.1 Unit tests

- Resource ID and URI normalization.
- Scope isolation and capability checks.
- Provider path containment and symlink handling.
- File event coalescing and revision transitions.
- Job state recovery and retry limits.
- Search scope filters and citation mapping.
- Composer resource serialization.
- Existing Chinese tokenization and FTS query modes.

### 20.2 Integration tests

- Register source -> discover -> index -> search -> open citation.
- Project asset commit -> event -> index -> project-scoped search.
- Task output -> save to project -> provenance -> search.
- Rename and replace during an active index job.
- Remove source with keep-files and delete-index semantics.
- Crash during parse and during transactional index commit.
- Old local-kb registration migration and idempotent rerun.
- Missing or broken managed runtime with metadata UI still available.

### 20.3 Renderer tests

- Library scope and source navigation.
- Search loading, empty, error, stale, and partial-result states.
- Job progress and retry.
- Resource picker keyboard behavior.
- Composer chip draft persistence and removal.
- Project Assets index badges and actions.

### 20.4 Package tests

- Packaged Library engine files exist.
- Managed runtime resolves on each release target.
- Parser imports and SQLite FTS5 work in the packaged environment.
- A packaged smoke fixture can be indexed and searched.
- No code path depends on the development checkout of `skills/local-kb`.

### 20.5 Security tests

- Renderer path injection.
- Resource ID substitution across project scopes.
- Symlink escape after source registration.
- Source root removal while jobs are active.
- Malformed parser output and oversized output payloads.
- HTML preview sanitization remains isolated from indexing.
- Search snippets do not cross scope boundaries.

## 21. Operational Requirements

- Desktop startup must not wait for indexing or runtime installation.
- Browsing catalog metadata must work while indexing is offline.
- Search reports whether results are complete, stale, or partially unavailable.
- Every failed job has a stable error code and an actionable user-visible
  message.
- Logs include job ID, source ID, resource ID, revision, phase, and duration,
  but not document content.
- Removing a source deletes its catalog projection and index rows but never
  deletes original files unless a separate, explicit file-delete action exists.
- Index database deletion is supported as a repair action; registered sources
  can rebuild it.
- Backup/export distinguishes source registrations from derived index content.

Initial performance targets for a warm desktop process:

- Listing a page from a 5,000-resource catalog: under 300 ms locally.
- Returning the first 20 FTS hits from 50,000 chunks: under 500 ms locally.
- Job cancellation becomes visible within 2 seconds.
- No unbounded file-read or worker-result payload crosses IPC.

These are regression budgets, not claims about all hardware. Tests should use
representative fixtures and record the machine profile.

## 22. Rollout and Rollback

Use feature flags for:

```text
LibraryCore
LibraryProjectAssets
LibraryComposerResources
LibraryMigration
```

Rollout order:

1. Ship headless LibraryCore disabled by default in production builds.
2. Enable internal metadata and search testing.
3. Enable project asset indexing for selected users.
4. Enable Library UI and composer references.
5. Offer old local-kb registration migration.
6. Switch the Skill to the product API.

Rollback disables UI and new job scheduling without modifying project assets
or old local-kb state. The new index database may be retained for diagnosis or
deleted because it is rebuildable.

## 23. Definition of Done

Productization is complete only when all of the following are true:

- Library works without the `local-kb` Skill being selected.
- Project assets and registered personal sources have stable resource IDs.
- Indexing is background, observable, cancellable, retryable, and restart-safe.
- Parser runtime setup is application managed.
- Search is scoped and returns durable citations.
- Files and collections can be added to tasks as structured references.
- Task outputs can be committed back to a durable Library scope.
- Project assets remain canonical and no dual-write database exists.
- The normal UI is a persistent desktop surface, not a generated app.
- Existing local-kb registrations have a tested migration path.
- No bundled or installed `local-kb` Skill is required or exposed.
- Package, integration, renderer, migration, and security tests pass on release
  targets.

## 24. Reference Principles

The WorkBuddy reference is useful for product principles, not for assuming an
undisclosed retrieval implementation:

- Treat files and Agent output as one durable work loop.
- Separate personal and shared/project ownership.
- Use structured references to add resources to tasks.
- Keep permissions aligned with the current user and scope.
- Support write-back and provenance, not retrieval alone.
- Make content management and indexing provider-independent.

References:

- <https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library>
- <https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library/Content-Management>
- <https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library/Collaboration>

## 25. Minimal-Dependency Retrieval Quality Plan

> Implementation status: Retrieval Quality Phases A and B completed on
> 2026-09-09. All dependency-free Phase C work is complete, including real-data
> evaluation management, full local diagnostics, format-aware citation
> locations, bounded Agent query retries, parse caching, and local metrics. The
> optional `library_sections` parent-child table remains gated by evaluation.
> Phase D semantic retrieval has not been approved or started.

### 25.1 Decision

The next Library iteration should not begin by adding a vector database, OCR
stack, knowledge graph, or general RAG workflow engine. The lowest-cost path to
a materially better local Library is to make the existing SQLite FTS5
retriever measurable, field-aware, Chinese-aware, context-preserving, and
explainable.

The target remains an Agent retrieval substrate rather than a standalone RAG
chat application:

```text
User task
  -> Moss Agent chooses a Library scope and query
  -> local retrieval returns ranked evidence
  -> context assembly preserves section and neighboring context
  -> stable citations identify the exact resource revision
  -> Moss Agent synthesizes the answer
```

This plan uses the following dependency budget:

- P0 and P1 retrieval work adds no third-party runtime package.
- SQLite FTS5, Electron/Node APIs, and the current managed Python standard
  library remain the base implementation.
- `pypdf` remains a small optional PDF text extraction extension.
- `unstructured[all-docs]` remains an explicitly optional large parser
  extension and is never part of the base runtime.
- `jieba`, `markdown`, and `python-magic` are not independent Library
  extensions. The product must not advertise or install them directly.
- Embedding, local reranking models, OCR, and vector indexes require a separate
  opt-in decision after retrieval evaluation identifies a measured need.

### 25.2 Current Quality Baseline

The implemented v1 baseline provides:

- SQLite FTS5 retrieval with BM25 ranking.
- NFKC normalization, ASCII word tokens, and Chinese character plus bigram
  tokens.
- `all` and `any` query modes.
- Collection, source, personal, project, task-artifact, and extension scopes.
- Fixed character chunks with boundary seeking and overlap.
- Page and heading metadata where the parser can provide them.
- Stable resource IDs, indexed revisions, and citation URIs.
- Deterministic incremental indexing and same-source byte-hash deduplication.

The main quality limitations are:

- Title, path, heading, and body matches share one FTS field and cannot receive
  different ranking weights.
- Chinese tokenization has high substring recall but weak word-level ranking.
- `all` and `any` are manual alternatives rather than one bounded retrieval
  strategy.
- Retrieved chunks do not carry a parent section and only expose neighboring
  chunks through a later read call.
- There is no repeatable relevance benchmark or customer-visible explanation
  of why a result ranked where it did.
- The parser extracts readable text but does not consistently preserve logical
  document structure across built-in formats.
- Semantic matches without lexical overlap require the Agent to formulate a
  second query.

### 25.3 Optimization Cost and Benefit Matrix

| Optimization | Minimum implementation | Benefit | Cost and risk | Decision |
| --- | --- | --- | --- | --- |
| Retrieval evaluation set | Store representative query, expected resource, optional expected section, and scope fixtures in JSON; compute Hit@1, Hit@5, MRR, no-result rate, and latency | Makes every retrieval change measurable and prevents intuition-driven tuning | No runtime dependency; requires curated fixtures and a small test runner | P0, implement first |
| Field-aware FTS | Replace the single indexed field with title, path, heading, and body token columns; use FTS5 BM25 column weights | Stronger results for names, file titles, model numbers, and section headings | Schema migration and one full index rebuild; weights need fixture tuning | P0, high value |
| In-process Chinese words | Add `Intl.Segmenter` word segments at indexing and query time while retaining current characters and bigrams as fallback | Improves Chinese ranking without sacrificing unusual names or partial-term recall | No package dependency; packaged ICU behavior and fallback require tests; reindex required | P0 |
| Exact-match boosts | Apply deterministic phrase, title, heading, and path bonuses to the bounded FTS candidate set | Makes exact business terms and identifiers reliably outrank incidental body matches | No dependency; excessive bonuses can distort long natural-language queries | P0, tune through evaluation |
| Bounded broad fallback | Run `all` first; when it underfills, run `any`; fuse ranked lists with reciprocal rank fusion | Reduces zero-result searches without asking the user or Agent to retry manually | No dependency; up to one additional local query; needs duplicate merging | P0 |
| Result diversity | Limit initial evidence concentration per resource and prefer different sections before accepting adjacent hits | Prevents one long document from occupying the complete context budget | No dependency; may hide multiple independently relevant passages in one file | P0, use bounded rules |
| Neighbor expansion | Attach the previous and next chunk after ranking, then deduplicate and trim to a context budget | Avoids incomplete sentences and missing qualifications | No dependency; increases result payload and requires deterministic budgeting | P0 |
| Retrieval explanation | Return matched fields, normalized query terms, rank components, fallback mode, and selected context ranges | Lets developers and customers understand false positives and false negatives | No dependency; API additions and a compact diagnostics UI are required | P0 |
| Citation ranges | Preserve page, heading, start/end line where available, chunk index, resource ID, and indexed revision | Makes generated answers easier to verify against the source | No dependency; parsers must emit stable ranges and old resources need reindexing | P0/P1 |
| Structure-aware Markdown | Split built-in Markdown at headings and fenced blocks; retain a heading path on each block | Better chunk boundaries and citations for a common local format | No dependency; a limited parser must avoid pretending to implement the entire Markdown specification | P1 |
| Built-in Office metadata | Preserve DOCX heading styles, PPTX slide titles, and XLSX sheet names using the existing ZIP/XML parser | Better section retrieval without requiring `unstructured` | No dependency; moderate format-specific fixture and parser work | P1 |
| Child and parent context | Index smaller child chunks and associate each with one section record returned as parent context | Improves search precision while preserving enough material for generation | No dependency; new section schema, larger index, and full rebuild | P1 after neighbor expansion |
| Parse cache by revision | Cache parser output by content hash, parser version, and chunk configuration while preserving distinct logical resources and citations | Avoids reparsing duplicate content across collections or providers | No dependency; medium schema and lifecycle complexity | P1, performance work |
| Agent query variants | When lexical retrieval remains insufficient, let the existing Agent issue two or three focused synonym or acronym queries | Covers some semantic mismatch without a new model or vector store | Uses the current model, adds latency and tokens, and may expose retrieved terms to a remote provider | P1, explicit and bounded |
| LLM reranking | Send only the top lexical candidates to the configured model for relevance ordering | Can improve complex natural-language ranking | No package dependency but adds a model request, latency, cost, privacy impact, and nondeterminism | Optional experiment, not default |
| Embedding retrieval | Add an embedding provider contract and store model-versioned vectors locally | Retrieves conceptually related text with little lexical overlap | Requires an embedding model or API, vector lifecycle, model migrations, extra storage, and privacy controls | P2 only after measured lexical misses |
| Hybrid retrieval | Fuse BM25 and vector ranks using reciprocal rank fusion | Balances exact identifiers with semantic recall | Depends on embedding retrieval and expands relevance debugging | Ship with, not before, optional embeddings |
| OCR and multimodal parsing | Invoke an optional OCR/parser pack only for documents with no readable text | Supports scanned PDFs and image-only documents | Large model/dependency footprint, slow indexing, platform variance, and difficult packaging | Deferred opt-in extension |
| External providers | Add web, online document, drive, or database provider adapters | Broadens available knowledge sources | Authentication, sync, conflict, rate-limit, and permission ownership dominate implementation cost | Defer until local retrieval is measured |
| Knowledge graph | Extract entities and relationships into a graph retriever | Helps a narrow class of multi-hop relationship questions | High model, storage, invalidation, observability, and evaluation cost | Do not implement now |
| Multi-user ACL | Add workspace, organization, and document-level authorization | Enables server-hosted team knowledge bases | Changes the current single-user local authority model | Outside the local Library scope |

### 25.4 Target Dependency-Free Retrieval Pipeline

```text
Raw query
  -> NFKC and case normalization
  -> ASCII tokens + Intl.Segmenter words + CJK characters/bigrams
  -> scoped FTS5 field search
       title | relative path | heading | body
  -> strict `all` candidates
  -> bounded `any` fallback when strict results underfill
  -> reciprocal rank fusion
  -> deterministic title/heading/path/phrase boosts
  -> per-resource and per-section diversity
  -> parent or neighboring context expansion
  -> context budget trimming
  -> stable revision citations and match explanation
```

The search response must distinguish retrieval evidence from assembled
context. A proposed additive result shape is:

```ts
type LibrarySearchResult = {
  resourceId: string;
  uri: string;
  revision: string;
  title: string;
  sourceName: string;
  heading: string | null;
  page: number | null;
  startLine: number | null;
  endLine: number | null;
  matchedChunk: string;
  context: string;
  rank: {
    final: number;
    fts: number;
    matchedFields: Array<'title' | 'path' | 'heading' | 'body'>;
    exactPhrase: boolean;
    fallbackMode: 'all' | 'any';
  };
};
```

Agent-facing tools may omit detailed rank components by default, but the
desktop diagnostics API must retain them. Filesystem locators remain excluded
from Agent results.

### 25.5 FTS Schema Evolution

The next FTS revision should use explicit columns:

```sql
CREATE VIRTUAL TABLE library_chunks_fts_v2 USING fts5(
  title_terms,
  path_terms,
  heading_terms,
  body_terms,
  resource_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Requirements:

- Column weights are constants owned by the retrieval service and calibrated
  against fixtures, not user-facing tuning controls in the first iteration.
- Query generation must escape FTS syntax and preserve the existing 32-token
  bound.
- `Intl.Segmenter` output supplements rather than replaces CJK characters and
  bigrams.
- A deterministic fallback preserves current tokenization when word
  segmentation is unavailable.
- Migration creates the new table, rebuilds it from current indexed chunks,
  atomically switches search to the new table, and then removes the old table.
- Cancellation and restart during rebuild must leave either the old complete
  FTS index or the new complete FTS index available.

### 25.6 Context Assembly Rules

Context assembly must occur after ranking so expansion does not distort BM25.

Initial rules:

- Keep the matched child chunk as the citation anchor.
- Expand at most one neighboring chunk on each side for v1 of the change.
- Do not cross a known heading or section boundary unless the matched chunk has
  no useful context on one side.
- Merge overlapping chunk text before enforcing the context budget.
- Keep a configurable service-level character budget and a per-result cap.
- Preserve at least one result from each of the highest-ranked distinct
  resources before adding another result from the same resource.
- Return stale indexed revisions only with the existing stale status and
  revision citation; never label stale text as the current file revision.

Parent-child storage should be added only after neighbor expansion is measured.
If needed, add `library_sections` once and let multiple child chunks reference
one section rather than duplicating parent text in every chunk.

### 25.7 Parser Improvement Policy

Built-in parsers remain the default and should improve in this order:

1. Markdown heading hierarchy, paragraphs, lists, and fenced code boundaries.
2. DOCX paragraph styles and table text with heading inheritance.
3. PPTX slide title and body separation with slide number citations.
4. XLSX workbook sheet names, row boundaries, and stable sheet citations.
5. PDF page ranges through `pypdf` when installed.

The built-in path must stay conservative: if a structure cannot be recovered
reliably, return normalized text rather than invented headings or table
semantics.

`unstructured[all-docs]` remains useful for customers with complex formats, but
its size and native/transitive dependencies make it unsuitable as a default.
The extension UI must label it as an advanced, large optional parser. Its
installation may transitively include packages that Moss does not expose as
independent extensions.

OCR is not part of the base parser. A future OCR pack may be offered only when:

- the built-in parser confirms that a supported document has no readable text;
- the user explicitly installs and enables the OCR pack;
- its download size, disk usage, and expected indexing time are shown before
  installation;
- scanned-document fixtures pass on every release platform.

### 25.8 Evaluation and Release Gates

Before changing ranking behavior, establish representative fixtures covering:

- exact file names and titles;
- English identifiers, model numbers, URLs, and code symbols;
- Chinese names and business terms;
- queries whose words appear in different parts of one section;
- strict `all` misses that should succeed through bounded `any` fallback;
- duplicate content and similarly named files;
- stale revisions and parser failures;
- personal and project scope isolation;
- queries expected to return no result.

Record at least:

- Hit@1 and Hit@5 by query category;
- mean reciprocal rank;
- no-result rate;
- duplicate evidence rate;
- citation completeness;
- search P50 and P95 latency;
- assembled context character count;
- index size and rebuild duration.

Release gates for P0/P1:

- No regression for exact identifier and title queries.
- Scope isolation and revision citation tests remain unchanged.
- Broad fallback improves intended misses without introducing cross-scope
  results.
- Search remains within the existing warm-process latency budget.
- Context expansion never exceeds its configured budget.
- Ranking diagnostics explain every deterministic score component.
- Full reindex is restart-safe and does not modify source files.

Embedding work is approved only if the post-P1 evaluation shows a meaningful
set of important misses caused by synonym or semantic mismatch rather than
parsing, scoping, or ranking defects.

### 25.9 Delivery Phases

#### Retrieval Quality Phase A: Measurement and Ranking

Status: **Completed on 2026-09-09.**

Delivered:

- [x] Retrieval fixture format and benchmark runner.
- [x] In-app real-data evaluation case management, persisted evaluation runs,
  Hit@1, Hit@5, MRR, negative accuracy, duplicate evidence, citation
  completeness, and latency trends.
- [x] FTS5 v2 multi-field schema and rebuild migration without reparsing
  existing chunks.
- [x] `Intl.Segmenter` word tokens with current CJK character and bigram
  fallback tokens.
- [x] Deterministic phrase and title, path, heading, and body field boosts.
- [x] Strict plus coverage-bounded broad retrieval with reciprocal rank
  fusion.
- [x] Search diagnostics in service responses, Library search results, tests,
  and a local diagnostics console covering candidates, score components,
  fallback, coverage filtering, and explicit zero-result reasons.
- [x] No new runtime dependency introduced.

No new runtime dependency is permitted in Phase A.

#### Retrieval Quality Phase B: Context and Citations

Status: **Completed on 2026-09-09.**

Delivered:

- [x] Per-resource and per-block diversity rules.
- [x] Neighbor expansion with overlap removal, a per-result cap, and a total
  context budget.
- [x] Line and block ranges from built-in parsers where stable.
- [x] Format-aware location kinds for text lines, CSV rows, DOCX paragraphs,
  PDF pages, PPTX slides, and XLSX sheets/rows.
- [x] Structured citation payloads and Agent guidance for URI, revision, page,
  heading, line range, and chunk index.
- [x] A compact retrieval diagnostics surface in the Library search result
  list.
- [x] No new runtime dependency introduced.

No new runtime dependency is permitted in Phase B.

#### Retrieval Quality Phase C: Structure and Performance

Status: **Partially gated; all currently justified work completed on
2026-09-09.**

Delivered and gated items:

- [x] Structure-aware built-in Markdown blocks with heading paths and line
  ranges.
- [x] Built-in DOCX heading sections, PPTX slide titles, XLSX sheet names, and
  preserved table delimiters.
- [ ] Optional `library_sections` parent-child schema. Neighbor expansion is
  implemented first; add this table only if the retrieval evaluation shows a
  material context loss that neighbor expansion cannot solve.
- [x] Bounded parser-output cache keyed by content hash and parser signature.
- [x] Cache invalidation for parser or extension changes, full-rebuild bypass,
  size limits, and source-removal cleanup.
- [x] Search duration, parse duration, parser failure, and cache-hit metrics
  stored locally without query or document content.
- [x] Metrics and evaluation trends shown in the desktop diagnostics surface.
- [x] Bounded Agent query-variant guidance: after an unhelpful first search,
  retry at most twice with a synonym, expanded acronym, or shorter business
  term while preserving the original scope.
- [x] No new third-party runtime package introduced.

No new third-party package is expected in Phase C. `pypdf` and
`unstructured[all-docs]` remain optional and independently installable.

#### Retrieval Quality Phase D: Optional Semantic Retrieval

Status: **Not started; gated by the Phase A-C benchmark.**

Do not schedule this phase automatically. First review the Phase A-C benchmark.

If approved, prototype in this order:

1. [ ] Define a versioned embedding provider contract without selecting
   storage.
2. [ ] Reuse an already configured provider only after explicit user consent.
3. [ ] For a measured small-corpus bound, benchmark normalized vectors stored as
   SQLite BLOBs with in-process cosine scoring.
4. [ ] Add one vector extension only if linear scoring fails the latency or scale
   budget on supported customer corpora.
5. [ ] Fuse semantic and BM25 ranks with reciprocal rank fusion.
6. [ ] Keep semantic indexing optional, rebuildable, model-versioned, and clearly
   separated from the base FTS index.

Local embedding model downloads, remote embedding APIs, and content transfer
must each have separate user-visible privacy and storage semantics.

### 25.10 Explicitly Deferred Work

The following work does not belong in the minimal local Library completion
scope:

- Bundling a general vector database service.
- Bundling embedding or cross-encoder model weights in the Moss installer.
- Installing `unstructured[all-docs]` by default.
- Treating `jieba`, `markdown`, or `python-magic` as product features merely
  because they may exist as transitive Python dependencies.
- Adding a visual RAG pipeline editor.
- Adding a knowledge graph before lexical and optional semantic retrieval are
  measured.
- Adding web crawlers or cloud-drive connectors before provider sync and ACL
  ownership are designed.
- Adding multi-user authorization to the local single-user database.
- Encrypting the SQLite index with a new native database dependency before the
  OS-level threat model and customer requirement justify it.

Comparison references for the capability boundary:

- RAGFlow hybrid retrieval and reranking: <https://ragflow.io/>
- RAGFlow deployment requirements: <https://github.com/infiniflow/ragflow/blob/main/docs/quickstart.mdx>
- Dify Knowledge Pipeline: <https://www.dify.ai/rag>
- Haystack retriever categories and hybrid retrieval: <https://docs.haystack.deepset.ai/docs/retrievers>
- AnythingLLM text splitting: <https://docs.anythingllm.com/setup/embedder-configuration/text-splitting>

### 25.11 Completion Review (2026-09-09)

Implemented without a new runtime dependency:

- [x] SQLite schema v6 migration preserving existing resources and chunks.
- [x] Customer-manageable evaluation cases and bounded run history.
- [x] Full retrieval diagnostics without storing query or document content in
  operational metrics.
- [x] Context trimming that preserves the matched passage and enforces the
  total character budget across all returned results.
- [x] Literal fallback escaping for SQL `LIKE` wildcard characters.
- [x] Correct positive/negative evaluation denominators.
- [x] Desktop and narrow-viewport visual verification.
- [x] Existing completed sources remain untouched during schema migration.
- [x] Large resource lists page in bounded batches instead of silently stopping
  after the first 200 entries.
- [x] PPTX slide titles and XLSX workbook relationship order are preserved by
  the built-in parser.

Final verification on 2026-09-10:

- [x] Library service suite: 30 passed, 0 failed.
- [x] Root suite: 835 passed, 0 failed.
- [x] Desktop suite: 374 passed, 0 failed.
- [x] TypeScript and JavaScript checks passed.
- [x] Production renderer build passed.
- [x] `git diff --check` and Python parser compilation passed.
- [x] Real Library schema migrated to v6 with 538 resources, 35,165 chunks,
  35,165 FTS rows, and no active indexing jobs.

Still gated rather than incomplete:

- [ ] Add `library_sections` only when saved real-data evaluations demonstrate
  section-level context loss that bounded neighbor expansion cannot solve.
- [ ] Start Phase D only when saved evaluations demonstrate important semantic
  misses after query retries; embeddings require an explicit provider, privacy,
  storage, and model-version decision.
