# Moss Unified App Runtime Plan

## Status

- Implemented through Phase 9 on 2026-08-31.
- The implementation includes Manifest V2, public App SDK, shared App Runtime, Desktop and Server hosts, App Center management, remote deployment moves, Extension removal, hardening tests, and operational documentation.
- Verified against the App platform, App window lifecycle, scoped preload APIs, App build and publish workflow, Apps panel, Server restart/lease behavior, and packaged Electron resources.
- The project has not been released, so this plan deliberately does not preserve the current App or Extension schema for compatibility.
- Connector and Feishu code are explicitly out of scope.

## Goal

Evolve the existing Moss App into the only user-visible installable extension model, with optional UI and an optional out-of-process Backend that can run on demand or persist independently of App windows on Desktop or Moss Server.

The platform must support:

- UI-only Apps with no background process.
- Backend-only Apps with no custom UI.
- Apps with both UI and Backend.
- On-demand single-instance Backend workers.
- Persistent single-instance Backend workers.
- Persistent multi-instance Backend workers.
- App and instance enable switches.
- Versioned install, update, rollback, and uninstall entirely through client UI.
- The same Backend package and runtime contract on Desktop and Moss Server.
- Future domain protocols, such as an IM channel protocol, without putting platform-specific concepts into the base App Runtime.

## Non-goals

This plan does not change or redesign:

- Connector catalog, package format, or installation.
- `~/.moss/connectors`.
- MCP, CLI, Skills, Connector credentials, or Connector authentication.
- Project or session Connector selection.
- Connector Hub UI.
- Feishu Adapter code, configuration, storage, UI, or deployment.
- Existing Agent and Session protocols.
- A sandbox for untrusted third-party native code in the first release of App Runtime V2.

## Current-state findings

The current implementation cannot host a general background App safely or consistently:

1. `app.moss.json` schema version 1 requires a UI `entry`, so a Backend-only App cannot be represented.
2. App backend capabilities are provided through separately installed Extensions and `extensionDependencies`.
3. Extension code is dynamically imported into Electron Main by `ExtensionHost`.
4. Each App window owns its own `ExtensionHost`; closing the window disposes that Host.
5. Multiple App windows can create duplicate Extension runtimes.
6. App build and publish generate `extension-lock.json` and require installed Extension directories.
7. App preload exposes `extensions`, `commands`, and `tools` APIs tied to ExtensionHost.
8. Apps panel status is derived from Extension dependency resolution rather than a durable App Backend runtime.
9. Moss Server has no App package store, instance store, process supervisor, or App management API.
10. The current App storage is App-scoped and window-oriented, not instance-scoped.
11. Current package checksums cover built UI output but do not define a complete independently installable App artifact contract.

## Final product concepts

Only `App` is a user-visible product and installation concept.

The following are internal runtime records, not additional product types:

| Record | Meaning |
| --- | --- |
| App Package | Immutable code and manifest for one App version |
| App Installation | The active version and master enabled state on one Host |
| App Instance | One configured Backend instance, such as one account or one bot |
| App Deployment | The desired runtime placement and generation for one instance |
| App Process | The actual child process for one active deployment |

`Extension` is removed as a separately installed runtime concept. Reusable source code becomes a normal build-time package. Existing Extension commands and tools become App Backend actions.

`Connector` remains an independent product subsystem. It is not an App capability in this plan.

## Key decisions

These decisions are fixed for App Runtime V2:

1. An App declares at most one optional Backend entry.
2. A Backend can have one or many configured instances.
3. UI and Backend are independently optional, but at least one must exist.
4. Backend code always runs out of process. Moss never dynamically imports App Backend code into Electron Main or Moss Server.
5. A Backend process does not imply an HTTP server and does not receive a listening port by default.
6. Multiple windows for the same App share the same published Backend instances.
7. Preview Backends are isolated, temporary, and never restored after preview closes.
8. App installation does not automatically start persistent code.
9. App master enable and instance enable are separate desired states.
10. Configuration changes restart a running Backend in V2. Hot reload is deferred.
11. Each instance processes actions serially by default.
12. Product operations are available through client UI only. Internal build scripts and tests are not customer operations.
13. The same App artifact is installed independently on Desktop and Server.
14. Desktop does not upload arbitrary executable code to Server. Server obtains a known App version from the configured App source.
15. Dependencies required by a Backend are bundled at build time. Runtime `npm install` and package lifecycle scripts are prohibited.

