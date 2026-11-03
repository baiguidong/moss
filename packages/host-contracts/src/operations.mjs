import { text, count, nullable, array, record, method } from './shared.mjs'
const object = { type: 'object', additionalProperties: true }
const actionRefs = record({ validateDraft: text(300), execute: text(300), queryResult: text(300) })
const draft = record({
  title: text(240), summary: text(1000), channel: text(120), accountId: text(240), accountLabel: text(240),
  target: object, content: text(200000), attachments: array(record({ name: text(160), uri: text(2000) }), 20),
  baseVersion: nullable(text(240)), expiresAt: count, actionRefs, metadata: object,
}, ['title', 'channel', 'accountId', 'target', 'content', 'actionRefs'])
// Apps may propose drafts and read their own receipts. Only the Moss review UI confirms.
export const operationsContracts = { 'moss.operations/v1': { types: 'Operations', methods: {
  'draft.create': method('operations:propose', draft, object, { surfaces: ['backend'] }),
  'draft.list': method('operations:propose', record({}), record({ drafts: array(object) }), { surfaces: ['backend'] }),
  'draft.get': method('operations:propose', record({ draftId: text(160) }), nullable(object), { surfaces: ['backend'] }),
}, events: {} } }
