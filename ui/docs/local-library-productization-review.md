# Local Library Productization Architecture Review

> Review target: `local-library-productization-plan.md`
>
> Review scope: current `local-kb` implementation, project asset contract,
> desktop integration boundaries, migration safety, and the proposed first
> product release.
>
> Verdict: **Approve with required P0 controls.** The ownership change is
> necessary and the proposed direction is sound. Implementation must not begin
> with UI or retrieval expansion before authority, runtime, and security
> boundaries are fixed.
>
> Post-implementation update (2026-09-10): the required controls and the
> dependency-free retrieval phases have been implemented and verified. Section
> 9 records the completion review; earlier sections retain the original design
> review rationale.

## 1. Findings

### P0-1: A second resource authority would corrupt project semantics

#### Authority Risk

Moss already defines project `workspace/` and `assets.json` as canonical. A
Library database that independently owns project names, paths, provenance, or
deletion state would create dual writes and non-deterministic recovery.

Examples of likely failures:

- An asset removed from `assets.json` remains searchable.
- A renamed file appears twice under different Library IDs.
- A Library-side delete removes a project index row but not the project asset.
- Provenance diverges between project UI and search citations.

#### Required Authority Controls

- `ProjectAssetsProvider` is read-through for metadata and calls the existing
  project service for mutations.
- The Library `library_resources` row is a rebuildable provider projection.
- Existing project asset ID is the provider resource ID.
- Project asset events drive reconciliation; a periodic scan repairs missed
  events.
- No code path writes project `assets.json` from Library SQL state.

#### Authority Review Status

Addressed. This invariant must be captured in tests before implementation.

### P0-2: Conversational Python installation is not a product runtime

#### Runtime Risk

The current Skill may create a virtual environment and install Python and
native dependencies during a conversation. This is non-deterministic,
platform-dependent, difficult to support, and incompatible with background
indexing when no agent turn exists.

#### Required Runtime Controls

- Package the engine separately from the Skill.
- Reuse Moss managed-runtime installation and status mechanisms.
- Treat parser availability as application state visible in the Library UI.
- Keep metadata browsing available while the parser runtime is unavailable.
- Add a packaged smoke test for Python imports and SQLite FTS5.
- Never invoke `pip` from normal Library or Skill operations.

#### Runtime Review Status

Addressed. Phase 1 is blocked until the runtime packaging decision has an
executable prototype on macOS and Windows.

### P0-3: Renderer resource references cannot be trusted as file locators

#### Resource Reference Risk

The current composer ultimately deals in file paths. A resource chip containing
an arbitrary path, provider ID, or project ID would become a confused-deputy
path traversal or cross-project access channel if the main process trusts it.

#### Required Reference Controls

- Renderer and transcripts carry stable resource ID and URI, not authoritative
  absolute paths.
- The main process resolves IDs through the catalog and provider.
- Project scope is revalidated at send time.
- Local files are checked for path containment and symlink escape before read.
- Localized session copies and the resource manifest record the resolved hash
  and revision.
- Tampered IDs, stale IDs, and project substitution have negative tests.

#### Reference Review Status

Addressed. This is a release blocker for composer integration.

### P0-4: Index writes need one application-owned concurrency model

#### Concurrency Risk

The existing CLI assumes short-lived commands. Desktop refresh, file watchers,
project events, retries, and searches can overlap. WAL alone does not define job
claiming, revision supersession, crash recovery, or parser cancellation.

#### Required Concurrency Controls

- Use one IndexCoordinator as the only writer coordinator.
- Make jobs idempotent by resource ID, revision, and operation.
- Commit a new document revision transactionally.
- Preserve the previous searchable revision when parsing the new revision
  fails.
- Recover abandoned running jobs at startup.
- Coalesce watcher events and bound worker concurrency.
- Test process termination during parse and commit.

#### Concurrency Review Status

Addressed. The database schema and coordinator must land together; do not expose
auto-refresh before this exists.

## 2. High-Priority Findings

### P1-1: Path-based local-kb identity cannot survive product workflows

The current `(kb_id, path)` uniqueness works for a manual local corpus but not
for project asset rename, task artifact promotion, or remote provider identity.

The proposed resource ID plus revision model is correct. For personal local
sources, rename reconciliation remains inherently imperfect across platforms.
Generate the Library resource ID on first discovery, use provider-relative path
as its current locator, content hash as the primary rename hint, and OS file
identity only as an optional optimization. Never merge two resources solely
because hashes match; duplicate content may be intentional.

### P1-2: Folder selection needs explicit retrieval semantics

"Add folder to task" can mean either copy every file or make the folder a
retrieval scope. Copying everything creates context explosions and unnecessary
data exposure.

The composer contract should default folders and collections to
`search-scope`. Full localization must be file-only in v1. The UI should show
the distinction without asking users to understand chunking or token budgets.

### P1-3: Search results must remain evidence, not anonymous text

The current local-kb search returns paths, chunks, headings, and pages, which is
a good base. Product APIs must keep resource ID and revision through every
layer so the agent and UI can open or cite the source that produced an answer.