## App manifest V2

The single manifest remains `app.moss.json`.

```json
{
  "schemaVersion": 2,
  "id": "example.app",
  "version": "0.1.0",
  "displayName": "Example",
  "description": "Example App",
  "icon": "assets/icon.png",
  "hostApi": "^1.0.0",
  "ui": {
    "entry": "dist/ui/index.html",
    "window": {
      "width": 1100,
      "height": 760,
      "resizable": true
    }
  },
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "persistent",
    "instanceMode": "multiple",
    "targets": ["desktop", "server"],
    "actions": [
      {
        "name": "settings.get",
        "inputSchema": "schemas/actions/settings-get.input.json",
        "outputSchema": "schemas/actions/settings-get.output.json"
      }
    ],
    "configuration": {
      "schema": "schemas/config.schema.json",
      "secrets": "schemas/secrets.schema.json"
    }
  },
  "permissions": []
}
```

### Manifest validation

- `schemaVersion` must equal `2`.
- `id` must be a stable lowercase Moss identifier.
- `version` must be valid semantic versioning.
- At least one of `ui` or `backend` must exist.
- `ui.entry`, `backend.entry`, schema paths, and icon paths must be relative paths inside the package.
- Real paths must remain inside the package after resolving symbolic links.
- V2 accepts only `runtime: "node"`.
- `lifecycle` accepts only `on-demand` or `persistent`.
- `instanceMode` accepts only `single` or `multiple`.
- `targets` must contain at least one of `desktop` or `server`.
- Backend action names must be unique within the App.
- Action input and output schemas must be valid JSON Schema.
- Backend-only Apps must provide configuration metadata sufficient for the generic App management UI.
- UI-only Apps keep their App installation record, but must not create Backend instance, deployment, or process records.

## Package layout

```text
example-app/
├── app.moss.json
├── package.json
├── assets/
├── schemas/
├── src/
│   ├── ui/
│   └── backend/
└── dist/
    ├── ui/
    │   └── index.html
    └── backend/
        └── main.mjs
```

The installed package remains immutable under:

```text
~/.moss/apps/<app-id>/versions/<version>/
```

App data and runtime data are separate from package code:

```text
~/.moss/apps-data/<app-id>/shared/
~/.moss/apps-data/<app-id>/instances/<instance-id>/
~/.moss/apps-runtime/<app-id>/<instance-id>/
```

Secrets are never stored in these JSON or data directories. They are stored in the existing encrypted Credential Vault under an App-instance scope.

## Build artifact and installation

An installable App archive is a ZIP containing:

- `app.moss.json`.
- `dist/`.
- Referenced schemas and assets.
- `checksums.json` containing hashes for every packaged file.
- Publisher and signature metadata when the App source supports signing.

Installation is performed from client UI:

1. Download or select an App archive through App Center UI.
2. Extract to a temporary staging directory.
3. Reject absolute paths, path traversal, symbolic links, duplicate paths, oversized files, and oversized archives.
4. Validate manifest, Host API compatibility, declared entries, schemas, and all checksums.
5. Atomically rename the staged directory into the immutable version directory.
6. Register the installed version without enabling Backend execution.
7. Display required permissions and configuration before an instance can be enabled.

No install hook, `postinstall`, shell script, or runtime dependency installation is executed.

## Runtime architecture

```text
App UI or App Center UI
        |
        v
Scoped App IPC API
        |
        v
App Runtime Host
├── Package Store
├── Installation Store
├── Instance Store
├── Deployment Store
├── Credential Adapter
├── Action Broker
├── Event Broker
├── Process Supervisor
└── Log Store
        |
        v
App Backend child process
```

The shared App Runtime is independent of Electron. Desktop and Server supply Host-specific adapters for storage, authentication, logging, package paths, and process environment.

## Runtime ownership

### App master state

An App installation has a persisted `enabled` desired state.

