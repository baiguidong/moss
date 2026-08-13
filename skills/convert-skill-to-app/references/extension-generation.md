# Moss Extension Generation

## Contents

1. Generated layout
2. Manifest contract
3. Action registration
4. Process and path safety
5. App Builder wiring contract
6. Installation

## Generated Layout

Place the dedicated development Extension inside the App source tree:

```text
apps/<app-name>/extension/
├── extension.moss.json
├── package.json
├── src/
└── dist/extension.js
```

Omit `package.json` and `src/` when a small, dependency-free ESM `dist/extension.js` is clearer. The published App depends on the installed Extension; it does not load the nested development copy directly.

Use an Extension ID namespaced for Moss, normally `moss.<app-name>`, and start development versions at `1.0.0` unless the user supplies a version policy.

## Manifest Contract

Generate `extension.moss.json` in this shape:

```json
{
  "id": "moss.example-app",
  "version": "1.0.0",
  "main": "dist/extension.js",
  "contributes": {
    "commands": [
      { "name": "refresh", "title": "Refresh data" }
    ],
    "tools": [
      {
        "name": "search",
        "inputSchema": {
          "type": "object",
          "required": ["query"]
        },
        "permissions": []
      }
    ]
  }
}
```

Use commands for direct UI commands that do not benefit from schema metadata. Prefer tools for typed business actions. Keep `permissions` accurate as documentation, but do not assume the current Host enforces those values; enforce safety in the handler and UI as well.

The runtime registers local names and exposes full names as `<extension-id>.<local-name>`. Manifest and implementation names must agree exactly.

## Action Registration

Generate ESM with an exported `activate(context)` function:

```js
export function activate(context) {
  context.tools.registerTool('search', {
    inputSchema: {
      type: 'object',
      required: ['query']
    },
    handler: async (input) => search(input)
  })

  return {
    deactivate() {}
  }
}
```

Validate more strictly inside every handler than the current Host's shallow schema check. Reject unknown enum values, invalid numbers, empty required strings, malformed arrays, unsafe paths, and oversized inputs.

Return JSON-serializable data. Convert `Error`, `Buffer`, streams, child processes, database handles, and cyclic values before returning.

## Process and Path Safety

Never register generic actions such as:

- `runShell`
- `executeCommand`
- `executeCode`
- `runScript` with a caller-provided script
- `spawn` with a caller-provided executable

When an existing Skill script is the correct implementation, prefer binding it behind a business action instead of rewriting it:

```js
spawn(PYTHON, [SCRIPT, 'search', '--kb', kb, query], {
  cwd: SKILL_DIR,
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe']
})
```

Keep the executable, script, subcommand, and supported flags fixed in generated code. Construct an argument array from individually validated values. Set a timeout or termination policy for long-running actions and limit captured output.

Read and preserve the selected script's local dependency closure. If the Skill already implements connection pooling, server scoring, retry/fallback, cleanup, pagination, caching, or typed domain errors, do not replace it with a simpler inline program. If portability requires bundling, copy the complete required module closure and record file fingerprints. If reimplementation is unavoidable, map every replaced source file and add executable equivalence tests for representative success, edge, and failure cases.

Resolve user paths with `path.resolve`. For operations intended to stay within a root, reject paths whose `path.relative(root, candidate)` starts with `..` or is absolute. Treat symlinks explicitly when files are opened or written.

Do not forward the entire process environment to third-party programs when a smaller allowlist is sufficient. Never return credential values to the UI.

For external services:

- Treat documented hosts and endpoints as examples unless the Skill explicitly guarantees them.
- Preserve existing retry and endpoint-selection behavior.
- Bound retries by total time as well as count.
- Return attempted endpoint summaries without leaking credentials.
- Distinguish dependency missing, DNS/connectivity failure, authentication failure, service rejection, empty data, and malformed response.
- Never convert an empty or malformed result into `ok: true` merely because the transport call returned.

Use preview or dry-run behavior before destructive operations when the target implementation supports it. Otherwise require an explicit boolean confirmation field and render a host-visible confirmation in the App.

## App Builder Wiring Contract

Return the exact installed Extension contract to the App Builder. The required App manifest fragment should have this shape:

```json
{
  "capabilities": {
    "storage": true,
    "commands": ["moss.example-app.refresh"],
    "tools": ["moss.example-app.search"]
  },
  "extensionDependencies": {
    "moss.example-app": "^1.0.0"
  }
}
```

Do not write this fragment or the UI calls from this toolkit. Tell the App Builder to declare the same full names in its capabilities and UI calls and never use wildcard capabilities.

Include these runtime requirements in the handoff: the App Builder must call `window.mossApp.extensions.getStatus()` at startup and inspect `status.extensions[extensionId].state`; only an exact `active` state is connected. A missing entry, `error` state, rejected request, or absent Host API is unavailable and must retain its diagnostic. A resolved status request alone is not proof that the Extension loaded. Recommend `mossApp.events.on('extensions', callback)` when live status changes matter.

The handoff may reference only current Host methods: `app.getInfo/getVersions`, `extensions.getStatus`, `fs.readText`, `storage.getItem/setItem/removeItem/list`, `commands.execute`, `tools.call`, and `events.on`. Do not propose aliases such as `storage.get`, `storage.set`, or `fs.readFile`.

## Installation

The current Moss build resolves dependencies from installed Extension directories under `~/.moss/extensions/<id>/<version>/`. Use `scripts/install_extension.py` from this converter Skill to preview and install the generated development Extension.

Complete installation before returning a release-ready handoff, because the App Builder's later `moss(app_build)` call will fail when `extensionDependencies` is unsatisfied. Treat App and Extension as a paired deliverable when reporting readiness.

After installation, execute the generated test plan against the installed path. A source-only test does not prove the App will load the installed copy. When code changes, increment the Extension patch version and tell the App Builder to update the App dependency rather than silently replacing different code under the same version.
