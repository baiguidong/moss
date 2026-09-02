# Moss Group Rooms Implementation Plan

Status: implemented and verified in the real desktop client; the repository
default remains explicit opt-in

## Goal

Add local multi-agent group rooms to the Moss desktop application. A room can
invite installed assistants, individual experts, and expert teams; agents can
discuss a shared topic, challenge or supplement each other, run tasks in
parallel, use explicitly assigned connectors and skills, accept custom prompt
members, and respond to host interventions.

The implementation must remain isolated from the existing Session, Project,
Coordinator, Cron, Feishu, Audit, Fork, and remote-direct behavior.

## Non-negotiable boundaries

- Group rooms are not rows in the existing `sessions` table.
- Group rooms do not use `ensureRuntime()` or mutate the existing `sessions`
  map.
- Existing Session IPC payloads and renderer state stay backward compatible.
- Existing ChatArea and session grouping logic do not gain room branches.
- The feature is local-only and behind `advanced.moss_group_rooms` until all
  acceptance gates pass.
- Existing resources are consumed through read-only adapters. Resource secrets
  never cross room IPC or enter room persistence.
- Existing runtime behavior is unchanged unless the new optional strict tool
  permission callback is supplied by a room member runtime.

## Architecture

```text
GroupRoomsView
  -> group-room preload API
    -> GroupRoomController
      -> GroupRoomStore
      -> RoomResourceCatalog
      -> RoomExecutionScheduler
      -> RoomRuntimeRegistry
        -> ClaudeSession
```

`GroupRoomController` owns the serial conversation and parallel fan-out/fan-in
state machines; they are kept together so one per-room command queue remains
the sole mutation boundary.

The composition root may register the feature, but existing feature modules do
not import Group Room modules. Group Room modules may import stable, read-only
assistant and connector helpers.

## Open-source design provenance

The room contract borrows semantics, not runtime code, from AG2/AutoGen:

- A canonical shared thread is broadcast to distinct participants, while a
  manager controls speaker order. Moss implements manual ordered turns and a
  human-confirmed model selector rather than importing the Python runtime.
- A conversation dispatch either runs for a host-specified 1-100 rounds or
  continues until a tool-disabled moderator finds no material unresolved
  issue. Rounds are appended incrementally. Later rounds must read, challenge,
  supplement, and revise the conclusions from earlier speakers;
  a parallel dispatch is a Moss-specific fan-out/fan-in extension with a shared
  immutable context snapshot.
- Human intervention and explicit termination mirror AutoGen's external and
  human-in-the-loop controls, but Moss keeps tool approvals in the Electron
  host and never gives the moderator tool access.
- Message, token, timeout, and external-stop termination concepts are adapted
  to Moss run/turn state and crash recovery.

Primary references:

- AG2 `GroupChatManager`: https://docs.ag2.ai/0.8.7/docs/api-reference/autogen/GroupChatManager/
- AutoGen `SelectorGroupChat`: https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/selector-group-chat.html
- AutoGen termination conditions: https://microsoft.github.io/autogen/0.4.8/user-guide/agentchat-user-guide/tutorial/termination.html

## Persistence

Use an independent SQLite database and directory tree:

```text
~/.moss/group-rooms/
  rooms.sqlite
  <room-id>/
    members/<member-id>/engine/
    resources/
```

Tables:

- `group_rooms`: topic, title, state, revision, settings, summary, summary
  watermark, timestamps.
- `group_room_members`: identity, role, source reference, prompt snapshot,
  team charter snapshot, resource grants, runtime session id, status.
- `group_room_messages`: stable room sequence, author, audience, causation,
  correlation, kind, visibility, status, content.
- `group_room_runs`: trigger, mode, context snapshot, status, stop reason,
  timestamps.
- `group_room_turns`: member assignment, output slot, status, usage, error,
  resource fingerprint, timestamps.

