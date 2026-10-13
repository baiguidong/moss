import { text, boolean, nullable, record, method, array } from './shared.mjs'
const object = { type: 'object', additionalProperties: true }
const empty = record({})
const runId = { type: 'string', pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' }
const session = { sessionId: text(160) }
const fixtures = array(record({ name: { ...text(128), pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]*$' }, content: { type: 'string', maxLength: 65536 } }), 20)
const operation = (input, output = object) => method('testing:control', input, output, { apps: ['moss.self-test'], surfaces: ['backend'] })
export const testingContracts = {
  'moss.testing/v1': { types: 'Testing', methods: {
    environment: operation(empty),
    'target.status': operation(empty),
    'target.open': operation(record({ fixtures, title: text(200) }, [])),
    'target.sync': operation(record({ fixtures, title: text(200) }, [])),
    'target.reset': operation(record({ fixtures, title: text(200) }, [])),
    'target.close': operation(empty),
    'target.attach': operation(record({ runId })),
    'controller.create': operation(record({ runId, engineEntry: text(512), disabledTools: array(text(100), 30), title: text(200) })),
    'controller.turn.start': operation(record({ ...session, prompt: text(100000) })),
    'controller.turn.status': operation(record(session)),
    'controller.turn.abort': operation(record(session)),
    'controller.dispose': operation(record(session)),
    'controller.caller': operation(empty, record({ sessionId: nullable(text(160)) })),
    'controller.open': operation(record(session), record({ opened: boolean })),
  }, events: {
    'target.changed': { permission: 'testing:control', input: object },
  } },
}
