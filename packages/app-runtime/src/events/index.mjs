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

  subscribeApp(appId, listener) {
    const name = `app:${appId}`
    this.on(name, listener)
    return () => this.off(name, listener)
  }
}