All room mutations run through a per-room command queue. Configuration changes
use optimistic `revision` checks. Running records found at startup become
`interrupted`; work is never automatically replayed.

## Resource invitation semantics

- A regular installed assistant or expert creates one member.
- An installed expert team is an invitation template. Its members become room
  members and its top-level prompt becomes their shared team charter.
- A team does not create an additional coordinator member.
- Member prompts and the team charter are snapshotted when invited.
- Source identifiers and content hashes are retained so the UI can report an
  available update without silently changing a participant.
- Duplicate source members are rejected unless the host explicitly creates a
  role copy.
- Missing or unsafe member prompt paths reject the whole team invitation.
- Assistant and connector resources are revalidated at each run boundary.

## Connector and tool policy

- The room has a connector pool selected with the same resource picker used by
  Projects. Selection controls connector availability; room permission policy
  controls whether concrete tool operations require confirmation. Internal
  grants retain `read`, `write`, and CLI capability fields as a runtime
  boundary, but the UI does not expose a second permission system beside room
  permissions.
- Only installed, enabled, connected connectors may be granted.
- MCP config and credential environment are resolved in the main process from
  the current connector store and are never serialized.
- A runtime receives only MCP servers and connector directories assigned to
  that member.
- Unknown MCP server prefixes are denied even if bootstrap discovers them.
- Connector-provided skills are allowlisted by exact command. Forked skills
  are disabled in the first release.
- Selecting a CLI connector makes its declared CLI capability available;
  connector commands are still limited to the declared
  executable without shell chaining, redirection, command substitution, or
  generic interpreters. Ordinary workspace Bash remains available.
- Room permission mode has priority over global permission mode. `inherit`
  uses the global bypass setting and then the existing user/project/local rule
  loader, `ask` forces confirmation for mutations and external tools, and
  `allow-all` bypasses prompts inside the room's resource boundary. Room
  approvals never persist permission rules.
- `skip_confirmation` and equivalent connector confirmation bypasses are
  denied.
- Agents cannot perform connector OAuth. An expired connector pauses the turn
  and sends the host to the existing Connector Hub flow.
- Read-only connector grants do not load connector action skills or CLI
  directories. Moss MCP resource listing/reading is supported only for the
  member's assigned servers.
- Parallel turns sharing a write-enabled connector acquire an exclusive
  connector lease. Read-only grants may run concurrently.
- No task or tool retry occurs after a runtime emits its first tool or
  assistant event. If a completed model turn has tool evidence but no public
  text, the same session receives one conclusion-only recovery prompt with all
  tools denied; a second empty response fails the turn.

Workspace tools include `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`,
`PowerShell`, `NotebookEdit`, `LSP`, `ToolSearch`, `WebSearch`, and `WebFetch`.
`Skill`, connector MCP tools, and connector CLI tools are enabled only by the
member resource snapshot. `Agent`, `Task`, `TeamCreate`, `SendMessage`, and
nested-agent paths are always denied.

## Runtime and context

- Each `(roomId, memberId)` pair has an independent `ClaudeSession`, project
  directory, abort controller, transcript, and one-at-a-time execution queue.
  Runtime cache, abort, and dispose operations use both identifiers so equal
  imported member ids cannot cross room boundaries.
- The room public log is the canonical conversation. Member transcripts are
  private execution records and a performance cache.
- Every turn receives structured JSON containing the topic, member roster,
  room summary, completed public messages through `context_snapshot_seq`, and
  the member assignment.
- Parallel turns use the same context snapshot. Serial turns advance the
  snapshot after each completed public message.
- The first delivery to a member in each run uses full context from the active
  summary watermark. Later deliveries to that member in the same run may use
  a delta watermark; failed turns never advance it.
- Output message sequence slots are reserved at scheduling time so parallel
  results remain deterministic.
- Soft human intervention ends scheduling after the active serial turn. Hard
  intervention aborts active turns and hides interrupted output slots.