- Disabling an App stops all Backend deployments and rejects new App actions.
- A disabled App remains visible and its UI remains launchable so the user can inspect configuration and re-enable it.
- UI-only Apps do not show a Backend enable state.

### Single-instance Backend

- The Host creates a deterministic default instance record.
- The default instance is shared by all App windows.
- An `on-demand` default instance starts only when an action is invoked.
- A `persistent` default instance starts only when both App and instance are enabled.

### Multi-instance Backend

- Instances are explicitly created, named, configured, enabled, disabled, and deleted by the user.
- Each enabled deployment owns one child process.
- Configuration, secrets, data, logs, status, and action queues are isolated by instance ID.
- The App UI receives only instances belonging to its own App ID.

### Preview Backend

- Preview uses a generated preview deployment ID.
- Preview has isolated temporary data and no production secrets by default.
- Preview persistent mode is scoped to the preview session and stops when preview closes.
- Preview deployments are never restored after Moss restarts.

## Lifecycle state machine

Persisted desired state and observed runtime state are separate.

Observed state:

```text
stopped -> starting -> running -> stopping -> stopped
                    -> error
                    -> crash-loop
```

Rules:

- State transitions for one deployment are serialized.
- A process must complete protocol handshake before becoming `running`.
- Handshake timeout defaults to 15 seconds.
- Shutdown first sends a protocol request, then uses `SIGTERM`, then `SIGKILL` after bounded timeouts.
- Unexpected exits use exponential restart delays of 1, 2, 4, 8, 16, and at most 30 seconds.
- Five failures within five minutes enter `crash-loop`.
- Manual restart, configuration update, or version activation clears `crash-loop`.
- Moss shutdown stops workers with a global bounded timeout.
- Persistent enabled deployments are restored only after package and configuration validation on the next start.
- On-demand workers never exit while actions are pending and stop after a configurable idle timeout.

## Base App Service protocol

The transport uses a dedicated process IPC channel. Standard output and standard error are logs only.

All envelopes include:

```ts
type AppServiceEnvelope = {
  version: 1
  id: string
  type: string
  timestamp: number
  payload: unknown
}
```

Host to Backend messages:

- `service.init`
- `action.invoke`
- `action.cancel`
- `service.ping`
- `service.shutdown`

Backend to Host messages:

- `service.hello`
- `service.ready`
- `service.status`
- `action.result`
- `action.error`
- `event.emit`
- `service.pong`
- `log.write`

Protocol requirements:

- Strict schema validation in both directions.
- Request IDs and reply correlation.
- Configurable request timeouts.
- Maximum message size.
- Duplicate reply protection.
- Unknown message rejection.
- Per-instance action queueing.
- Cancellation propagation.
- Secret redaction in protocol errors and logs.
- App ID, version, Backend API version, instance ID, deployment generation, and one-time launch token in handshake.
- Stale process messages are rejected by deployment generation and launch token.

Future capability protocols, such as `moss.channel/v1`, use the same process and base lifecycle but define their own domain messages in App SDK. They are not part of this plan.

## Persistent data model

The logical model is shared by Desktop and Server even when their physical databases differ.

```text
app_installations
  app_id
  active_version
  enabled
  created_at
  updated_at

app_instances
  id
  app_id
  display_name
  config_json
  enabled
  created_at
  updated_at

app_deployments
  instance_id
  target_type
  target_id
  desired_state
  generation
  lease_owner
  lease_expires_at
  updated_at
```

Constraints:

- Single-instance Apps use a deterministic instance ID.
- Instance IDs are globally unique UUIDs for multi-instance Apps.
- An instance belongs to exactly one App ID.
- An active deployment references an installed compatible App version on its Host.
- Configuration is validated before persistence.
- Secret values are replaced with Vault references before configuration persistence.
- PID and observed runtime status are never treated as durable desired state.
- Server leases and fencing generations prevent duplicate processes on multiple Server nodes.

## Configuration and secrets

- Generic App Center UI renders configuration from the declared schema.
- Secret fields are defined by the separate secret schema.
- UI receives masked secret state, never plaintext stored values.
- Backend receives a validated configuration snapshot during `service.init`.
- Backend cannot write Moss configuration directly.
- Configuration updates increment deployment generation and restart the process.
- Removing an instance deletes its Vault scope only after the user confirms data deletion.
- Logs, errors, action inputs, action outputs, and audit events pass through secret redaction.

