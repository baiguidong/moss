import type {} from '../../src/renderer-react/types';
import type { SendResult } from '../../src/renderer-react/lib/desktop-api-types';

// Compiled by desktop-api-types.test.ts; never executed.
function checkContract(api: Window['agentDesktop'], result: SendResult) {
  api.send({ sessionId: 's1', prompt: 'hello' });
  api.send({ sessionId: 's1', prompt: 'hello', mode: 'boss' });
  api.abort({ sessionId: 's1' });
  api.answerQuestion({ sessionId: 's1', requestId: 'q1', answers: { choice: 'yes' } });
  api.skillHub.fetchDetail({ slug: 'research', namespace: 'team' });
  api.sessionCron.toggle('cloud', { taskId: 't1', enabled: false });
  api.onState(event => { const busy: boolean | undefined = event.busy; return busy; });

  // @ts-expect-error session identity is required
  api.send({ prompt: 'hello' });
  // @ts-expect-error internal Main modes are not Desktop conversation modes
  api.send({ sessionId: 's1', prompt: 'hello', mode: 'plan' });
  // @ts-expect-error Desktop uses boss, not the internal coordinator alias
  api.send({ sessionId: 's1', prompt: 'hello', mode: 'coordinator' });
  // @ts-expect-error files contain paths, not File objects
  api.send({ sessionId: 's1', prompt: 'hello', files: [new File([], 'name')] });
  // @ts-expect-error abort must identify a session
  api.abort({});
  // @ts-expect-error approvals must identify the pending request
  api.answerQuestion({ sessionId: 's1', answers: {} });
  // @ts-expect-error answer values are strings
  api.answerQuestion({ sessionId: 's1', requestId: 'q1', answers: { choice: true } });
  // @ts-expect-error only finite cron sources are accepted
  api.sessionCron.list('arbitrary-channel');
  // @ts-expect-error expert identity is required
  api.expertHub.install({ id: 'wrong-key' });
  // @ts-expect-error event envelopes have a defined shape
  api.onEvent(event => event.arbitraryField);
  // @ts-expect-error a result must be narrowed before reading the assistant text
  result.assistantText;
  if (result.ok && 'assistantText' in result) {
    const text: string = result.assistantText;
    return text;
  }
}
void checkContract;
