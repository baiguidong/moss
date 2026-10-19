import { expect, test } from 'bun:test';
import { isExpectedControllerCancellation as expected } from '../src/app-testing/controller-cancellation.mjs';

const diagnostic = '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use';
const abort = 'Error: Request was aborted.\nat Anthropic.makeRequest (file:///app/electron-direct.mjs:34932:15)\nat process.processTicksAndRejections (node:internal/process/task_queues:104:5)';
const result = { type: 'result', subtype: 'error_during_execution', is_error: true, errors: [diagnostic, abort] };
test('recognizes the reported diagnostic only after the controller was explicitly stopped', () => {
  expect(expected(result, undefined)).toBe(false);
  const controller = new AbortController();
  expect(expected(result, controller.signal)).toBe(false);
  controller.abort();
  expect(expected(result, controller.signal)).toBe(true);
  expect(expected(new Error('Request was aborted.'), controller.signal)).toBe(true);
  expect(expected({ type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: 'API Error: Request was aborted.' }] } }, controller.signal)).toBe(true);
});
test('real failures are preserved even if cancellation races with the result', () => {
  const signal = AbortSignal.abort();
  for (const errors of [[diagnostic], [diagnostic, 'API Error: 401 Unauthorized'], [diagnostic, abort, 'ENOSPC: no space left on device'],
    [diagnostic, 'McpToolCallError: ### Error\nError: strict mode violation', abort], []]) {
    expect(expected({ ...result, errors }, signal)).toBe(false);
  }
  expect(expected(new Error('connection timed out'), signal)).toBe(false);
  expect(expected({ ...result, subtype: 'error_max_turns' }, signal)).toBe(false);
});