## App UI API

The published App UI receives a scoped `window.mossApp` API.

V2 API groups:

- `app.getInfo()`
- `app.getVersions()`
- `app.getInstallationState()`
- `instances.list()`
- `instances.create()`
- `instances.update()`
- `instances.setEnabled()`
- `instances.remove()`
- `instances.getStatus()`
- `actions.invoke()`
- `actions.cancel()`
- `storage.getItem()`
- `storage.setItem()`
- `storage.removeItem()`
- `storage.list()`
- `events.on()`

Security rules:

- Calls are scoped from sender WebContents to its App ID.
- An App cannot name another App ID in scoped APIs.
- Action names must be declared by the App manifest.
- Action input and output are schema validated.
- App UI cannot read arbitrary filesystem paths through an unscoped preload API.
- Multiple windows subscribe to the same App and instance events without creating duplicate Backend workers.

The following V1 APIs are removed after App V2 conversion:

- `extensions.getStatus()`
- `commands.execute()`
- `tools.call()`

## App Center UI

The existing Apps panel becomes the complete App management surface.

Required views and controls:

- Installed App list.
- App version and update status.
- UI presence and Backend presence.
- App master enable switch.
- Backend observed status and error summary.
- Open button only when UI exists.
- Add instance for multi-instance Apps.
- Configure, enable, disable, restart, and delete instance.
- Desktop or Server deployment target when supported.
- Instance logs with bounded retention.
- Declared permissions.
- Version history and rollback.
- Uninstall with separate choices for package, data, and credentials.

All customer installation and runtime actions occur through this UI. No product CLI is introduced.

## Desktop runtime

Desktop App Runtime starts during Electron application readiness, independently of App windows.

Responsibilities:

- Discover installed App packages.
- Validate active versions.
- Restore enabled local deployments.
- Spawn Node Backend bundles with a minimal environment.
- Keep Backend processes independent from App window lifecycle.
- Route scoped App UI actions and events.
- Emit App status changes to the main Renderer.
- Stop all workers during application shutdown.

Desktop process environment must not blindly copy secrets. Proxy and runtime environment variables require an explicit allowlist.

## Server runtime

Moss Server uses the same App Runtime package with Server adapters.

Responsibilities:

- Install known App versions from the configured App source.
- Ignore App UI and execute only Backends targeting `server`.
- Persist installations, instances, deployments, and leases.
- Enforce authenticated App management scopes.
- Restore enabled deployments after Server restart.
- Expose generic App installation, instance, deployment, status, restart, and log APIs.

Suggested authorization scopes:

- `apps:read`
- `apps:manage`
- `apps:deploy`
- `apps:logs`

The Desktop UI calls these APIs. Users do not operate Server Apps through a command line.

### Deployment move

Moving an instance between Desktop and Server is a two-phase operation:

1. Validate the target Host has the required App version.
2. Stop the current deployment and receive confirmation.
3. Persist the new target and increment generation.
4. Transfer validated non-secret configuration and secrets through authenticated APIs.
5. Start and health-check the target deployment.
6. Remove source secrets only after the target becomes healthy and the user confirms the move.

If the source cannot be stopped, the target does not start by default. The UI may offer an explicit force takeover with a clear duplicate-runtime warning.

## Version activation and rollback

Update is transactional at the App installation level:

1. Install and validate the new immutable version without activating it.
2. Record the prior active version.
3. Stop active Backend deployments.
4. Atomically set the new active version.
5. Restart deployments one by one and require successful handshake.
6. If any required deployment fails, stop new-version processes, restore the prior version, and restart prior deployments.
7. Report the failed update and retain the new package for diagnostics until the user removes it.

Rollback uses the same process with the selected older version.

App UI windows using an old version must close or reload before activation completes. Preview windows are unaffected.

## Uninstall

Uninstall behavior:

1. Disable the App master state.
2. Stop all local deployments with bounded forced termination.
3. Verify no owned process remains.
4. Remove installed package versions.
5. Remove installation and deployment records.
6. Ask separately whether to remove App data and instance credentials.
7. Remote Server installations and deployments require explicit UI confirmation and authenticated remote operations.

