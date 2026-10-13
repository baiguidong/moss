import fs from 'node:fs/promises'
import path from 'node:path'
import { createAppRuntime } from './app-runtime.mjs'
import { defaultInstanceId } from '../../../packages/app-runtime/src/state/index.mjs'

export function createAuthoringPreview({ root, getRuntime, nodeExecutable, openWindow }) {
  return async (artifact, { previewRef, grants, config, signal, onClosed }) => {
    const previewRoot = path.join(root, previewRef)
    await fs.mkdir(previewRoot, { recursive: false })
    const host = getRuntime().hostCapabilities
    const clean = definition => Object.fromEntries(Object.entries(definition).filter(([, value]) => value != null))
    const members = entries => Object.fromEntries([...entries].map(([name, definition]) => [name, clean(definition)]))
    const protocols = [...host.protocols.values()].filter(protocol => protocol.protocol !== 'moss.host/v1').map(protocol => ({
      ...clean(protocol), methods: members(protocol.methods), events: members(protocol.events),
    }))
    const handlers = Object.fromEntries([...host.handlers].map(([protocol, methods]) => [protocol,
      // Each preview runtime creates its own built-in handlers bound to its identity/state.
      Object.fromEntries([...methods].filter(([name]) => !(protocol === 'moss.host/v1' && ['capabilities.get', 'native.settings'].includes(name)))),
    ]))
    let runtime, window, closed = false
    const close = async () => {
      if (closed) return
      closed = true
      window?.close?.()
      await runtime?.shutdown()
      await fs.rm(previewRoot, { recursive: true, force: true })
    }
    try {
      runtime = await createAppRuntime({ mossHome: previewRoot, appsDir: path.join(previewRoot, 'apps'), nodeExecutable,
        hostProtocols: protocols, hostHandlers: handlers })
      await runtime.installFromDirectory(artifact.directory, { grants })
      const manifest = artifact.manifest, instanceId = defaultInstanceId(manifest.id)
      if (manifest.backend) {
        await runtime.updateInstance(manifest.id, instanceId, { config })
        await runtime.setInstanceEnabled(manifest.id, instanceId, true)
      }
      await runtime.setAppEnabled(manifest.id, true)
      signal.throwIfAborted()
      if (manifest.ui) window = await openWindow({ artifact, runtime, previewRoot })
      window?.once?.('closed', () => { void close().then(() => onClosed?.()).catch(() => {}) })
      return { close, test: (action, input, actionSignal) => {
        if (closed) throw new Error('Preview is closed')
        if (!manifest.backend?.actions.some(item => item.name === action)) throw new Error('Action is not declared by the preview artifact')
        return runtime.invoke(manifest.id, instanceId, action, input, { signal: actionSignal, timeoutMs: 30000, invocation: { surface: 'app', origin: 'preview' } })
      } }
    } catch (error) { await close(); throw error }
  }
}