Do not reduce search output to a concatenated prompt. Context assembly must
preserve a machine-readable citation map in the session resource manifest.

### P1-4: Full chunk content creates a local data-management obligation

The SQLite index stores document text, not just tokens. Removing a source must
therefore remove its chunks, FTS rows, errors, cached previews, and pending jobs
without deleting the source files.

Required product behaviors:

- Explain that indexing creates a local searchable copy.
- Provide remove-source and rebuild-index actions.
- Restrict database permissions to the current OS user.
- Exclude sensitive paths and hidden files by default.
- Keep document content out of logs and telemetry.
- Document whether Library backups include indexed text.

Encryption at rest may be a later decision, but the data lifecycle cannot be.

### P1-5: Migration must import registrations, not stale index rows

The old database has path-based document identity and may contain partial or
parser-version-specific index state. Rebuilding is safer than attempting an
in-place row transform.

The proposed import of knowledge-base config and corpus rules is correct. Each
old named knowledge base must become a collection and each of its corpus paths
must become an attached source; flattening every root into unrelated sources
would lose the user's existing retrieval scopes. Migration must be previewable,
idempotent, and non-destructive, and must not start a broad scan until the user
confirms imported roots.

### P1-6: Project asset events are hints, not sufficient reconciliation

Event-driven indexing gives good latency but events can be lost across crashes,
older clients, or direct filesystem changes. The provider needs both event
handling and periodic/startup reconciliation against canonical project assets.

The reconciliation must be bounded and incremental. The current project scan
limit of 500 files is a compatibility constraint that should be made visible or
raised deliberately rather than inherited accidentally.

### P1-7: Task artifacts need a strict promotion boundary

Indexing all session outputs would fill the Library with temporary, duplicate,
or sensitive working files. Only explicit output candidates should appear in
Task artifacts, and they should remain transient until saved.

Promotion to a project must call the existing asset commit flow, preserve the
source session as provenance, and wait for the canonical project event before
indexing the new durable identity.

### P1-8: Current and successfully indexed revisions must be separate

A resource can change before its new content parses successfully. If one
`revision` field represents both provider state and searchable state, search
either returns stale content under the wrong revision or drops the last usable
content as soon as discovery notices a change.

The catalog must track both current `revision` and `indexed_revision`. Search
uses `indexed_revision`; successful transactional indexing advances it. Failed
indexing leaves it unchanged and reports the resource as stale with an error.

## 3. Medium-Priority Findings

### P2-1: Rewriting the engine now would add risk without product value

The Python engine already implements the important deterministic path. Moving
it into TypeScript, adding a vector database, or replacing `unstructured`
before ownership migration would combine product, runtime, schema, and
relevance changes in one release.

Keep FTS5 and Python behind a versioned worker contract. Measure parser quality
and retrieval misses after the product flow exists.

### P2-2: A remote iframe is not aligned with Moss local-first goals

WorkBuddy's iframe boundary is useful for a centrally shipped multi-client
product, but Moss would inherit online availability, origin policy, bridge
versioning, and duplicated UI state. A native React page behind typed IPC is the
appropriate v1 boundary.

The provider and IPC contracts should still be portable enough for a future web
surface.

### P2-3: Main-process implementation must not expand the monolith

`ui/src/main.mjs` already owns substantial project and session orchestration.
Adding SQL, worker control, file watching, and Library IPC inline would make
failure isolation and testing worse.

The proposed `ui/src/library/` module boundary is required. `main.mjs` should
only construct the service, register IPC, and forward canonical project events.

### P2-4: Provider capability differences should be visible

A provider may be searchable but not writable, previewable but not versioned,
or listable without watcher support. Avoid boolean fields scattered across UI
components. Return a capability set on each source/resource and derive actions
from it.

### P2-5: Project memory and Library retrieval must remain separate

Project memory is a curated summary produced by the Memory Finalizer. Library
search is evidence retrieval over durable files. Automatically merging them
would weaken provenance and increase context size.

Tasks may use both, but they should remain separate entries in the session
resource manifest and prompt assembly.

## 4. Current Implementation Assessment

### Strengths worth preserving

- Local-first SQLite database with WAL and foreign keys.
- Deterministic FTS5 behavior and Chinese tokenization on both ingest and query.
- Incremental file hashing and change detection.
- Broad but replaceable parsing layer.
- Useful error, prune, doctor, export, and rebuild operations.
- Search output already contains source path, heading, page, chunk index, and
  neighboring context.
- Project assets already capture hash and provenance.
- Session resource manifests and project asset snapshots provide a natural
  send-time localization boundary.

### Structural weaknesses to remove

- Skill prose owns application sequencing.
- Python environment repair happens inside user workflows.
- There is no stable service API or background job state.
- Database records use paths as resource identity.
- The generated status page is session-scoped product UI.
- Project assets and local-kb do not share identity or events.
- Search is available only when an agent chooses and successfully executes CLI
  commands.
- Permissions are filesystem assumptions rather than an explicit scope model.

