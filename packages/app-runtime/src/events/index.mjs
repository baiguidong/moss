import { EventEmitter } from 'node:events'

export class AppEventBroker extends EventEmitter {
  constructor() {
    super({ captureRejections: true })
    this.setMaxListeners(1000)
    this.on('error', () => {})
  }

  publish(event) {
    const normalized = { timestamp: Date.now(), ...event }
    this.emit('event', normalized)
    if (normalized.appId) this.emit(`app:${normalized.appId}`, normalized)
    if (normalized.instanceId) this.emit(`instance:${normalized.instanceId}`, normalized)
    return normalized
  }

  subscribeApp(appId, listener, options = {}) {
    const name = `app:${appId}`
    const ownerKey = options.owner?.key || null
    const scopedListener = ownerKey
      ? (event) => { if (event.owner?.key === ownerKey) listener(event) }
      : listener
    this.on(name, scopedListener)
    return () => this.off(name, scopedListener)
  }
}
