import fs from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import semver from 'semver'
import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'
import manifestSchema from './app-manifest.schema.json' with { type: 'json' }

export const APP_MANIFEST_SCHEMA = manifestSchema
export const APP_HOST_API_VERSION = '1.0.0'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validateManifestSchema = ajv.compile(APP_MANIFEST_SCHEMA)

export function ensureSafeRelativePath(value, fieldName = 'path') {
  const raw = String(value || '').trim()
  const portable = raw.replaceAll('\\', '/')
  const normalized = path.posix.normalize(portable)
  if (
    !raw ||
    raw.includes('\0') ||
    path.posix.isAbsolute(portable) ||
    /^[A-Za-z]:\//.test(portable) ||
    portable.startsWith('//') ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `${fieldName} must stay inside the App package`)
  }
  return normalized
}

function formatAjvErrors(errors = []) {
  return errors.map((entry) => `${entry.instancePath || '/'} ${entry.message}`).join('; ')
}

function normalizeUi(ui) {
  if (!ui) return undefined
  return {
    entry: ensureSafeRelativePath(ui.entry, 'ui.entry'),
    window: {
      width: Number(ui.window?.width) || 1100,
      height: Number(ui.window?.height) || 760,
      resizable: ui.window?.resizable !== false,
    },
  }
}

function normalizeBackend(backend) {
  if (!backend) return undefined
  const actionNames = new Set()
  const actions = backend.actions.map((action) => {
    if (actionNames.has(action.name)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate Backend action: ${action.name}`)
    }
    actionNames.add(action.name)
    return {
      name: action.name,
      ...(action.inputSchema ? { inputSchema: ensureSafeRelativePath(action.inputSchema, `action ${action.name} inputSchema`) } : {}),
      ...(action.outputSchema ? { outputSchema: ensureSafeRelativePath(action.outputSchema, `action ${action.name} outputSchema`) } : {}),
      ...(action.timeoutMs ? { timeoutMs: action.timeoutMs } : {}),
    }
  })
  return {
    entry: ensureSafeRelativePath(backend.entry, 'backend.entry'),
    runtime: 'node',
    apiVersion: 1,
    lifecycle: backend.lifecycle,
    instanceMode: backend.instanceMode,
    targets: [...backend.targets],
    actions,
    ...(backend.configuration ? {
      configuration: {
        ...(backend.configuration.schema ? { schema: ensureSafeRelativePath(backend.configuration.schema, 'backend.configuration.schema') } : {}),
        ...(backend.configuration.secrets ? { secrets: ensureSafeRelativePath(backend.configuration.secrets, 'backend.configuration.secrets') } : {}),
      },
    } : {}),
  }
}

export function validateAppManifest(rawManifest, options = {}) {
  const candidate = structuredClone(rawManifest)
  if (
    candidate?.ui
    && candidate?.backend
    && Array.isArray(candidate.backend.targets)
    && !candidate.backend.targets.includes('desktop')
  ) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidManifest,
      'Apps with a UI must target desktop; Server-only Apps must omit ui',
    )
  }
  if (!validateManifestSchema(candidate)) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidManifest,
      `Invalid app.moss.json: ${formatAjvErrors(validateManifestSchema.errors)}`,
      validateManifestSchema.errors,
    )
  }
  if (!semver.valid(candidate.version)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Invalid semantic version: ${candidate.version}`)
  }
  if (!candidate.displayName.trim()) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'displayName cannot contain only whitespace')
  }
  if (!semver.validRange(candidate.hostApi)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Invalid hostApi range: ${candidate.hostApi}`)
  }
  const hostApiVersion = options.hostApiVersion || APP_HOST_API_VERSION
  if (!semver.satisfies(hostApiVersion, candidate.hostApi)) {
    throw new AppServiceError(
      APP_ERROR_CODES.incompatibleHost,
      `App requires Host API ${candidate.hostApi}; this Host provides ${hostApiVersion}`,
    )
  }
  return {
    schemaVersion: 2,
    id: candidate.id,
    version: candidate.version,
    displayName: candidate.displayName.trim(),
    description: String(candidate.description || '').trim(),
    icon: candidate.icon ? ensureSafeRelativePath(candidate.icon, 'icon') : '',
    hostApi: candidate.hostApi,
    ...(candidate.ui ? { ui: normalizeUi(candidate.ui) } : {}),
    ...(candidate.backend ? { backend: normalizeBackend(candidate.backend) } : {}),
    permissions: [...candidate.permissions],
  }
}

export function loadJsonSchema(packageRoot, relativePath, fieldName = 'schema') {
  const safePath = ensureSafeRelativePath(relativePath, fieldName)
  const absolutePath = path.resolve(packageRoot, safePath)
  const relative = path.relative(path.resolve(packageRoot), absolutePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `${fieldName} escapes the App package`)
  }
  let schema
  try {
    schema = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
    new Ajv2020({ strict: false }).compile(schema)
  } catch (error) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Invalid ${fieldName}: ${error.message}`)
  }
  return schema
}

export function compileJsonSchema(schema) {
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema || {})
}
