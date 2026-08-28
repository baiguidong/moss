# Feishu Adapter MVP Implementation Plan

## Goal

Adapt the Feishu Adapter to the current Moss desktop client and deliver two complete client-local workflows:

1. Moss pushes actionable message-center items to Feishu. A paired user can allow or reject the request on mobile, and Moss applies the result to the exact originating session.
2. A paired user can send a Feishu message to a newly created Moss session or select an existing writable Moss session and continue the conversation.

Moss Desktop must be running. The Adapter is a child process of Electron Main and does not depend on the standalone Moss server.

## Implementation Status

Completed on 2026-08-27.

- Stages 1-5 are implemented in the desktop Main process, Feishu Adapter, Renderer, and SQLite store.
- Stage 6 automated verification passes through the repository UI and Adapter suites, plus TypeScript/static checks and production builds.
- A real desktop launch completed the process IPC handshake and Feishu persistent WebSocket connection.
- A real hot restart left exactly one Main process and one Adapter child; the child exits when its IPC parent disconnects.
- Customer-facing mobile session navigation is implemented with bot-menu events and interactive cards: current session, recent/Feishu/project categories, pagination, form search, switch, create, and stop.
- Final handset acceptance remains with the user: first-message session creation, old-session selection, and allow/reject card interaction.

## MVP Scope

- Feishu private chats only.
- Paired users only.
- Text messages, new sessions, existing-session selection, stop, and current-session status.
- Existing sessions include Feishu sessions and writable top-level desktop/project sessions.
- Tool permission: allow once or reject.
- Plan approval: approve or reject.
- Actionable notification summaries only; full local diagnostics are never sent by default.
- No mobile permanent permission, direct `!shell`, group chat, or implicit project selection.
- Do not migrate legacy `adapters.json`; use the newly saved `settings.json` configuration and create fresh conversation bindings.

## Architecture

```text
Feishu mobile
    <-> Feishu Open Platform
    <-> Feishu Adapter child process
    <-> versioned Node process IPC
    <-> Electron Main AdapterGateway
          |- Session service and turn queue
          |- Notification broker
          `- Decision broker
    <-> Renderer
```

Electron Main owns all Moss state and execution. The Adapter owns Feishu transport, cards, and media APIs only.

## IPC Contract

Every message uses a versioned envelope:

```ts
type BridgeMessage = {
  version: 1;
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
};

type BridgeResponse = {
  version: 1;
  replyTo: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};
