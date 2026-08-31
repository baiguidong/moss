#!/usr/bin/env node
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createHash, randomUUID } from 'node:crypto'
import { fork } from 'node:child_process'

function parseArgs(argv) {
  const positional = []
  const options = { out: '', pretty: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') options.out = argv[++i] || ''
    else if (argv[i] === '--pretty') options.pretty = true
    else if (argv[i].startsWith('--')) throw new Error(`Unknown option: ${argv[i]}`)
    else positional.push(argv[i])
  }
  if (positional.length !== 2) throw new Error('Usage: run_backend_tests.mjs <app-root> <test-plan.json> [--out report.json] [--pretty]')
  return { appRoot: path.resolve(positional[0]), planPath: path.resolve(positional[1]), ...options }
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function sha256(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
function fingerprint(root) {
  const hash = createHash('sha256')
  const visit = (dir) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((entry) => {
    const full = path.join(dir, entry.name)
    const rel = path.relative(root, full).split(path.sep).join('/')
    if (entry.isSymbolicLink()) throw new Error(`App contains symbolic link: ${rel}`)
    if (entry.isDirectory()) { if (!['node_modules', '.git', 'build'].includes(entry.name)) visit(full) }
    else if (!rel.startsWith('generated/')) { hash.update(rel); hash.update('\0'); hash.update(fs.readFileSync(full)); hash.update('\0') }
  })
  visit(root)
  return `sha256:${hash.digest('hex')}`
}
function envValue(value, secrets) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$env === 'string') {
    if (!(value.$env in process.env)) throw new Error(`Required environment variable is missing: ${value.$env}`)
    const result = process.env[value.$env]
    if (result) secrets.push(result)
    return result
  }
  if (Array.isArray(value)) return value.map((item) => envValue(item, secrets))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, envValue(item, secrets)]))
  return value
}
function redact(value, secrets) {
  if (typeof value === 'string') return secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), value)
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /secret|token|password|credential|api.?key/i.test(key) ? '[REDACTED]' : redact(item, secrets)]))
  return value
}
function resolvePath(root, expression) {
  if (!expression || expression === '$') return { found: true, value: root }
  let value = root
  for (const part of String(expression).replace(/^\$\.?/, '').split('.').filter(Boolean)) {
    if (value == null || !Object.prototype.hasOwnProperty.call(Object(value), part)) return { found: false, value: undefined }
    value = value[part]
  }
  return { found: true, value }
}
function evaluate(outcome, assertion) {
  const actual = resolvePath(outcome, assertion.path)
  let passed = false
  if (assertion.operator === 'exists') passed = actual.found
  if (assertion.operator === 'equals') passed = actual.found && JSON.stringify(actual.value) === JSON.stringify(assertion.value)
  if (assertion.operator === 'type') passed = actual.found && (actual.value === null ? 'null' : Array.isArray(actual.value) ? 'array' : typeof actual.value) === assertion.value
  if (assertion.operator === 'nonEmpty') passed = actual.found && (typeof actual.value === 'string' || Array.isArray(actual.value) ? actual.value.length > 0 : actual.value && typeof actual.value === 'object' && Object.keys(actual.value).length > 0)
  if (assertion.operator === 'minItems') passed = actual.found && Array.isArray(actual.value) && actual.value.length >= assertion.value
  return { ...assertion, passed }
}
function envelope(type, payload, id = randomUUID()) { return { version: 1, id, type, timestamp: Date.now(), payload } }

async function startBackend(root, manifest) {
  const entry = path.resolve(root, manifest.backend.entry)
  const relative = path.relative(root, entry)
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(entry)) throw new Error('Backend entry is missing or unsafe')
  const generation = 1
  const launchToken = randomUUID()
  const child = fork(entry, [], {
    cwd: root,
    execPath: process.env.MOSS_NODE_PATH || process.execPath,
    env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', MOSS_APP_ID: manifest.id, MOSS_APP_VERSION: manifest.version, MOSS_APP_INSTANCE_ID: `${manifest.id}--test`, MOSS_APP_GENERATION: String(generation), MOSS_APP_LAUNCH_TOKEN: launchToken },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const pending = new Map()
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Backend handshake timed out')), 15000)
    child.on('message', (message) => {
      if (!message || message.version !== 1 || message.payload?.generation !== generation || message.payload?.launchToken !== launchToken) return
      if (message.type === 'service.hello') child.send(envelope('service.init', { appId: manifest.id, version: manifest.version, instanceId: `${manifest.id}--test`, generation, launchToken, config: {}, secrets: {}, dataDir: path.join(root, '.test-data'), runtimeDir: path.join(root, '.test-runtime'), target: { type: 'desktop', id: 'test' } }, message.id))
      if (message.type === 'service.ready') { clearTimeout(timeout); resolve() }
      if (message.type === 'action.result' || message.type === 'action.error') {
        const request = pending.get(message.payload.requestId || message.id)
        if (!request) return
        pending.delete(message.payload.requestId || message.id)
        message.type === 'action.result' ? request.resolve(message.payload.result) : request.reject(Object.assign(new Error(message.payload.error?.message || 'Backend error'), message.payload.error))
      }
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Backend exited during startup: ${code}`)))
  })
  await ready
  return {
    invoke(name, input, timeoutMs) {
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); child.send(envelope('action.cancel', { requestId: id, generation, launchToken })); reject(new Error(`Action timed out after ${timeoutMs}ms`)) }, timeoutMs)
        pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } })
        child.send(envelope('action.invoke', { name, input, generation, launchToken }, id))
      })
    },
    async stop() {
      if (child.exitCode !== null) return
      child.send(envelope('service.shutdown', { generation, launchToken }))
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2000))])
      if (child.exitCode === null) child.kill('SIGKILL')
      await fsp.rm(path.join(root, '.test-data'), { recursive: true, force: true })
      await fsp.rm(path.join(root, '.test-runtime'), { recursive: true, force: true })
    },
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = readJson(path.join(options.appRoot, 'app.moss.json'))
  const plan = readJson(options.planPath)
  if (manifest.schemaVersion !== 2 || !manifest.backend) throw new Error('App must declare a V2 Backend')
  if (plan.schemaVersion !== 1 || plan.appId !== manifest.id || !Array.isArray(plan.cases) || !plan.cases.length) throw new Error('Invalid Backend test plan')
  const declared = new Set((manifest.backend.actions || []).map((action) => action.name))
  for (const test of plan.cases) if (!declared.has(test.action)) throw new Error(`Test references undeclared action: ${test.action}`)
  const backend = await startBackend(options.appRoot, manifest)
  const results = []
  try {
    for (const test of plan.cases) {
      const secrets = []
      let outcome
      const started = Date.now()
      try { outcome = { threw: false, result: redact(await backend.invoke(test.action, envValue(structuredClone(test.input), secrets), test.timeoutMs || 30000), secrets) } }
      catch (error) { outcome = { threw: true, error: { code: error.code, name: error.name, message: redact(error.message, secrets) } } }
      const assertions = (test.expect?.assertions || []).map((assertion) => evaluate(outcome, assertion))
      results.push({ id: test.id, action: test.action, category: test.category, required: test.required, passed: assertions.length > 0 && assertions.every((item) => item.passed), durationMs: Date.now() - started, outcome, assertions })
    }
  } finally { await backend.stop() }
  const report = { schemaVersion: 1, ok: results.every((item) => item.passed), appId: manifest.id, appVersion: manifest.version, appRoot: options.appRoot, appFingerprint: fingerprint(options.appRoot), planFingerprint: sha256(fs.readFileSync(options.planPath)), cases: results, totals: { total: results.length, passed: results.filter((item) => item.passed).length, failed: results.filter((item) => !item.passed).length } }
  const output = JSON.stringify(report, null, options.pretty ? 2 : 0) + '\n'
  if (options.out) { await fsp.mkdir(path.dirname(path.resolve(options.out)), { recursive: true }); await fsp.writeFile(path.resolve(options.out), output) }
  else process.stdout.write(output)
  if (!report.ok) process.exitCode = 1
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1 })
