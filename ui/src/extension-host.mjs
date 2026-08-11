import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

function ensureInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath)
  const resolvedTarget = path.resolve(targetPath)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside the extension root')
  }
  return resolvedTarget
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return `sha256-${hash.digest('base64')}`
}

function matchesSchema(schema, value) {
  if (!schema || typeof schema !== 'object') return true
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    for (const key of schema.required || []) {
      if (!(key in value)) return false
    }
  }
  if (schema.type === 'string') return typeof value === 'string'
  if (schema.type === 'number') return typeof value === 'number'
  if (schema.type === 'boolean') return typeof value === 'boolean'
  if (schema.type === 'array') return Array.isArray(value)
  return true
}

function assertKnownContribution(manifest, extensionId, kind, name) {
  const entries = Array.isArray(manifest?.contributes?.[kind])
    ? manifest.contributes[kind]
    : []
  const localName = name.startsWith(`${extensionId}.`)
    ? name.slice(extensionId.length + 1)
    : name
  const found = entries.find(entry => {
    const contributedName = entry.name || entry.command
    return contributedName === name ||
      contributedName === localName ||
      `${extensionId}.${contributedName}` === name
  })
  if (!found) {
    throw new Error(`Extension tried to register undeclared ${kind.slice(0, -1)}: ${name}`)
  }
  return found
}

export class ExtensionHost {
  constructor({ extensionLock = {}, logger = console } = {}) {
    this.extensionLock = extensionLock || {}
    this.logger = logger
    this.commands = new Map()
    this.tools = new Map()
    this.loaded = false
    this.deactivators = []
    this.status = {}
  }

  async activateAll() {
    if (this.loaded) return
    for (const [extensionId, locked] of Object.entries(this.extensionLock)) {
      await this.activateExtension(extensionId, locked)
    }
    this.loaded = true
  }

  async activateExtension(extensionId, locked) {
    const root = locked?.root
    if (!root) {
      throw new Error(`Extension lock is missing root for ${extensionId}`)
    }
    const rootPath = path.resolve(root)
    const manifestPath = ensureInsideRoot(rootPath, path.join(rootPath, 'extension.moss.json'))
    if (locked?.integrity && sha256File(manifestPath) !== locked.integrity) {
      throw new Error(`Extension manifest integrity mismatch: ${extensionId}`)
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const main = String(manifest.main || 'dist/extension.js')
    const mainPath = ensureInsideRoot(rootPath, path.resolve(rootPath, main))
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Extension main not found: ${mainPath}`)
    }
    ensureInsideRoot(fs.realpathSync(rootPath), fs.realpathSync(mainPath))

    const context = {
      extensionId,
      extensionPath: root,
      subscriptions: [],
      commands: {
        registerCommand: (name, handler) => {
          const contribution = assertKnownContribution(manifest, extensionId, 'commands', name)
          const fullName = name.includes('.') ? name : `${extensionId}.${name}`
          this.commands.set(fullName, { extensionId, handler, contribution })
          return { dispose: () => this.commands.delete(fullName) }
        },
      },
      tools: {
        registerTool: (name, definition) => {
          const contribution = assertKnownContribution(manifest, extensionId, 'tools', name)
          const fullName = name.includes('.') ? name : `${extensionId}.${name}`
          this.tools.set(fullName, {
            extensionId,
            handler: definition?.handler,
            inputSchema: definition?.inputSchema || contribution.inputSchema,
            permissions: definition?.permissions || contribution.permissions || [],
            contribution,
          })
          return { dispose: () => this.tools.delete(fullName) }
        },
      },
      log: {
        info: (...args) => this.logger.info?.('[extension]', extensionId, ...args),
        warn: (...args) => this.logger.warn?.('[extension]', extensionId, ...args),
        error: (...args) => this.logger.error?.('[extension]', extensionId, ...args),
      },
    }

    try {
      const mod = await import(`${pathToFileURL(mainPath).href}?t=${Date.now()}`)
      if (typeof mod.activate !== 'function') {
        throw new Error(`Extension has no activate(context): ${extensionId}`)
      }
      const result = await mod.activate(context)
      if (typeof result?.deactivate === 'function') {
        this.deactivators.push(result.deactivate)
      }
      for (const subscription of context.subscriptions) {
        if (subscription && typeof subscription.dispose === 'function') {
          this.deactivators.push(() => subscription.dispose())
        }
      }
      this.status[extensionId] = {
        state: 'active',
        version: locked?.version || manifest.version || null,
        commands: [...this.commands.keys()].filter(name => this.commands.get(name)?.extensionId === extensionId),
        tools: [...this.tools.keys()].filter(name => this.tools.get(name)?.extensionId === extensionId),
      }
    } catch (error) {
      this.status[extensionId] = {
        state: 'error',
        version: locked?.version || manifest.version || null,
        error: error.message || String(error),
      }
      throw error
    }
  }

  async executeCommand(name, args) {
    await this.activateAll()
    const command = this.commands.get(name)
    if (!command) throw new Error(`Unknown command: ${name}`)
    return command.handler(args)
  }

  async callTool(name, args) {
    await this.activateAll()
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    if (!matchesSchema(tool.inputSchema, args || {})) {
      throw new Error(`Tool arguments do not match inputSchema: ${name}`)
    }
    if (typeof tool.handler !== 'function') {
      throw new Error(`Tool has no handler: ${name}`)
    }
    return tool.handler(args || {})
  }

  async dispose() {
    for (const deactivate of this.deactivators.splice(0)) {
      try {
        await deactivate()
      } catch (error) {
        this.logger.warn?.('[extension] deactivate failed', error?.message || error)
      }
    }
    this.commands.clear()
    this.tools.clear()
    this.status = {}
    this.loaded = false
  }

  getStatus() {
    return {
      loaded: this.loaded,
      extensions: this.status,
      commands: [...this.commands.keys()],
      tools: [...this.tools.keys()],
    }
  }
}