- Public messages contain conclusions and public questions. Tool calls,
  progress, errors, and usage stay in each member's execution transcript.
- Context compaction creates a summary projection and never deletes source
  messages. Summary failure pauses the room instead of silently truncating.

## Strict permission extension

Add one optional, backward-compatible ClaudeSession option:

```ts
shouldForceToolPermission(
  toolName: string,
  input: unknown,
  metadata: { readOnly: boolean },
): boolean | Promise<boolean>
```

When omitted, the current permission path must be byte-for-byte equivalent in
behavior. When it returns true, the runtime must invoke the supplied desktop
permission callback even if global rules or bypass mode would otherwise allow
the tool. Room permission responses never contain persistent permission
updates.

## UI

- Add a `rooms` main view and a single Group Rooms navigation item.
- `GroupRoomsView` owns its room list, selected room, events, drafts, and
  resource picker state; `App.tsx` only renders the view branch.
- The creation view reuses the Project resource picker for installed experts
  or teams, skills, and authorized connectors. It also accepts topic,
  workspace, and custom prompt members.
- The room center shows the public conclusion feed and host composer.
- Host messages show exactly which selected members execute the dispatch. The
  discussion/parallel mode, fixed-round or until-converged policy, moderator
  control, room permission, and selected recipients remain visible while a run
  is active.
- Discussion mode, stop policy, fixed round count, and room permission are
  persisted per room. The room-scoped values take effect before global
  defaults.
- Each room expands in the room list to show its members and live status.
  Selecting a member replaces the center feed with that member's execution
  transcript; there is no separate right-side conversation.
- The entire room/member list can collapse to a 48px rail. Public messages,
  member transcripts, controls, and the composer share the normal Session
  `1180px` content track so their visible left and right edges stay aligned.
- Member execution is adapted to the normal Session transcript model and
  rendered by the shared `MessageListPane`, `ToolCallGroup`, and tool result
  components. Tool-display changes therefore apply to normal sessions and room
  member execution together.
- Member connector and skill configuration reuses the Project resource picker
  in a focused modal.
- Parallel dispatch lets the host select members and provide separate
  assignments.
- Connector approvals identify the room, member, connector, tool, and redacted
  input.

## Implementation checklist

### Phase 0: contract and runtime spike

- [x] Capture regression tests for existing ClaudeSession permission behavior.
- [x] Add and test the optional strict tool permission callback.
- [x] Prove two independent sessions can load different selected connector MCP
      configurations without leaking servers or credentials.
- [x] Prove abort, dispose, transcript isolation, and concurrent permission
      requests.

### Phase 1: isolated foundation

- [x] Add the default-off desktop feature flag.
- [x] Add independent data layout helpers and versioned SQLite migrations.
- [x] Implement RoomStore CRUD, transactions, sequence reservation, recovery,
      and deletion lifecycle.
- [x] Register room IPC and preload APIs without changing existing Session IPC.
- [x] Add the `rooms` main view and an empty feature-gated GroupRoomsView.

### Phase 2: experts and expert teams

- [x] Export the existing installed-assistant listing as a read-only helper
      without changing its IPC response.
- [x] Implement RoomResourceCatalog and safe prompt resolution.
- [x] Expand expert teams into member definitions with a shared charter.
- [x] Persist invitation snapshots, source hashes, skills, and update state.
- [x] Build the room creation and invitation UI.

### Phase 3: serial room execution

- [x] Implement member runtime registry and deterministic context builder.
- [x] Implement manual speaker selection and round-robin conversation.
- [x] Persist public conclusions and private execution records.
- [x] Implement soft and hard human intervention.
- [x] Build the public feed, expandable room/member tree, host controls, and
      central shared execution transcript.

### Phase 4: connectors and permissions

- [x] Implement room connector pool and per-member resource grants.
- [x] Resolve selected MCP servers, credential env, connector directories, and
      exact skill allowlists only in the main process.
