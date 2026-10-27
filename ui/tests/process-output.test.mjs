import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { registerProcessOutputErrorHandlers } from '../src/process-output.mjs';

test('detached output streams tolerate EIO/EPIPE while other errors remain visible', () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const unregister = registerProcessOutputErrorHandlers({ stdout, stderr });
  try {
    for (const stream of [stdout, stderr]) {
      for (const code of ['EIO', 'EPIPE']) {
        assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error(`write ${code}`), { code })));
      }
      const unexpected = Object.assign(new Error('unexpected output failure'), { code: 'EINVAL' });
      assert.throws(() => stream.emit('error', unexpected), error => error === unexpected);
    }
  } finally {
    unregister();
  }
  assert.equal(stdout.listenerCount('error'), 0);
  assert.equal(stderr.listenerCount('error'), 0);
});

test('asynchronous console write failures do not become uncaught exceptions', () => {
  const moduleUrl = new URL('../src/process-output.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { Writable } from 'node:stream';
    import { Console } from 'node:console';
    import { registerProcessOutputErrorHandlers } from ${JSON.stringify(moduleUrl)};
    const failures = [];
    const brokenStream = code => new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => {
          failures.push(code);
          callback(Object.assign(new Error('write ' + code), { code }));
        });
      },
    });
    const stdout = brokenStream('EPIPE');
    const stderr = brokenStream('EIO');
    registerProcessOutputErrorHandlers({ stdout, stderr });
    const logger = new Console({ stdout, stderr, ignoreErrors: false });
    logger.log('shutdown status');
    logger.error('renderer send failed');
    setImmediate(() => {
      assert.deepEqual(failures, ['EPIPE', 'EIO']);
      assert.equal(stdout.errored.code, 'EPIPE');
      assert.equal(stderr.errored.code, 'EIO');
    });
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
