# Moss App Backend Generation

## Layout

The Backend is part of the App package:

```text
apps/<app-name>/
├── app.moss.json
├── schemas/
├── src/backend/
└── dist/backend/main.mjs
```

`app.moss.json` uses schema version 2. `backend` is optional and singular. A Backend-only App omits `ui`; a UI-only App omits `backend`.

## Manifest

```json
{
  "schemaVersion": 2,
  "id": "example.app",
  "version": "0.1.0",
  "displayName": "Example",
  "hostApi": "^2.0.0",
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "on-demand",
    "instanceMode": "single",
    "targets": ["desktop"],
    "actions": [{
      "name": "search",
      "inputSchema": "schemas/search.input.json",
      "outputSchema": "schemas/search.output.json"
    }]
  },
  "permissions": []
}
```

Use `persistent` only for services that must receive events or maintain a long-lived connection. Use `multiple` only when users need isolated named configurations. Backend dependencies must be bundled into `dist`; installed Apps run no install scripts.

Use the smallest deployment target set that satisfies the product requirement:

- Default to `["desktop"]`.
- Add `server` only for an explicit always-on or unattended placement requirement. Most Apps should remain Desktop-only. Server logic may differ from Desktop logic, but it must run without Electron, a window, desktop-local paths, or another concurrently running Backend.
- Use `["server"]` only when the Backend must always run on Server. UI presence is independent from Backend placement; UI calls a logical instance and the Host routes it to the active deployment.

Do not infer a target from unrelated properties: UI presence does not require a Desktop Backend; Backend presence, `persistent` lifecycle, network access, and possible future deployment do not require Server. A Desktop UI with `["server"]` is valid. When the requirement is ambiguous, keep `["desktop"]`.

`targets` is a set of alternative placements, not cooperating process roles. `["desktop", "server"]` does not mean two processes, frontend/backend, replication, failover, synchronization, or cross-target division of responsibility. One App instance is active on Desktop or Server at a time. The Host exposes Server migration only when `server` is present. Target-specific branches may differ substantially but must operate independently.

Declare `backend.protocols` per target, for example `{"desktop": ["moss.desktop/v1"], "server": ["moss.agent/v1"]}`. Each key must also be present in `targets`; do not use the legacy shared-array form for new Apps. Never declare `moss.desktop/v1`, `moss.openim/v1`, or `moss.remote/v1` for `server`.

## Entry

Use the public SDK:

```js
import { defineAppBackend } from '@moss/app-sdk'

defineAppBackend({
  search: async (input, context) => {
    context.log('info', 'Search started')
    return searchValidatedInput(input, context.signal)
  }
})
```

Action names must exactly match the manifest. Validate JSON Schema plus domain constraints. Respect cancellation. Results and errors must be JSON serializable. Standard output/error are logs, not protocol transport.

## Process Safety

Bind stable business operations, never generic execution. When wrapping a Skill script, fix the executable, script, subcommand, and flags in Backend code. Build argument arrays from individually validated fields with `shell: false`. Bound time, retries, and captured output. Preserve relevant local dependency behavior such as paging, failover, cleanup, caching, and typed errors.

Resolve paths against an explicit allowed root and reject traversal and symlink escapes. Pass a minimal environment. Do not expose secret values in results, errors, or logs.

## UI Contract

App UI uses only scoped V2 methods: `app.getInfo/getVersions/getInstallationState`, `instances.*`, `actions.invoke/cancel`, `storage.*`, and `events.on`. UI calls a declared action by local name and selects an instance belonging to the same App. Backend status and instance configuration remain generic App Center responsibilities.