## 5. Plan Review

### Accepted decisions

- Promote Library ownership into the desktop core.
- Separate Library resources from derived index state.
- Keep project assets canonical.
- Retain Python and FTS5 for the first release.
- Add a provider boundary before external integrations.
- Resolve structured resource references in the main process.
- Keep the Skill as a thin workflow consumer.
- Rebuild old indexes during migration.
- Implement a native desktop Library page.
- Expose Library retrieval as first-party in-process Agent tools, not a bundled
  stdio MCP server or per-session child process.

### Required implementation ordering

The reviewed order is:

1. Resource, scope, authority, URI, and worker contracts.
2. Managed runtime proof and package smoke test.
3. Library store, migration runner, and single-writer coordinator.
4. LocalPathProvider and headless search APIs.
5. ProjectAssetsProvider and canonical event reconciliation.
6. Task artifact promotion.
7. Persistent UI.
8. Composer resource references and built-in agent tool.
9. Skill transition and user migration.
10. Retrieval enhancements and external providers.

UI-first implementation is rejected because it would lock in unstable path and
job contracts.

## 6. Release Gates

### Gate A: Authority

- Project asset mutations go through the project service.
- Library project projections can be deleted and rebuilt without data loss.
- No normal operation dual-writes the old and new databases.

### Gate B: Runtime

- Packaged parsing works on macOS and Windows without conversational install.
- Missing runtime is visible and recoverable.
- Desktop startup remains independent of parser startup.

### Gate C: Isolation

- Cross-project ID substitution is rejected.
- Path traversal and symlink escape are rejected.
- Search defaults to the active project or explicitly selected personal scope.

### Gate D: Lifecycle

- Job crash recovery, cancellation, retry, and revision supersession pass.
- Failed reindex keeps the previous usable revision.
- Source removal deletes all derived searchable content.

### Gate E: User workflow

- Add resource to task works with structured refs.
- Save task artifact to project preserves provenance.
- Search results open their cited source.
- Normal use does not require the Skill or generated HTML dashboard.

### Gate F: Migration and packaging

- Existing local-kb registrations import idempotently.
- Old index remains untouched until explicit cleanup.
- Package verification checks the Library engine and performs a smoke search.

## 7. Residual Risks

The following risks remain acceptable for the first release if documented:

- Parsing quality varies for scanned PDFs, formulas, and complex tables.
- Local file rename detection is best effort on some filesystems.
- FTS5 lacks semantic recall for paraphrases.
- Office and media files may be cataloged but not searchable.
- Very large corpora need later performance tuning and backpressure refinement.
- Personal local sources rely on OS-user access rather than collaborative ACLs.

None of these justify delaying the ownership migration. They should be measured
after the durable resource and task loop is operational.

## 8. Final Recommendation

Proceed with Phase 0 and the managed-runtime proof in Phase 1. Do not begin the
top-level Library UI, composer chips, vector retrieval, or external providers
until the four P0 controls have executable tests.

The successful outcome is not "the Skill has a better dashboard." It is:

```text
Moss owns a durable local Library capability;
the native service owns indexing and retrieval;
Chat and Boss operate it through first-party Library tools.
```

## 9. Implementation Completion Review

### Outcome

No open P0 or P1 defect was found in the completed local Library path after the
final review and repair pass. The Library is application-owned, uses three
first-party in-process Agent tools, keeps project assets canonical, and leaves
the Skill as an optional workflow consumer.

### Findings fixed during final review

- Negative evaluation cases no longer reduce positive Hit@K and MRR scores.
- Neighbor context always retains the matched passage and the combined context
  never exceeds the requested character budget.
- Literal fallback escapes SQL `LIKE` wildcard characters.
- Ordinary searches no longer pay for diagnostics-only scope counts.
- Coverage-filtered candidate counts are exact while preview payloads remain
  bounded.
- Overview error totals include stale resources whose latest revision failed.
- PPTX slide discovery uses numeric order and title placeholders; XLSX sheets
  follow workbook relationships instead of ZIP filename order.
- Resource browsing loads additional bounded pages after the first 200 items.
- Non-component UI formatting moved out of the React component so development
  hot reload no longer forces a full page refresh.

### Verification evidence

- Library service: 30 passed, 0 failed.
- Root project: 835 passed, 0 failed.
- Desktop project: 374 passed, 0 failed.
- TypeScript, JavaScript syntax, Python parser compilation, and diff whitespace
  checks passed.
- Production renderer build passed.
- Desktop and 390 px viewport screenshots showed no clipping or incoherent
  overlap in the Library and diagnostics surfaces.
- The real v6 catalog retained 538 resources and 35,165 chunks with a matching
  35,165 FTS rows and zero active indexing jobs.

### Remaining conditional work

`library_sections` and semantic retrieval are intentionally gated, not missing
release work. Saved customer evaluation cases now provide the evidence needed
to decide whether either is worth its schema, storage, privacy, and maintenance
cost. OCR, multimodal parsing, external providers, and collaborative ACLs remain
outside the minimal local Library scope.