- [x] Implement strict tool validation, one-time approvals, timeout, redaction,
      and cancellation.
- [x] Implement expired-auth pause and existing Connector Hub handoff.
- [x] Implement connector resource fingerprints and runtime refresh at run
      boundaries.

### Phase 5: parallel orchestration

- [x] Implement fan-out with a shared context snapshot.
- [x] Reserve output slots and publish fan-in results in stable member order.
- [x] Add global, room, and member concurrency limits with FIFO fairness.
- [x] Add read/write connector leases and all-settled failure handling.
- [x] Build parallel assignment and progress UI.

### Phase 6: hardening

- [x] Add context summaries and token/turn/time termination policies.
- [x] Add startup, window-close, delete, crash, and orphan-directory recovery.
- [x] Add event revision and stream/trace-offset gap recovery.
- [x] Add resource uninstall/update and resume-failure behavior.
- [x] Run regression, security, renderer, store, and mocked-runtime smoke tests.
- [x] Keep the flag default-off and expose explicit enablement from Group Chat,
      so existing desktop behavior is unaffected until the user opts in.
- [x] Run paid real-model and real-connector smoke tests against the user's
      existing Moss resources and credentials without a temporary home.

## Acceptance gates

- Feature off: no Room database, Runtime, or changed Session behavior.
- A room never appears in Session, Project, Cron, Feishu, Audit, Fork, or
  remote-direct APIs.
- An expert team expands completely with correct member prompts and charter.
- An ungranted member cannot discover or call another member's connector.
- Credentials and raw authorization material do not enter IPC, logs, messages,
  snapshots, or tool-trace UI.
- Parallel write access to the same connector never overlaps.
- Public feed contains conclusions; private member view contains tool records.
- Soft and hard intervention preserve deterministic message causality.
- Crash recovery never replays an uncertain connector or tool operation.
- Existing Chat, Assistant, Project Coordinator, Connector, Cron, Feishu, and
  Audit workflows pass their regression suite unchanged.

Verification commands:

```sh
bun test
bun run --cwd ui check
bun run --cwd ui build:renderer
bun run --cwd ui build:direct
```

Verified on 2026-09-02:

- `757` repository tests passed with `0` failures.
- Group Room targeted tests passed `29/29`; the Node SQLite/controller suite
  contains `18` lifecycle, dynamic-round, convergence, intervention, recovery,
  race, trace, and permission cases.
- TypeScript and Node syntax checks passed.
- Renderer and `electron-direct` production builds passed.
- Real `~/.moss` Electron CDP tests covered six scenario groups: custom serial
  challenge, six-member expert-team expansion, AI-moderated parallel work,
  exact custom-member Skill use, expired connector authorization, and a true
  two-turn hard interruption.
- A separate real code-review room invited an installed expert plus a custom
  reviewer, completed two discussion rounds and four turns, inherited global
  allow-all with zero prompts, used real Bash/Read tools, and produced private
  traces plus public challenge/revision conclusions.
- The locally marked-connected Lexiang, Tencent Docs, QQ Mail, and Baidu
  Netdisk accounts all reported expired remote authorization. Every attempt
  paused the room, linked to Connector Hub, and published no Agent conclusion;
  the run was not counted as a successful connector read.
- UI automation covered room creation/deletion, the shared expert/skill/
  connector resource picker, custom prompts, member grants, 5-round settings,
  expandable room members, central shared execution transcripts, moderator
  suggestions, persistent running controls/recipients, permissions, stop from
  the permission modal, paused recovery, and desktop/390px compact layouts
  without horizontal overflow.
- A fresh real code-review room completed all four dynamically appended turns
  across two members and two rounds. Its turns recorded `36`, `10`, `8`, and
  `2` real tool events; the shared Session renderer displayed those Bash/Read
  records in the center view without a right-side member conversation.
- Reusable real-client coverage lives in `ui/scripts/group-room-e2e.mjs`.
