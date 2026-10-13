import assert from 'node:assert/strict'
import path from 'node:path'
import { runSelfTestApp } from './helpers/run-self-test-app.mjs'
assert.ok(process.argv[2], 'Pass the packaged self-test App directory')
await runSelfTestApp({ packageRoot: path.resolve(process.argv[2]) })
