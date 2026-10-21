import fs from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import semver from 'semver'
import { contracts } from '../../../host-contracts/src/index.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'
import manifestSchema from './app-manifest.schema.json' with { type: 'json' }

export const APP_MANIFEST_SCHEMA = manifestSchema
export const APP_HOST_API_VERSION = '3.20.0'

const ajv = new Ajv2020({ allErrors: true, strict: false, removeAdditional: 'all' })
const validateManifestSchema = ajv.compile(APP_MANIFEST_SCHEMA)
// Legacy manifest fields are discarded during normalization. Capability declarations are
// security relevant, so reject unknown fields before the general validator can strip them.
const validateAppCapabilitiesSchema = new Ajv2020({ allErrors: true, strict: false })
  .compile(APP_MANIFEST_SCHEMA.properties.appCapabilities)
const HOST_TOOL_METHODS = new Set([
  'moss.host/v1:info.get',
  'moss.cloud-storage/v1:status.get', 'moss.cloud-storage/v1:quota.get',
  'moss.cloud-storage/v1:files.list', 'moss.cloud-storage/v1:files.get',
  'moss.cloud-storage/v1:transfers.list', 'moss.cloud-storage/v1:transfers.get',
])

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
    ...(ui.builtin ? { builtin: ui.builtin } : { entry: ensureSafeRelativePath(ui.entry, 'ui.entry') }),
    window: {
      width: Number(ui.window?.width) || 1100,
      height: Number(ui.window?.height) || 760,
      resizable: ui.window?.resizable !== false,
    },
  }
}

function normalizeContributionPermission(item, requestedPermissions, label) {
  if (!item.permission) return {}
  if (!requestedPermissions.has(item.permission)) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidManifest,
      `${label} references undeclared permission: ${item.permission}`,
    )
  }
  return { permission: item.permission }
}

