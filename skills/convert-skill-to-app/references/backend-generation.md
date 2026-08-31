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
  "hostApi": "^1.0.0",
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "on-demand",
    "instanceMode": "single",
    "targets": ["desktop", "server"],
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