Uninstall never silently deletes user data or credentials.

## Security boundary

Process isolation protects Moss from crashes and lifecycle errors, but it is not a filesystem or network sandbox.

V2 security policy:

- Only first-party or explicitly trusted App packages may declare a Backend until sandbox enforcement exists.
- App packages declare permissions before Backend enablement.
- App UI remains context-isolated with Node integration disabled.
- App Backend code never runs inside Electron Main or Server process.
- Backend receives a minimal environment and scoped protocol capabilities.
- Package integrity is verified before every activation after package changes.
- Backend paths cannot escape the immutable package root.
- Runtime and log directories cannot be executable entry sources.
- Logs are size limited, rotated, and redacted.
- Action input, output, timeout, and concurrency are bounded.
- A Host-wide process limit and per-App instance limit prevent accidental process exhaustion.

Untrusted marketplace Backend execution requires a later sandbox milestone and is not claimed by this plan.

## Extension absorption and removal

Extension removal happens only after equivalent App Backend actions work.

### Capabilities to absorb

- Extension commands become App Backend actions.
- Extension tools used by App UI become App Backend actions.
- Extension log calls use the App Service protocol.
- Reusable implementation code becomes a normal source dependency bundled into the Backend.

### Code and artifact removal

- Remove `ui/src/extension-host.mjs`.
- Remove `EXTENSIONS_DIR` and installed Extension discovery.
- Remove `extensionDependencies` from App manifest and UI types.
- Remove `extension-lock.json` from build, publish, preview, and version artifacts.
- Remove Extension status and activation from App window state.
- Remove `extensions`, `commands`, and `tools` from plugin App preload.
- Replace current command and tool IPC handlers with scoped App action handlers.
- Remove Extension dependency badges and panels from Apps UI.
- Rewrite the `convert-skill-to-app` toolkit to generate a self-contained App Backend rather than an App and Extension pair.
- Replace Extension test plans, installer scripts, and pair validation with App V2 package and Backend contract tests.
- Stop reading `~/.moss/extensions`.

No user configuration migration or V1 runtime compatibility layer is required because the product has not been released.

## Connector boundary

The following files and behaviors remain unchanged during this plan:

- `ui/src/connector-hub-ipc.mjs`.
- Connector catalog ZIP and catalog normalization.
- Connector credential storage.
- MCP and CLI setup.
- Connector Skills extraction.
- Connector selection in sessions and projects.
- Connector Hub UI and preload APIs.
- Connector actions already present in MossTool.

App Backend actions must not be exposed as Connector tools by default.

## Feishu boundary

No Feishu implementation is changed in this plan.

The future Feishu alignment point is intentionally limited to:

- One App package.
- Optional App UI.
- A `persistent` Backend.
- `instanceMode: "multiple"`.
- Desktop and Server targets.
- A future `moss.channel/v1` domain protocol layered on App Service protocol.

The Feishu migration must not be started until App Runtime V2 satisfies all completion gates below.

## Implementation phases

### Phase 0: Architecture and contract freeze

Deliverables:

- Architecture decision record for unified App, optional Backend, and Extension removal.
- Final App manifest V2 JSON Schema.
- Base App Service protocol schemas and error codes.
- Lifecycle, desired-state, update, rollback, and uninstall state machines.
- Reference App test matrix.

Gate:

- No unresolved field naming, process ownership, instance identity, or lifecycle decisions.
- Connector and Feishu boundaries approved.

### Phase 1: Shared App SDK and package validation

Deliverables:

- `packages/app-sdk` with protocol types, schemas, Backend Client, and test helpers.
- Manifest V2 parser and normalizer.
- Full package integrity and safe-path validation.
- UI-only, Backend-only, and combined manifest fixtures.

Gate:

- Invalid paths, schemas, versions, actions, and incompatible Host API versions fail before code execution.
- App SDK has no imports from `ui`, `server`, or Moss internal Session code.

### Phase 2: Shared App Runtime core

Deliverables:

