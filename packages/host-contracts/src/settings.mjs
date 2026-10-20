import { text, boolean, array, record, method } from './shared.mjs'
const object = { type: 'object', additionalProperties: true }
const target = { domain: text(64), scope: text(64), target: text(500), key: text(500) }
const approvalMode = { enum: ['confirm', 'unrestricted'] }
const change = record({ path: text(500), value: {}, remove: boolean }, ['path'])
export const settingsContracts = {
  'moss.settings/v1': { types: 'Settings', methods: {
    'catalog': method('settings:read', record({ ...target, query: { type: 'string', maxLength: 200 } }, []), object),
    'read': method('settings:read', record(target, ['domain']), object),
    'apply': method('settings:write', record({ ...target, revision: text(128), requestId: text(128), changes: array(change, 50), preview: boolean, approvalMode }, ['domain','revision','requestId','changes']), object),
    'undo': method('settings:write', record({ receiptId: text(128), requestId: text(128), approvalMode }, ['receiptId','requestId']), object),
  }, events: {} },
  'moss.notifications/v1': { types: 'Notifications', methods: {
    'list': method('notifications:read', record({}), object),
    'mark-read': method('notifications:read', record({ id: text(128) }), object),
    'publish': method('notifications:publish', record({ id: text(128), severity: { enum: ['info','warning','error'] }, title: text(4000), message: text(4000), details: text(16000) }, ['id','severity','title','message']), record({ delivered: { const: true } })),
  }, events: {} },
}
