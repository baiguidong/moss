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
  "hostApi": "^2.1.0",
  "backend": {
    "entry": "dist/backend/main.mjs",
    "runtime": "node",
    "apiVersion": 1,
    "lifecycle": "on-demand",
    "protocols": [],
    "actions": [{
      "name": "search",
      "inputSchema": "schemas/search.input.json",
      "outputSchema": "schemas/search.output.json"
    }]
  },
  "permissions": []
}
```

Use `persistent` only for services that must receive events or maintain a long-lived connection. Each App has one Host-managed Backend. Backend dependencies must be bundled into `dist`; installed Apps run no install scripts.

A `persistent` Backend starts after installation and remains alive while Moss is running. Declare required Host protocols as a flat array, for example `"protocols": ["moss.platform/v1", "moss.agent/v1"]`.

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

Enabled Apps with a UI appear automatically in the Host's More menu, with one entry per App. Do not declare view placement or implement sidebar shortcuts. The first authorized view by `order` supplies the opening route; Apps without view declarations open their UI entry directly. Keep other page navigation inside the App.

App UI uses only scoped V2 methods: `app.getInfo/getVersions/getInstallationState`, `instances.list/update/setEnabled/clearCredentials/getStatus`, `actions.invoke/cancel`, `storage.*`, and `events.on`. The compatibility method `instances.list()` returns the App's one Host-managed Backend record; use its ID to invoke a declared action by local name. There are no create or remove methods. App Center provides the App enable switch, restart and logs. Apps with their own settings page maintain configuration there; other Apps use the App Center configuration form.