```

Adapter to Main commands:

- `bridge.hello`
- `pairing.attempt`
- `chat.message.received`
- `conversation.new`
- `conversation.list`
- `conversation.select`
- `session.abort`
- `decision.respond`
- `delivery.ack`
- `turn.delivery.ack`

Main to Adapter events:

- `bridge.ready`
- `turn.accepted`
- `turn.output`
- `turn.completed`
- `turn.failed`
- `notification.deliver`
- `decision.resolved`

## Persistence

Add the following state to the existing desktop SQLite database:

- `sessions.origin_channel`: immutable `desktop`, `feishu`, or `cron` source.
- `external_conversations`: paired Feishu conversation and active Moss session binding.
- `external_events`: durable Feishu event idempotency and processing result.
- `session_turn_queue`: ordered Main-owned turns from Renderer or Adapter.
- `app_notifications`: authoritative message-center records with separate desktop and mobile content.
- `notification_deliveries`: recipient, Feishu message/card IDs, attempts, and delivery state.
- `decision_requests`: actionable request type, session, safe mobile content, status, expiry, and resolution source.

Important constraints:

- `(adapter_instance_id, event_id)` is unique.
- `(adapter_instance_id, tenant_key, chat_id)` is unique.
- A decision transition from `pending` to `resolving` uses compare-and-set semantics.
- Runtime-only decisions expire when their runtime or client exits.
- Durable plan decisions are revalidated against current session state before execution.

## Conversation Behavior

- The first normal Feishu message with no active binding creates a new session and submits the message atomically at the idempotency boundary.
- The bot menu and session-center card are the primary customer entry points; no session ID is shown or required.
- The card supports recent, Feishu, and project categories, pagination, keyword search, session selection, and new-session creation.
- Natural-language entries such as `会话中心`, `切换会话`, `新会话`, and `当前会话` open the same customer workflows.
- `/new [title]`, `/sessions [query]`, and `/current` remain as compatibility aliases.
- Selecting a session changes only the active binding. It does not change an existing session's origin.
- `/current` reports the active session and queue state.
- `/stop` aborts the active session and cancels its queued turns.
- Normal messages enqueue against the active session. Main preserves order while the session is busy.
- Replies for Feishu-originated turns return to the originating Feishu conversation.
- Terminal replies are marked delivered only after Adapter acknowledgement and use the turn ID as Feishu's idempotency key.
- Normal chat never calls the project list API. Project information is accessed only by explicit commands.

## Actionable Notification Behavior

1. Main creates a `decision_request` and a linked message-center notification.
2. Renderer displays it and Adapter receives a safe `decision.deliver` event.
3. Adapter sends a Feishu card and acknowledges its `message_id/card_id`.
4. The user chooses allow or reject.
5. Adapter validates the paired operator and sends `decision.respond` with the one-time action token.
6. Main validates user, conversation, session, token hash, status, and expiry.
7. Main atomically claims the request and invokes its registered decision handler.
8. Main updates Renderer and the Feishu card with the final state.

Mobile payloads contain an allowlisted title and summary. Stack traces, tokens, local paths, complete tool input, and desktop-only details remain local.

## Implementation Stages

### Stage 1: Main bridge and storage

- Add schema migrations and persistence helpers.
- Add a versioned AdapterGateway around the child process IPC channel.
- Add handshake, request correlation, timeout, readiness, and shutdown handling.
- Add durable event idempotency.

### Stage 2: Session routing

- Extract reusable session create/send/abort functions from Electron IPC handlers.
- Move the canonical busy-session queue into Main.
- Add external conversation binding and writable-session listing.
- Replace Feishu HTTP/WebSocket server routing with the process bridge.
- Implement `/new`, `/sessions`, `/current`, and `/stop`.

### Stage 3: Message center

- Move notification persistence and deduplication to Main.
- Keep the existing Renderer UI through list/change IPC APIs.
- Add mobile-safe content and delivery tracking.
- Deliver pending actionable notifications when Adapter becomes ready.

### Stage 4: Decisions

- Add decision-handler registration for tool permission, plan approval, and binary confirmation.
- Replace native-only permission blocking with the shared broker while retaining desktop UI.
- Add signed one-time action tokens and compare-and-set resolution.
- Update both desktop and Feishu after resolution, expiry, abort, or failure.

### Stage 5: UI and operational status

- Add the Feishu session group without overloading `sessionKind`.
- Show Adapter child/IPC/Feishu connection state in settings.
- Remove legacy server URL and implicit project-directory behavior from the client Adapter flow.

### Stage 6: Verification

- Unit-test migrations, bindings, event idempotency, queue ordering, decisions, delivery retry, and sanitization.
- Contract-test both ends of process IPC.
- Test unauthorized, duplicate, expired, and concurrent card responses.
- Build the Adapter and Renderer.
- Start Moss Desktop and verify the actual Feishu long connection and both mobile workflows.

## Acceptance Criteria

- A first Feishu message creates exactly one Feishu-origin session and receives a response.
- `/sessions` can select a writable old session; subsequent messages continue that session after restart.
- Busy-session messages execute in order without being dropped.
- Normal messages never request a project list.
- An actionable message-center item reaches Feishu once.
- Allow resumes the exact waiting action; reject returns a denial to the exact waiting action.
- Desktop and mobile concurrent responses produce one winner.
- Duplicate Feishu events and duplicate card callbacks never repeat execution.
- Unauthorized and expired callbacks are rejected.
- Feishu payloads contain no secrets, stack traces, local paths, or full tool inputs.
- Missing configuration does not start the Adapter; saving valid configuration starts it.
- Quitting Moss stops the Adapter; restarting Moss reconnects and retries pending deliveries.