function normalizeContributionList(items, kind, normalize, ids = new Set()) {
  return (items || []).map((item) => {
    if (ids.has(item.id)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate App contribution id: ${item.id}`)
    }
    ids.add(item.id)
    return normalize(item)
  })
}

function normalizeContributes(contributes, manifest) {
  if (!contributes) return undefined
  const contributionIds = new Set()
  const requestedPermissions = new Set(manifest.permissions || [])
  const actions = new Map(manifest.backend?.actions?.map((action) => [action.name, action]) || [])
  const requireAction = (action, label) => {
    if (!actions.has(action)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `${label} references unknown Backend action: ${action}`)
    }
    return actions.get(action)
  }
  const views = normalizeContributionList(contributes.views, 'view', (view) => ({
    id: view.id,
    title: view.title.trim(),
    route: view.route || '#/',
    icon: String(view.icon || '').trim(),
    order: Number(view.order) || 0,
    ...normalizeContributionPermission(view, requestedPermissions, `view ${view.id}`),
  }), contributionIds)
  if (views.length && !manifest.ui) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'View contributions require an App UI')
  }
  const viewIds = new Set(views.map((view) => view.id))
  const settings = normalizeContributionList(contributes.settings, 'settings', (setting) => {
    if (!viewIds.has(setting.viewId)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `settings ${setting.id} references unknown view: ${setting.viewId}`)
    }
    return {
      id: setting.id,
      title: setting.title.trim(),
      viewId: setting.viewId,
      ...(setting.group ? { group: setting.group } : {}),
      order: Number(setting.order) || 0,
      ...normalizeContributionPermission(setting, requestedPermissions, `settings ${setting.id}`),
    }
  }, contributionIds)
  const commands = normalizeContributionList(contributes.commands, 'command', (command) => {
    const action = requireAction(command.action, `command ${command.id}`)
    const inputSchema = command.inputSchema
      ? ensureSafeRelativePath(command.inputSchema, `command ${command.id} inputSchema`)
      : undefined
    if (inputSchema && inputSchema !== action.inputSchema) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `command ${command.id} inputSchema must match its Backend action`)
    }
    return {
      id: command.id,
      title: command.title.trim(),
      description: String(command.description || '').trim(),
      action: command.action,
      ...(command.listAction ? { listAction: requireAction(command.listAction, `command ${command.id} listAction`).name } : {}),
      ...(inputSchema ? { inputSchema } : {}),
      ...normalizeContributionPermission(command, requestedPermissions, `command ${command.id}`),
    }
  }, contributionIds)
  const services = normalizeContributionList(contributes.services, 'service', service => ({
    id: service.id, title: service.title.trim(), description: String(service.description || '').trim(),
  }), contributionIds)
  if (services.some(service => !service.title)) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Service title cannot be blank')
  const serviceIds = new Set(services.map(service => service.id))
  const tools = normalizeContributionList(contributes.tools, 'tool', (tool) => {
    if ((tool.serviceId && !serviceIds.has(tool.serviceId)) || (manifest.toolSelection === 'services' && !tool.serviceId)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Each tool in a services App must reference a declared serviceId')
    }
    const native = tool.execution === 'native'
    const host = tool.execution === 'host'
    if (native && (!manifest.nativeAdapter || tool.permission !== 'desktop:control' || manifest.toolScope !== 'session')) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Native tools require a nativeAdapter, desktop:control permission and session scope')
    }
    if (host) {
      const target = `${tool.host?.protocol}:${tool.host?.method}`
      const member = contracts[tool.host?.protocol]?.methods?.[tool.host?.method]
      if (!semver.subset(manifest.hostApi, '>=3.17.0') || !HOST_TOOL_METHODS.has(target) || !member
        || !manifest.host?.protocols?.includes(tool.host.protocol) || tool.action !== undefined || tool.effect !== 'read'
        || (member.permission || undefined) !== tool.permission || (member.permission && !requestedPermissions.has(member.permission))) {
        throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `tool ${tool.id} has an invalid Host method mapping`)
      }
    } else if (!tool.action || tool.host) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `tool ${tool.id} requires a Backend or native action`)
    }
    const action = native || host ? null : requireAction(tool.action, `tool ${tool.id}`)
    const inputSchema = ensureSafeRelativePath(tool.inputSchema, `tool ${tool.id} inputSchema`)
    const outputSchema = tool.outputSchema
      ? ensureSafeRelativePath(tool.outputSchema, `tool ${tool.id} outputSchema`)
      : undefined
    if (action && (action.inputSchema !== inputSchema || (outputSchema && action.outputSchema !== outputSchema))) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `tool ${tool.id} schemas must match its Backend action`)
    }
    return {
      id: tool.id,
      title: tool.title.trim(),
      description: tool.description.trim(),
      ...(tool.action ? { action: tool.action } : {}),
      ...(host ? { host: { protocol: tool.host.protocol, method: tool.host.method }, execution: 'host' } : {}),
      ...(tool.serviceId ? { serviceId: tool.serviceId } : {}),
      ...(native ? { execution: 'native' } : {}),
      ...(tool.instructions ? { instructions: ensureSafeRelativePath(tool.instructions, `tool ${tool.id} instructions`) } : {}),
      inputSchema,
      ...(outputSchema ? { outputSchema } : {}),
      effect: tool.effect,
      ...normalizeContributionPermission(tool, requestedPermissions, `tool ${tool.id}`),
    }
  }, contributionIds)
  const schemes = new Set()
  const resourceProviders = normalizeContributionList(contributes.resourceProviders, 'resource provider', (provider) => {
    for (const scheme of provider.schemes) {
      if (schemes.has(scheme)) {
        throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate resource scheme in App: ${scheme}`)
      }
      schemes.add(scheme)
    }
    return {
      id: provider.id,
      schemes: [...provider.schemes],
      ...(provider.authoring ? { authoring: { target: provider.authoring.target, intents: [...provider.authoring.intents] } } : {}),
      ...(provider.title ? { title: provider.title.trim() } : {}),
      ...(provider.listAction ? { listAction: requireAction(provider.listAction, `resource provider ${provider.id}`).name } : {}),
      resolveAction: requireAction(provider.resolveAction, `resource provider ${provider.id}`).name,
      ...normalizeContributionPermission(provider, requestedPermissions, `resource provider ${provider.id}`),
    }
  }, contributionIds)
  const widgets = normalizeContributionList(contributes.widgets, 'widget', (widget) => {
    if (!viewIds.has(widget.viewId)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `widget ${widget.id} references unknown view: ${widget.viewId}`)
    }
    return {
      id: widget.id,
      title: widget.title.trim(),
      viewId: widget.viewId,
      placement: widget.placement,
      ...normalizeContributionPermission(widget, requestedPermissions, `widget ${widget.id}`),
    }
  }, contributionIds)
  const skills = normalizeContributionList(contributes.skills, 'skill', skill => ({
    id: skill.id, title: skill.title.trim(), description: skill.description.trim(),
    path: ensureSafeRelativePath(skill.path, `skill ${skill.id} path`),
    cli: ensureSafeRelativePath(skill.cli, `skill ${skill.id} cli`),
  }), contributionIds)
  const normalized = { views, settings, commands, tools, resourceProviders, widgets, ...(services.length ? { services } : {}), ...(skills.length ? { skills } : {}) }
  return Object.values(normalized).some((items) => items.length) ? normalized : undefined
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
    actions,
    ...(backend.configuration ? {
      configuration: {
        ...(backend.configuration.schema ? { schema: ensureSafeRelativePath(backend.configuration.schema, 'backend.configuration.schema') } : {}),
        ...(backend.configuration.secrets ? { secrets: ensureSafeRelativePath(backend.configuration.secrets, 'backend.configuration.secrets') } : {}),
      },
    } : {}),
  }
}

