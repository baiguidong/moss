# Generated Host contracts

Source: `src/execution.mjs`, `src/mcp.mjs`. Run `node scripts/generate.mjs --check` in CI.

| Protocol / method | Permission | Input fields (* required) | Caller | Semantics / limits |
| --- | --- | --- | --- | --- |
| moss.tasks/v1 / task.create | tasks:write | idempotencyKey*, title*, route, limits | ui, backend | idempotency: key |
| moss.tasks/v1 / task.get | tasks:read | taskId* | ui, backend |  |
| moss.tasks/v1 / task.list | tasks:read | offset, limit | ui, backend |  |
| moss.tasks/v1 / task.update | tasks:write | taskId*, revision*, summary, progress | ui, backend |  |
| moss.tasks/v1 / task.finish | tasks:write | taskId*, revision*, status*, summary, result | ui, backend | {"resultPreviewBytes":32768} |
| moss.tasks/v1 / task.cancel | tasks:cancel | taskId*, reason | ui, backend |  |
| moss.tasks/v1 / task.resume | tasks:write | taskId*, revision* | ui, backend |  |
| moss.agent-execution/v1 / capabilities | execution:read | {} | ui, backend |  |
| moss.agent-execution/v1 / execution.start | execution:run | scopeRef*, idempotencyKey*, contextKey*, prompt*, outputSchema*, agentType, resources, timeoutMs | ui, backend | idempotency: key |
| moss.agent-execution/v1 / execution.get | execution:read | executionId* | ui, backend |  |
| moss.agent-execution/v1 / execution.list | execution:read | taskId* | ui, backend |  |
| moss.agent-execution/v1 / execution.cancel | execution:cancel | executionId*, reason | ui, backend |  |
| moss.agent-execution/v1 / execution.events | execution:read | executionId*, afterSequence, limit | ui, backend | {"eventHistory":2000} |
| moss.agent-execution/v1 / execution.result.read | execution:read | resultRef*, offset, limit | ui, backend | utf16-code-unit; {"chunkUnits":100000} |
| moss.mcp/v1 / servers.list | mcp:read | {} | ui, backend | {"servers":100,"configBytes":65536} |
| moss.mcp/v1 / servers.save | mcp:manage | name*, previousName, enabled*, config* | ui, backend | {"servers":100,"configBytes":65536} |
| moss.mcp/v1 / servers.remove | mcp:manage | name* | ui, backend | {"servers":100,"configBytes":65536} |
| moss.mcp/v1 / servers.set-enabled | mcp:manage | name*, enabled* | ui, backend | {"servers":100,"configBytes":65536} |
| moss.mcp/v1 / servers.inspect | mcp:connect | name* | ui, backend | {"servers":100,"configBytes":65536} |
| moss.mcp/v1 / auth.start | mcp:auth | name* | ui, backend | {"servers":100,"configBytes":65536} |
| moss.mcp/v1 / auth.clear | mcp:auth | name* | ui, backend | {"servers":100,"configBytes":65536} |
