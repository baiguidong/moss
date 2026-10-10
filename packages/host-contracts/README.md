# Generated Host contracts

Source: `src/*` contract modules. DTO definitions: [generated types](src/generated.d.mts). Run `node scripts/generate.mjs --check` in CI.

| Protocol / method | Permission | Input fields (* required) | Caller | Semantics / limits |
| --- | --- | --- | --- | --- |
| moss.tasks/v1 / task.create | tasks:write | idempotencyKey*, title*, route, limits | ui, backend | idempotency: key |
| moss.tasks/v1 / task.get | tasks:read | taskId* | ui, backend |  |
| moss.tasks/v1 / task.list | tasks:read | cursor, limit | ui, backend |  |
| moss.tasks/v1 / task.changes | tasks:read | afterCursor, limit | ui, backend | {"retentionMs":604800000,"maxChanges":10000} |
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
| moss.local-files/v1 / pick | local-files:pick | kind, multiple | ui, backend |  |
| moss.local-files/v1 / open | local-files:open | path* | ui, backend |  |
| moss.local-files/v1 / reveal | local-files:open | path* | ui, backend |  |
| moss.runtimes/v1 / python.get | null | {} | ui, backend |  |
| moss.platform/v1 / file.pick | platform:files | kind, multiple | ui, backend | {"fileBytes":104857600,"inlineBase64Length":524288,"pickedFiles":100,"imageDimension":4096} |
| moss.platform/v1 / file.materialize | platform:files | fileName*, dataBase64*, transferId, offset, complete | ui, backend | byte; {"fileBytes":104857600,"inlineBase64Length":524288,"pickedFiles":100,"imageDimension":4096} |
| moss.platform/v1 / file.thumbnail | platform:files | path*, width, height | ui, backend |  |
| moss.platform/v1 / file.download | platform:files | url*, fileName* | ui, backend | {"fileBytes":104857600} |
| moss.platform/v1 / screen.capture | platform:screen-capture | {} | ui, backend |  |
| moss.platform/v1 / shell.open-external | platform:external-links | url* | ui, backend |  |
| moss.audit/v1 / source.capture | audit:read | {} | ui, backend |  |
| moss.audit/v1 / session.open | audit:navigate | sessionId*, toolUseId | ui, backend |  |
| moss.audit/v1 / notification.publish | audit:notify | id*, severity*, title*, message*, details | ui, backend |  |
| moss.trace/v1 / status | trace:capture | {} | ui, backend |  |
| moss.cloud-storage/v1 / status.get | cloud-storage:read | {} | ui, backend |  |
| moss.cloud-storage/v1 / quota.get | cloud-storage:read | {} | ui, backend |  |
| moss.cloud-storage/v1 / files.list | cloud-storage:read | parentId, cursor, limit | ui, backend |  |
| moss.cloud-storage/v1 / files.get | cloud-storage:read | fileId* | ui, backend |  |
| moss.cloud-storage/v1 / folders.create | cloud-storage:write | name*, parentId | ui, backend |  |
| moss.cloud-storage/v1 / files.update | cloud-storage:write | fileId*, name, parentId | ui, backend |  |
| moss.cloud-storage/v1 / files.delete | cloud-storage:delete | fileId* | ui, backend |  |
| moss.cloud-storage/v1 / local-files.pick | cloud-storage:write | {} | ui, backend |  |
| moss.cloud-storage/v1 / uploads.start | cloud-storage:write | handle*, name, parentId | ui, backend |  |
| moss.cloud-storage/v1 / downloads.start | cloud-storage:read | fileId* | ui, backend |  |
| moss.cloud-storage/v1 / transfers.list | cloud-storage:read | cursor, limit | ui, backend |  |
| moss.cloud-storage/v1 / transfers.get | cloud-storage:read | transferId* | ui, backend |  |
| moss.cloud-storage/v1 / transfers.pause | cloud-storage:read | transferId* | ui, backend |  |
| moss.cloud-storage/v1 / transfers.resume | cloud-storage:read | transferId* | ui, backend |  |
| moss.cloud-storage/v1 / transfers.cancel | cloud-storage:read | transferId* | ui, backend |  |
| moss.cloud-storage/v1 / shares.create | cloud-storage:share | fileId*, requestKey*, expiresAt*, accessCode | ui, backend | idempotency: requestKey |
| moss.cloud-storage/v1 / shares.list | cloud-storage:share | fileId, cursor, limit | ui, backend |  |
| moss.cloud-storage/v1 / shares.revoke | cloud-storage:share | shareId* | ui, backend |  |
| moss.host/v1 / capabilities.get | null | protocols | ui, backend |  |
| moss.host/v1 / info.get | null | {} | ui, backend |  |
| moss.host/v1 / contracts.list | null | kind, offset, limit | ui, backend |  |
| moss.host/v1 / contracts.get | null | kind*, member*, contractHash* | ui, backend | {"responseBytes":262144} |
| moss.host/v1 / sdk.export | apps:author | projectRef*, sdkHash* | backend |  |
| moss.apps/v1 / authoring.get | null | {} | ui |  |
| moss.apps/v1 / authoring.prepare | null | intent*, targetRef, ref, prompt | ui |  |
| moss.apps/v1 / catalog.list | apps:read | kind | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / target.inspect | apps:read | projectRef, targetRef, appId | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / source.inspect | apps:read | projectRef, targetRef, appId | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / project.prepare | apps:author | intent*, projectId*, projectRef, draftRef, targetRef, appId, sourcePath, replaceOriginal | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / build.start | apps:build | projectRef*, submissionKey*, sourceHash*, contractHash*, sdkHash*, installDependencies | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / build.get | apps:read | operationRef*, offset, limit | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / build.cancel | apps:build | operationRef* | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / artifact.validate | apps:read | artifactRef* | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / artifact.preview | apps:build | artifactRef*, submissionKey*, grants, config | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / artifact.test | apps:build | previewRef*, action*, input, submissionKey* | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / artifact.get | apps:read | operationRef*, offset, limit | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / artifact.close | apps:build | operationRef* | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / release.prepare | apps:install | artifactRef*, submissionKey*, expectedBaseVersion*, expectedInstallationRevision*, dataCompatibility*, verification | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / release.commit | apps:install | releaseRef*, submissionKey* | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / release.get | apps:read | operationRef*, offset, limit | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |
| moss.apps/v1 / release.cancel | apps:install | operationRef* | backend | idempotency: submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt; {"concurrentBuilds":2,"buildsPerProject":1,"queuedBuilds":32,"logBytes":10485760,"retentionMs":604800000,"responseBytes":262144} |

## Events

| Protocol / event | Permission | Payload |
| --- | --- | --- |
| moss.tasks/v1 / task.changed | tasks:read | TaskChangedEvent |
| moss.agent-execution/v1 / execution.changed | execution:read | ExecutionChangedEvent |
| moss.cloud-storage/v1 / transfers.progress | cloud-storage:read | CloudTransfer |
| moss.cloud-storage/v1 / transfers.changed | cloud-storage:read | CloudTransfer |
| moss.cloud-storage/v1 / storage.status-changed | cloud-storage:read | CloudStorageStatus |
| moss.apps/v1 / authoring.changed | null | { "revision": number } |
| moss.apps/v1 / operation.changed | apps:read | AuthoringOperation |

## Errors

`APP_PERMISSION_DENIED`, `APP_INVALID_ACTION_INPUT`, `APP_HOST_TIMEOUT`, `APP_ACTION_CANCELED`, `APP_CONFLICT`, `APP_NOT_FOUND`, `APP_RESOURCE_EXHAUSTED`, `APP_HOST_UNAVAILABLE`, `APP_HOST_PROTOCOL_ERROR`
