import { text, count, boolean, nullable, array, record, method } from './shared.mjs'

export const authoringLimits = Object.freeze({ concurrentBuilds: 2, buildsPerProject: 1, queuedBuilds: 32, logBytes: 10 * 1024 * 1024, retentionMs: 7 * 86400000, responseBytes: 256 * 1024 })
const ref = text(160)
const data = { type: 'object', additionalProperties: true }
const refs = { projectRef: ref, targetRef: ref, appId: text(100) }
const query = record(refs, [])
const operationQuery = record({ operationRef: ref, offset: count, limit: { ...count, maximum: 65536 } }, ['operationRef'])
const operation = record({ operationRef: ref, kind: text(32), status: text(32), projectRef: ref, createdAt: count, updatedAt: count, result: data, error: nullable(text(8192)), log: { type: 'string', maxLength: 65536 }, nextOffset: count }, ['operationRef', 'kind', 'status', 'projectRef', 'createdAt', 'updatedAt'])
const snapshot = { sourceHash: text(64), contractHash: text(64), sdkHash: text(64) }
const invoke = (permission, input, output = operation) => method(permission, input, output, { surfaces: ['backend'], limits: authoringLimits, idempotency: 'submissionKey is scoped to owner, App, session and operation; same content returns its durable receipt' })
export const appsTypes = { AuthoringOperation: operation }
export const appsContracts = { 'moss.apps/v1': { types: 'Apps', methods: {
  'authoring.get': method(null, record({}), record({ available: boolean, reason: nullable(text()), provider: nullable(data) }), { surfaces: ['ui'] }),
  'authoring.prepare': method(null, record({ intent: { enum: ['create', 'edit'] }, targetRef: ref, ref: data, prompt: { type: 'string', maxLength: 4000 } }, ['intent']), data, { surfaces: ['ui'] }),
  'catalog.list': invoke('apps:read', record({ kind: { enum: ['apps', 'projects'] } }, []), record({ items: array(data, 1000) })),
  'target.inspect': invoke('apps:read', query, data),
  'source.inspect': invoke('apps:read', query, data),
  'project.prepare': invoke('apps:author', record({ intent: { enum: ['create', 'edit'] }, projectId: ref, projectRef: ref, draftRef: ref, targetRef: ref, appId: text(100), sourcePath: text(), replaceOriginal: boolean }, ['intent', 'projectId']), data),
  'build.start': invoke('apps:build', record({ projectRef: ref, submissionKey: ref, ...snapshot, installDependencies: boolean }, ['projectRef', 'submissionKey', 'sourceHash', 'contractHash', 'sdkHash'])),
  'build.get': invoke('apps:read', operationQuery),
  'build.cancel': invoke('apps:build', record({ operationRef: ref })),
  'artifact.validate': invoke('apps:read', record({ artifactRef: ref }), data),
  'artifact.preview': invoke('apps:build', record({ artifactRef: ref, submissionKey: ref, grants: array(text(160), 100), config: data }, ['artifactRef', 'submissionKey'])),
  'artifact.test': invoke('apps:build', record({ previewRef: ref, action: text(128), input: data, submissionKey: ref }, ['previewRef', 'action', 'submissionKey'])),
  'artifact.get': invoke('apps:read', operationQuery),
  'artifact.close': invoke('apps:build', record({ operationRef: ref })),
  'release.prepare': invoke('apps:install', record({ artifactRef: ref, submissionKey: ref, expectedBaseVersion: nullable(text(100)), expectedInstallationRevision: count, dataCompatibility: { enum: ['unchanged', 'migration-tested', 'unknown'] }, verification: { type: 'string', maxLength: 8192 } }, ['artifactRef', 'submissionKey', 'expectedBaseVersion', 'expectedInstallationRevision', 'dataCompatibility'])),
  'release.commit': invoke('apps:install', record({ releaseRef: ref, submissionKey: ref })),
  'release.get': invoke('apps:read', operationQuery),
  'release.cancel': invoke('apps:install', record({ operationRef: ref })),
}, events: {
  'authoring.changed': { permission: null, input: record({ revision: count }) },
  'operation.changed': { permission: 'apps:read', input: operation },
} } }