- `packages/app-runtime` package store, installation store, instance store, deployment store, action broker, event broker, process supervisor, and log store.
- Host adapter interfaces for Desktop and Server.
- Reference Backend child process.
- Unit tests for all lifecycle transitions and failure paths.

Gate:

- UI-only fixture creates no process.
- On-demand fixture creates at most one shared process and exits after idle timeout.
- Persistent multi-instance fixture creates exactly one process per enabled instance.
- Window lifecycle has no effect on published Backend process ownership.

### Phase 3: Desktop integration

Deliverables:

- Global Desktop App Runtime initialization and shutdown.
- Desktop state and Credential Vault adapters.
- Scoped App UI preload and IPC V2.
- App status events to the main Renderer.
- Preview Backend isolation.

Gate:

- Closing all App windows does not stop persistent workers.
- Multiple windows do not create duplicate workers.
- App shutdown leaves no owned process.
- App UI cannot call another App's instance or action.

### Phase 4: App Center management UI

Deliverables:

- App master enable switch.
- Backend status and error presentation.
- Multi-instance CRUD and instance enable switches.
- Schema-driven configuration and secret fields.
- Restart and log views.
- UI-only and Backend-only App states.
- Update, rollback, and uninstall workflows.

Gate:

- Every customer operation can be completed in UI.
- Backend-only Apps never show a broken Open action.
- Destructive operations require explicit confirmation and preserve data by default.

### Phase 5: Build, publish, install, and version activation

Deliverables:

- App V2 build output for UI and Backend.
- Complete checksums and archive validation.
- Immutable version installation.
- Transactional update and automatic rollback.
- Preview and extraction updates.
- App Builder and MossTool App schemas updated without changing Connector actions.

Gate:

- Failed install leaves no visible partial version.
- Failed Backend activation restores the prior working version.
- No runtime install script or dependency installation executes.

### Phase 6: Server runtime and client-driven deployment

Deliverables:

- Server App Runtime adapters and persistence.
- Authenticated generic App APIs.
- Server package acquisition by App ID and version.
- Lease and fencing implementation.
- Desktop UI remote management and move workflow.

Gate:

- Server deployment survives Desktop exit and Server restart.
- Multiple Server nodes cannot own the same deployment generation.
- An unreachable source does not cause an implicit duplicate deployment.

### Phase 7: Extension capability conversion

Deliverables:

- Existing App Extension commands and tools converted to Backend actions.
- App preload consumers migrated to V2 actions.
- App generation toolkit rewritten for self-contained Apps.
- Existing App workflows run without ExtensionHost.

Gate:

- No published or preview App requires `extension.moss.json`.
- No App code is dynamically imported into Electron Main.
- Equivalent action functionality passes contract tests.

### Phase 8: Extension removal

Deliverables:

- Delete ExtensionHost and Extension installation code.
- Delete Extension dependency lock generation and UI.
- Delete Extension-specific scripts, tests, and documentation.
- Remove unused App V1 types and APIs.

Gate:

- Repository search finds no active runtime path for `extension.moss.json`, `extensionDependencies`, or `extension-lock.json`.
- All App tests and builds pass with App V2 only.

### Phase 9: Hardening and release gate

Deliverables:

- Fault-injection tests.
- Process leak tests.
- Secret-redaction tests.
- Package tampering tests.
- Update and rollback recovery tests.
- Desktop and Server end-to-end tests.
- Final operational documentation.

Gate:

- All completion criteria below pass.
- Only after this gate may Feishu migration planning begin.

## Test matrix

Required reference Apps:

