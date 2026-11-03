// Isolated acceptance fixture. No network or external side effects.
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN };
const send = (type, payload = {}, id = crypto.randomUUID()) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } });
const waiting = new Map();
process.on('message', message => {
  if (message.type === 'service.init') send('service.ready', {}, message.id);
  if (message.type === 'service.ping') send('service.pong', {}, message.id);
  if (message.type === 'service.shutdown') process.exit(0);
  if (message.type === 'host.response') {
    const actionId = waiting.get(message.id); if (!actionId) return;
    waiting.delete(message.id);
    if (message.payload.ok) send('action.result', { requestId: actionId, result: message.payload.result }, actionId);
    else send('action.error', { requestId: actionId, error: message.payload.error }, actionId);
  }
  if (message.type !== 'action.invoke') return;
  const input = message.payload.input || {}, action = message.payload.name;
  if (action === 'prepare') {
    const id = crypto.randomUUID(); waiting.set(id, message.id);
    const crm = input.mode === 'crm';
    send('host.request', { protocol: 'moss.operations/v1', method: 'draft.create', actionRequestId: message.id, input: {
      title: crm ? '更新客户阶段' : input.mode === 'unknown' ? '结果待核实邮件' : '发送项目周报',
      channel: crm ? 'crm' : 'email', accountId: 'fixture-work', accountLabel: '验收账号',
      target: { id: crm ? 'customer-17' : 'person-7', type: crm ? 'customer' : 'person', name: crm ? '示例客户' : '验收联系人', tenantId: 'fixture' },
      content: crm ? '{"stage":"contacted"}' : '请查收项目周报。', baseVersion: crm ? 'stale-v1' : null,
      attachments: [], metadata: { mode: input.mode || 'mail' },
      actionRefs: { validateDraft: 'fixture.operations/validate', execute: 'fixture.operations/execute', queryResult: 'fixture.operations/query' },
    } }, id);
    return;
  }
  const result = action === 'validate' ? (input.draft.baseVersion === 'stale-v1' ? { valid: false, error: '客户记录版本已变更，请重新生成草稿。' } : { valid: true })
    : action === 'execute' ? { status: input.draft.metadata.mode === 'unknown' ? 'unknown' : 'succeeded', result: { externalId: 'fixture-receipt', idempotencyKey: input.idempotencyKey } }
      : { status: 'succeeded', result: { externalId: 'fixture-receipt' } };
  send('action.result', { requestId: message.id, result }, message.id);
});
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION, apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID });
