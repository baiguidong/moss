#!/usr/bin/env node

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const SKIP_DIRS = new Set(['node_modules', 'src', '.git'])
const ALLOWED_CATEGORIES = new Set([
  'success',
  'invalid-input',
  'dependency',
  'failure',
  'timeout',
  'integration',
  'equivalence',
])
const ALLOWED_OPERATORS = new Set(['exists', 'equals', 'type', 'nonEmpty', 'minItems'])
const ALLOWED_TYPES = new Set(['null', 'array', 'object', 'string', 'number', 'boolean'])
const SENSITIVE_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credential|authorization)/i

function parseArgs(argv) {
  const positional = []
  const options = { pretty: false, out: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--pretty') options.pretty = true
    else if (value === '--out') options.out = argv[++index] || ''
    else if (value.startsWith('--')) throw new Error(`Unknown option: ${value}`)
    else positional.push(value)
  }
  if (positional.length !== 2) {
    throw new Error('Usage: run_extension_tests.mjs <extension-dir> <test-plan.json> [--out report.json] [--pretty]')
  }
  return {
    extensionRoot: path.resolve(positional[0]),
    planPath: path.resolve(positional[1]),
    ...options,
  }
}

function jsonFile(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`JSON root must be an object: ${filePath}`)
  }
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function listRuntimeFiles(root) {
  const files = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      const relative = path.relative(root, fullPath)
      const parts = relative.split(path.sep)
      if (parts.some(part => SKIP_DIRS.has(part))) continue
      if (entry.isSymbolicLink()) throw new Error(`Extension package contains a symbolic link: ${relative}`)
      if (entry.isDirectory()) visit(fullPath)
      else if (entry.isFile() && !entry.name.endsWith('.log')) files.push(fullPath)
    }
  }
  visit(root)
  return files.sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)))
}

function extensionFingerprint(root) {
  const hash = createHash('sha256')
  for (const filePath of listRuntimeFiles(root)) {
    const relative = path.relative(root, filePath).split(path.sep).join('/')
    hash.update(relative)
    hash.update('\0')
    hash.update(fs.readFileSync(filePath))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function planFingerprint(planPath) {
  return `sha256:${sha256(fs.readFileSync(planPath))}`
}

function contributedNames(manifest, kind) {
  const entries = Array.isArray(manifest?.contributes?.[kind]) ? manifest.contributes[kind] : []
  return new Set(entries.map(entry => String(entry?.name || entry?.command || '')).filter(Boolean))
}

function assertDeclared(manifest, extensionId, kind, name) {
  const localName = name.startsWith(`${extensionId}.`) ? name.slice(extensionId.length + 1) : name
  if (!contributedNames(manifest, kind).has(localName)) {
    throw new Error(`Extension registered undeclared ${kind.slice(0, -1)}: ${name}`)
  }
  return localName
}

function validatePlan(plan, manifest) {
  const errors = []
  if (plan.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (plan.extensionId !== manifest.id) errors.push(`extensionId must equal ${manifest.id}`)
  if (!Array.isArray(plan.cases) || plan.cases.length === 0) errors.push('cases must be a non-empty array')
  const ids = new Set()
  for (const [index, testCase] of (plan.cases || []).entries()) {
    const prefix = `cases[${index}]`
    if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
      errors.push(`${prefix} must be an object`)
      continue
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(String(testCase.id || ''))) errors.push(`${prefix}.id is invalid`)
    else if (ids.has(testCase.id)) errors.push(`${prefix}.id is duplicated: ${testCase.id}`)
    ids.add(testCase.id)
    if (!['tool', 'command'].includes(testCase.kind)) errors.push(`${prefix}.kind is invalid`)
    if (!ALLOWED_CATEGORIES.has(testCase.category)) errors.push(`${prefix}.category is invalid`)
    if (testCase.required !== true) errors.push(`${prefix}.required must be true`)
    if (!testCase.input || typeof testCase.input !== 'object' || Array.isArray(testCase.input)) errors.push(`${prefix}.input must be an object`)
    else {
      const sensitivePaths = findSensitivePaths(testCase.input)
      if (sensitivePaths.length) errors.push(`${prefix}.input must not contain credentials: ${sensitivePaths.join(', ')}`)
    }
    if (!testCase.expect || !Array.isArray(testCase.expect.assertions) || testCase.expect.assertions.length === 0) {
      errors.push(`${prefix}.expect.assertions must be a non-empty array`)
    }
    if (testCase.timeoutMs !== undefined &&
        (!Number.isInteger(testCase.timeoutMs) || testCase.timeoutMs < 100 || testCase.timeoutMs > 120000)) {
      errors.push(`${prefix}.timeoutMs must be an integer from 100 to 120000`)
    }
    for (const [assertionIndex, assertion] of (testCase.expect?.assertions || []).entries()) {
      const assertionPrefix = `${prefix}.expect.assertions[${assertionIndex}]`
      if (!assertion || typeof assertion !== 'object') errors.push(`${assertionPrefix} must be an object`)
      else {
        if (typeof assertion.path !== 'string') errors.push(`${assertionPrefix}.path must be a string`)
        if (!ALLOWED_OPERATORS.has(assertion.operator)) errors.push(`${assertionPrefix}.operator is invalid`)
        if (['equals', 'type', 'minItems'].includes(assertion.operator) &&
            !Object.prototype.hasOwnProperty.call(assertion, 'value')) {
          errors.push(`${assertionPrefix}.value is required for ${assertion.operator}`)
        }
        if (assertion.operator === 'type' && !ALLOWED_TYPES.has(assertion.value)) {
          errors.push(`${assertionPrefix}.value is invalid for a type assertion`)
        }
        if (assertion.operator === 'minItems' && (!Number.isInteger(assertion.value) || assertion.value < 1)) {
          errors.push(`${assertionPrefix}.value must be an integer of at least 1`)
        }
      }
    }
  }
  if (errors.length) throw new Error(`Invalid extension test plan:\n- ${errors.join('\n- ')}`)
}

function valueType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function findSensitivePaths(value, prefix = '$') {
  if (!value || typeof value !== 'object') return []
  const found = []
  for (const [key, child] of Object.entries(value)) {
    const next = `${prefix}.${key}`
    if (SENSITIVE_KEY.test(key) && !isEnvReference(child)) found.push(next)
    else found.push(...findSensitivePaths(child, next))
  }
  return found
}

function isEnvReference(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof value.$env === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(value.$env),
  )
}

function resolveEnvReferences(value, secrets = []) {
  if (isEnvReference(value)) {
    if (!Object.prototype.hasOwnProperty.call(process.env, value.$env)) {
      throw new Error(`Required test environment variable is not set: ${value.$env}`)
    }
    const resolved = process.env[value.$env]
    if (resolved) secrets.push(resolved)
    return resolved
  }
  if (Array.isArray(value)) return value.map(child => resolveEnvReferences(child, secrets))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveEnvReferences(child, secrets)]))
}

function resolvePath(root, expression) {
  if (expression === '' || expression === '$') return { found: true, value: root }
  const parts = String(expression).replace(/^\$\.?/, '').split('.').filter(Boolean)
  let value = root
  for (const part of parts) {
    if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(Object(value), part)) {
      return { found: false, value: undefined }
    }
    value = value[part]
  }
  return { found: true, value }
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function evaluateAssertion(outcome, assertion) {
  const resolved = resolvePath(outcome, assertion.path)
  const actual = resolved.value
  let passed = false
  let detail = ''
  switch (assertion.operator) {
    case 'exists':
      passed = resolved.found
      detail = passed ? 'path exists' : 'path does not exist'
      break
    case 'equals':
      passed = resolved.found && equalJson(actual, assertion.value)
      detail = `expected ${JSON.stringify(assertion.value)}, received ${JSON.stringify(actual)}`
      break
    case 'type':
      passed = resolved.found && valueType(actual) === assertion.value
      detail = `expected type ${assertion.value}, received ${valueType(actual)}`
      break
    case 'nonEmpty':
      passed = resolved.found && (
        (typeof actual === 'string' && actual.length > 0) ||
        (Array.isArray(actual) && actual.length > 0) ||
        (actual && typeof actual === 'object' && !Array.isArray(actual) && Object.keys(actual).length > 0)
      )
      detail = passed ? 'value is non-empty' : 'value is empty or unsupported'
      break
    case 'minItems':
      passed = resolved.found && Array.isArray(actual) && actual.length >= Number(assertion.value)
      detail = `expected at least ${assertion.value} items, received ${Array.isArray(actual) ? actual.length : valueType(actual)}`
      break
    default:
      throw new Error(`Unsupported assertion operator: ${assertion.operator}`)
  }
  return { ...assertion, passed, actualType: valueType(actual), detail }
}

async function withTimeout(promise, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Test case exceeded ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function sanitize(value, secrets = []) {
  try {
    return redact(JSON.parse(JSON.stringify(value)), secrets)
  } catch {
    return redact(String(value), secrets)
  }
}

function redact(value, secrets = []) {
  if (typeof value === 'string') {
    return secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value)
  }
  if (Array.isArray(value)) return value.map(child => redact(child, secrets))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(child, secrets),
  ]))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifestPath = path.join(options.extensionRoot, 'extension.moss.json')
  const manifest = jsonFile(manifestPath)
  const plan = jsonFile(options.planPath)
  validatePlan(plan, manifest)
  const configuredMain = String(manifest.main || 'dist/extension.js')
  const mainPath = path.resolve(options.extensionRoot, configuredMain)
  const mainRelative = path.relative(options.extensionRoot, mainPath)
  if (!mainRelative || mainRelative.startsWith('..') || path.isAbsolute(mainRelative)) {
    throw new Error('Extension main must stay inside its root')
  }
  if (mainRelative.split(path.sep).some(part => SKIP_DIRS.has(part))) {
    throw new Error(`Extension main is excluded from the installable package: ${configuredMain}`)
  }
  // Fingerprint before activation so a symlink or malformed runtime package is rejected before code executes.
  const testedExtensionFingerprint = extensionFingerprint(options.extensionRoot)

  const commands = new Map()
  const tools = new Map()
  const deactivators = []
  const context = {
    extensionId: manifest.id,
    extensionPath: options.extensionRoot,
    subscriptions: [],
    commands: {
      registerCommand(name, handler) {
        const localName = assertDeclared(manifest, manifest.id, 'commands', name)
        commands.set(localName, handler)
        return { dispose: () => commands.delete(localName) }
      },
    },
    tools: {
      registerTool(name, definition) {
        const localName = assertDeclared(manifest, manifest.id, 'tools', name)
        if (typeof definition?.handler !== 'function') throw new Error(`Tool has no handler: ${name}`)
        tools.set(localName, definition.handler)
        return { dispose: () => tools.delete(localName) }
      },
    },
    log: { info() {}, warn() {}, error() {} },
  }

  const module = await withTimeout(
    import(`${pathToFileURL(mainPath).href}?test=${randomUUID()}`),
    30000,
  )
  if (typeof module.activate !== 'function') throw new Error('Extension has no activate(context) export')
  const activation = await withTimeout(Promise.resolve(module.activate(context)), 30000)
  if (typeof activation?.deactivate === 'function') deactivators.push(activation.deactivate)

  const startedAt = new Date().toISOString()
  const results = []
  for (const testCase of plan.cases) {
    const actionName = testCase.action.startsWith(`${manifest.id}.`)
      ? testCase.action.slice(manifest.id.length + 1)
      : testCase.action
    const handler = testCase.kind === 'tool' ? tools.get(actionName) : commands.get(actionName)
    const caseStarted = Date.now()
    let outcome
    const secrets = []
    if (!handler) {
      outcome = { threw: true, error: { name: 'UnknownAction', message: `Action was not registered: ${testCase.action}` } }
    } else {
      try {
        const input = resolveEnvReferences(JSON.parse(JSON.stringify(testCase.input)), secrets)
        const result = await withTimeout(Promise.resolve(handler(input)), testCase.timeoutMs || 30000)
        outcome = { threw: false, result: sanitize(result, secrets) }
      } catch (error) {
        outcome = {
          threw: true,
          error: {
            name: error?.name || 'Error',
            message: sanitize(error?.message || String(error), secrets),
          },
        }
      }
    }
    const assertions = testCase.expect.assertions.map(assertion => evaluateAssertion(outcome, assertion))
    results.push({
      id: testCase.id,
      action: testCase.action,
      kind: testCase.kind,
      category: testCase.category,
      required: true,
      passed: assertions.every(assertion => assertion.passed),
      durationMs: Date.now() - caseStarted,
      assertions,
      outcome,
    })
  }

  for (const deactivate of deactivators.reverse()) {
    try { await withTimeout(Promise.resolve(deactivate()), 5000) } catch {}
  }
  for (const subscription of context.subscriptions) {
    try { await subscription?.dispose?.() } catch {}
  }

  const report = {
    schemaVersion: 1,
    ok: results.every(result => result.passed),
    extensionId: manifest.id,
    extensionVersion: manifest.version,
    extensionRoot: options.extensionRoot,
    installedLayout: path.basename(options.extensionRoot) === manifest.version &&
      path.basename(path.dirname(options.extensionRoot)) === manifest.id &&
      path.basename(path.dirname(path.dirname(options.extensionRoot))) === 'extensions',
    extensionFingerprint: testedExtensionFingerprint,
    planPath: options.planPath,
    planFingerprint: planFingerprint(options.planPath),
    startedAt,
    completedAt: new Date().toISOString(),
    totals: {
      cases: results.length,
      passed: results.filter(result => result.passed).length,
      failed: results.filter(result => !result.passed).length,
      requiredFailed: results.filter(result => result.required && !result.passed).length,
    },
    cases: results,
  }
  const rendered = JSON.stringify(report, null, options.pretty ? 2 : 0)
  if (options.out) {
    await fsp.mkdir(path.dirname(path.resolve(options.out)), { recursive: true })
    await fsp.writeFile(path.resolve(options.out), `${rendered}\n`, 'utf8')
  }
  process.stdout.write(`${rendered}\n`, () => process.exit(report.ok ? 0 : 1))
}

main().catch(error => {
  const failure = { ok: false, error: error?.message || String(error) }
  process.stderr.write(`${JSON.stringify(failure)}\n`, () => process.exit(1))
})