function normalizeAppCapabilities(candidate) {
  const capabilities = candidate.appCapabilities
  if (!capabilities) return undefined
  if (!semver.subset(candidate.hostApi, '>=3.18.0')) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Cross-App capabilities require hostApi >=3.18.0')
  }
  const provides = capabilities.provides || []
  const requires = capabilities.requires || []
  const usesTools = capabilities.usesTools || []
  if (usesTools.length && !semver.subset(candidate.hostApi, '>=3.19.0')) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Cross-App tool calls require hostApi >=3.19.0')
  }
  if (provides.length && !candidate.backend) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Cross-App providers require a Backend')
  }
  if ((requires.length || usesTools.length) && (!candidate.host?.protocols?.includes('moss.app-capabilities/v1')
    || !candidate.permissions.includes('apps:invoke'))) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Cross-App consumers require moss.app-capabilities/v1 and apps:invoke')
  }
  const actionMap = new Map((candidate.backend?.actions || []).map(action => [action.name, action]))
  const permissions = new Set(candidate.permissions)
  const protocols = new Set()
  for (const provider of provides) {
    if (protocols.has(provider.protocol)) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate provided protocol: ${provider.protocol}`)
    protocols.add(provider.protocol)
    const methods = new Set()
    for (const method of provider.methods) {
      if (methods.has(method.name)) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate provided method: ${provider.protocol} ${method.name}`)
      methods.add(method.name)
      const action = actionMap.get(method.action)
      if (!action?.inputSchema || !action?.outputSchema) {
        throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Provided method ${provider.protocol} ${method.name} requires a declared Action with input and output schemas`)
      }
      if (!permissions.has(method.permission)) {
        throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Provided method ${provider.protocol} ${method.name} references undeclared permission`)
      }
    }
    for (const method of provider.methods) if (method.resourceReadMethod) {
      const read = provider.methods.find(item => item.name === method.resourceReadMethod)
      if (!read || read.resourceReadMethod || read.name === method.name) {
        throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Provided method ${provider.protocol} ${method.name} references an invalid resource reader`)
      }
      if (read.permission !== method.permission) {
        throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Provided method ${provider.protocol} ${method.name} and its resource reader must use the same permission`)
      }
    }
  }
  const dependencies = new Set()
  for (const dependency of requires) {
    if (dependencies.has(dependency.protocol)) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate required protocol: ${dependency.protocol}`)
    dependencies.add(dependency.protocol)
  }
  const toolTargets = new Set()
  for (const target of usesTools) {
    if (target.appId === candidate.id) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'An App cannot declare its own tools as cross-App dependencies')
    if (toolTargets.has(target.appId)) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate cross-App tool target: ${target.appId}`)
    toolTargets.add(target.appId)
    if (target.tools.some(name => name !== name.trim())) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Cross-App tool names must not have surrounding whitespace: ${target.appId}`)
    }
  }
  return {
    provides: provides.map(provider => ({ protocol: provider.protocol, methods: provider.methods.map(method => ({ ...method })) })),
    requires: requires.map(dependency => ({ protocol: dependency.protocol, optional: dependency.optional === true })),
    usesTools: usesTools.map(target => ({ appId: target.appId, tools: [...target.tools] })),
  }
}

function validateNavigation(manifest, contributes, required) {
  const navigation = manifest.navigation
  const settings = contributes?.settings || []
  const invalid = message => { throw new AppServiceError(APP_ERROR_CODES.invalidManifest, message) }
  if (required && !navigation) invalid('New App builds must explicitly declare navigation by intended use')
  if (!navigation && !settings.some(setting => setting.group)) return
  if (!semver.subset(manifest.hostApi, '>=3.4.0')) invalid('navigation and settings.group require hostApi >=3.4.0')
  const views = new Map((contributes?.views || []).map(view => [view.id, view]))
  const settingsRoutes = new Set()
  for (const setting of settings) {
    if (navigation && !setting.group) invalid(`settings ${setting.id} must declare a group`)
    const route = views.get(setting.viewId)?.route
    if (settingsRoutes.has(route)) invalid('A settings page must not be registered more than once')
    settingsRoutes.add(route)
  }
  if (!navigation) return
  if (navigation.location === 'none') {
    if (navigation.viewId !== undefined || settings.length) invalid('navigation none must not declare viewId or settings contributions')
    return
  }
  const view = views.get(navigation.viewId)
  if (!manifest.ui || !view) invalid('navigation requires an App UI and a valid viewId')
  if (navigation.location === 'settings' && settings.filter(setting => setting.viewId === view.id).length !== 1) {
    invalid('navigation settings must reference exactly one settings contribution')
  }
  if (navigation.location === 'more' && settingsRoutes.has(view.route)) {
    invalid('The main operational page and settings pages must use different routes')
  }
}

export function validateAppManifest(rawManifest, options = {}) {
  if (rawManifest?.backend && Object.hasOwn(rawManifest.backend, 'protocols')) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Declare App Host protocols in host.protocols')
  const candidate = structuredClone(rawManifest)
  if (candidate && Object.hasOwn(candidate, 'appCapabilities') && !validateAppCapabilitiesSchema(candidate.appCapabilities)) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidManifest,
      `Invalid appCapabilities declaration: ${formatAjvErrors(validateAppCapabilitiesSchema.errors)}`,
      validateAppCapabilitiesSchema.errors,
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
  if (candidate.publisher && !candidate.publisher.name.trim()) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'publisher.name cannot contain only whitespace')
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
  if (candidate.toolScope !== undefined && !semver.subset(candidate.hostApi, '>=3.1.0')) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'toolScope requires hostApi >=3.1.0')
  }
  if ((candidate.nativeAdapter || candidate.contributes?.tools?.some(tool => tool.instructions || tool.execution)) && !semver.subset(candidate.hostApi, '>=3.2.0')) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Native adapters and tool instructions require hostApi >=3.2.0')
  }
  if (candidate.nativeAdapter && (!candidate.publisher || !candidate.permissions.includes('desktop:control'))) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Native adapters require a publisher and desktop:control permission')
  }
  if (candidate.platforms && !semver.subset(candidate.hostApi, '>=3.3.0')) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'platforms requires hostApi >=3.3.0')
  }
  if ((candidate.toolSelection !== undefined || candidate.contributes?.services?.length || candidate.contributes?.tools?.some(tool => tool.serviceId)) && !semver.subset(candidate.hostApi, '>=3.8.0')) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'App subservices require hostApi >=3.8.0')
  }
  if (candidate.host?.protocols?.some(protocol => ['moss.runtime/v1', 'moss.artifacts/v1'].includes(protocol)) && !semver.subset(candidate.hostApi, '>=3.17.0')) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Backend activity and artifact services require hostApi >=3.17.0')
  }
  if (candidate.toolSelection !== 'services' && (candidate.contributes?.services?.length || candidate.contributes?.tools?.some(tool => tool.serviceId))) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Service declarations require toolSelection services')
  }
  if (candidate.mcpApp || candidate.ui?.builtin) {
    if (!semver.subset(candidate.hostApi, '>=3.9.0')) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'MCP configuration Apps require hostApi >=3.9.0')
    if (candidate.mcpApp?.config && candidate.ui?.entry && !semver.subset(candidate.hostApi, '>=3.17.0')) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Custom MCP App UI requires hostApi >=3.17.0')
    }
    if (!candidate.mcpApp || (!candidate.ui?.entry && candidate.ui?.builtin !== 'mcp') || candidate.backend || candidate.nativeAdapter) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'MCP configuration Apps require the Core builtin UI or a custom UI and no Backend or native adapter')
    }
    if (candidate.mcpApp.runtime?.state !== 'stateless' && candidate.mcpApp.runtime?.idleTimeoutMs !== undefined) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Idle recycling requires an explicitly stateless MCP App')
    const permissions = ['mcp:read', 'mcp:manage', 'mcp:connect']
    const allowedPermissions = candidate.ui?.entry ? [...permissions, 'mcp:auth'] : permissions
    if (!permissions.every(permission => candidate.permissions.includes(permission))
      || candidate.permissions.some(permission => !allowedPermissions.includes(permission))
      || !candidate.host?.protocols?.includes('moss.mcp/v1')
      || candidate.host.protocols.some(protocol => !['moss.mcp/v1', 'moss.host/v1'].includes(protocol))) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'MCP App requires only the MCP Host permissions and protocols')
    }
  }
  if (candidate.contributes?.skills?.length && candidate.toolSelection === 'services') {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'App skills require whole-app selection')
  }
  if (candidate.contributes?.skills?.length && !semver.subset(candidate.hostApi, '>=3.14.0')) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'App skills require hostApi >=3.14.0')
  }
  if (candidate.connectorApp) {
    if (!semver.subset(candidate.hostApi, '>=3.15.0')) throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Connector Apps require hostApi >=3.15.0')
    if (candidate.ui || candidate.backend || candidate.mcpApp || candidate.nativeAdapter || candidate.contributes || candidate.host
      || (candidate.toolScope && candidate.toolScope !== 'session') || candidate.toolSelection === 'services' || candidate.permissions.length !== 1 || candidate.permissions[0] !== 'connector:use'
      || candidate.navigation?.location !== 'none') {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'Connector Apps require host-managed configuration and connector:use permission')
    }
  }
  const contributes = normalizeContributes(candidate.contributes, candidate)
  const appCapabilities = normalizeAppCapabilities(candidate)
  validateNavigation(candidate, contributes, options.requireNavigation)
  return {
    schemaVersion: 2,
    id: candidate.id,
    version: candidate.version,
    displayName: candidate.displayName.trim(),
    description: String(candidate.description || '').trim(),
    category: candidate.category || 'other',
    ...(candidate.discovery ? { discovery: structuredClone(candidate.discovery) } : {}),
    ...(candidate.connectorApp ? { connectorApp: structuredClone(candidate.connectorApp) } : {}),
    keywords: [...new Set((candidate.keywords || []).map(keyword => keyword.trim()))],
    icon: candidate.icon ? ensureSafeRelativePath(candidate.icon, 'icon') : '',
    hostApi: candidate.hostApi,
    ...(candidate.mcpApp ? { mcpApp: { config: ensureSafeRelativePath(candidate.mcpApp.config, 'mcpApp.config'), ...(candidate.mcpApp.runtime ? { runtime: candidate.mcpApp.runtime } : {}), ...(candidate.mcpApp.presentation ? { presentation: candidate.mcpApp.presentation } : {}) } } : {}),
    ...(candidate.platforms ? { platforms: [...candidate.platforms] } : {}),
    ...(candidate.toolSelection ? { toolSelection: candidate.toolSelection } : {}),
    ...(candidate.toolScope ? { toolScope: candidate.toolScope } : {}),
    ...(candidate.navigation ? { navigation: { ...candidate.navigation } } : {}),
    ...(!candidate.connectorApp ? { host: { protocols: [...(candidate.host?.protocols || [])] } } : {}),
    ...(candidate.publisher ? { publisher: { id: candidate.publisher.id, name: candidate.publisher.name.trim() } } : {}),
    ...(candidate.ui ? { ui: normalizeUi(candidate.ui) } : {}),
    ...(candidate.backend ? { backend: normalizeBackend(candidate.backend) } : {}),
    ...(candidate.nativeAdapter ? { nativeAdapter: { kind: 'desktop-control', apiVersion: 1, entry: ensureSafeRelativePath(candidate.nativeAdapter.entry, 'nativeAdapter.entry') } } : {}),
    ...(contributes ? { contributes } : {}),
    ...(appCapabilities ? { appCapabilities } : {}),
    permissions: [...candidate.permissions],
  }
}

export function resolveAppProtocols(manifest) {
  return [...new Set(['moss.host/v1', ...(manifest?.host?.protocols || [])])]
}

// App Tools expose their declared schema unchanged as a model function input.
// This root contract does not restrict ordinary Backend Action schemas.
export function validateAppToolInputSchema(schema, fieldName = 'App Tool input schema') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'object') {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `${fieldName} must describe an object`)
  }
  const unsupported = ['oneOf', 'anyOf', 'allOf', 'enum', 'const', 'not']
    .filter((keyword) => Object.hasOwn(schema, keyword))
  if (unsupported.length) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidManifest,
      `${fieldName} must not declare top-level ${unsupported.join(', ')}; declare argument fields in properties and validate cross-field rules in the Backend`,
    )
  }
  return schema
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

export function compileJsonSchema(schema, options = {}) {
  return new Ajv2020({
    allErrors: true,
    strict: false,
    ...(options.removeAdditional ? { removeAdditional: true } : {}),
  }).compile(schema || {})
}
