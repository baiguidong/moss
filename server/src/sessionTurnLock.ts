export class SessionTurnLock {
  private readonly tails = new Map<string, Promise<void>>()

  async acquire(sessionId: string): Promise<() => void> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    let resolveCurrent: () => void = () => {}
    const current = new Promise<void>(resolve => {
      resolveCurrent = resolve
    })
    const tail = previous.catch(() => {}).then(() => current)
    this.tails.set(sessionId, tail)
    await previous.catch(() => {})

    let released = false
    return () => {
      if (released) return
      released = true
      // Let the runner's broadcast of the completed turn drain to every socket
      // before another connection becomes the owner of this session.
      setImmediate(() => {
        resolveCurrent()
        void tail.finally(() => {
          if (this.tails.get(sessionId) === tail) {
            this.tails.delete(sessionId)
          }
        })
      })
    }
  }
}