| Fixture | UI | Backend | Lifecycle | Instances | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ui-only` | Yes | No | None | None | Prove zero background process |
| `backend-only` | No | Yes | On-demand | Single | Prove generic UI management |
| `on-demand-single` | Yes | Yes | On-demand | Single | Action and idle shutdown |
| `persistent-single` | Yes | Yes | Persistent | Single | Restore and App switch |
| `persistent-multiple` | Yes | Yes | Persistent | Multiple | Isolation and process count |
| `crashing-backend` | Optional | Yes | Persistent | Single | Restart and crash-loop |
| `slow-backend` | Optional | Yes | On-demand | Single | Timeout and cancellation |

Required automated coverage:

- Manifest normalization and rejection.
- Package traversal, symbolic link, tampering, size, and checksum rejection.
- Installation atomicity.
- Instance identity and isolation.
- App and instance switch precedence.
- Single-instance deduplication.
- Multiple-window sharing.
- Preview isolation.
- Action validation, timeout, cancellation, duplicate replies, and serialization.
- Process handshake, health, graceful stop, forced stop, restart, and crash-loop.
- Config restart and stale-generation rejection.
- Log rotation and secret redaction.
- Update activation, automatic rollback, and manual rollback.
- Uninstall with and without data deletion.
- Desktop shutdown and restart restoration.
- Server restart restoration, lease expiry, and fencing.
- Scoped App UI authorization.
- Confirmation that Connector behavior and tests remain unchanged.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Every App accidentally consumes a process | Backend is optional; install does not start it; on-demand is idle-stopped |
| Multiple windows duplicate workers | Process ownership is global by deployment key, never by WebContents |
| Persistent crash loop harms Moss | Out-of-process execution, bounded restarts, crash-loop state |
| App update breaks running service | Staged install, health activation, automatic rollback |
| Secrets leak through config or logs | Vault references, IPC delivery, masking, centralized redaction |
| Stale process writes after restart | Deployment generation and one-time launch token |
| Desktop and Server implementations drift | One shared App Runtime with Host adapters and shared contract tests |
| Multiple Server nodes duplicate a deployment | Lease ownership and fencing generation |
| App UI escapes its scope | Sender-bound preload APIs and App/instance ownership validation |
| Package code changes after validation | Immutable version directories and checksum revalidation |
| Untrusted Backend accesses local resources | Trusted Apps only until a real sandbox is available |
| Extension removal breaks App Builder | Convert generator and fixtures before deleting ExtensionHost |
| Connector scope expands accidentally | Explicit file boundary and unchanged Connector regression suites |

## Final repository layout

```text
moss/
├── packages/
│   ├── app-sdk/
│   │   ├── src/protocol/
│   │   ├── src/client/
│   │   ├── src/schemas/
│   │   └── src/testing/
│   └── app-runtime/
│       ├── src/manifest/
│       ├── src/packages/
│       ├── src/state/
│       ├── src/process/
│       ├── src/actions/
│       ├── src/events/
│       ├── src/logging/
│       └── src/host/
├── ui/src/apps/
│   ├── desktop-app-runtime.mjs
│   ├── app-runtime-ipc.mjs
│   ├── app-preload.mjs
│   └── app-ui-protocol.mjs
├── server/src/apps/
│   ├── serverAppRuntime.ts
│   ├── appRoutes.ts
│   └── appAuthorization.ts
└── ui/tests/fixtures/apps/
    ├── ui-only/
    ├── backend-only/
    ├── on-demand-single/
    ├── persistent-single/
    ├── persistent-multiple/
    ├── crashing-backend/
    └── slow-backend/
```

Future independent App repositories depend only on `app-sdk` and App manifest V2. They must not import Moss internal source paths.

## Definition of done

App Runtime V2 is complete only when all of the following are true:

- App is the only user-visible extension and installation concept.
- UI-only Apps create zero background processes.
- Backend-only Apps are installable and fully manageable through generic client UI.
- Published persistent Backends survive all App windows closing.
- On-demand Backends start once, share across windows, and stop after idle timeout.
- Multi-instance Backends isolate config, secrets, data, logs, state, actions, and processes.
- App and instance enable switches restore correctly after restart.
- Electron Main and Moss Server never import App Backend modules.
- Desktop and Server use the same App SDK, App Runtime, manifest parser, and protocol tests.
- Failed installs, starts, updates, rollbacks, uninstalls, and Host shutdowns leave no partial package or orphan process.
- Server leases prevent duplicate deployment ownership.
- App UI operations are scoped to the owning App and instance.
- App artifacts execute no install scripts and require no runtime dependency installation.
- ExtensionHost, Extension package storage, Extension dependencies, and Extension lock artifacts are removed.
- Connector implementation, storage, UI, and tests remain unchanged.
- Feishu implementation remains unchanged.
- All customer App operations are available from client UI.
- A standalone App repository can build an App artifact using only public App SDK contracts.
