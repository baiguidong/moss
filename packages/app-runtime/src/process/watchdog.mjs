// A delayed Host cannot judge a Backend using responses queued while it was
// asleep or blocked. Give IPC a fresh response window when polling resumes.
export function createAppWatchdog({ timeoutMs, intervalMs, now = Date.now }) {
  let lastCheckAt = now()
  let deadlineAt = lastCheckAt + timeoutMs
  return {
    get deadlineAt() { return deadlineAt },
    refresh() {
      lastCheckAt = now()
      deadlineAt = lastCheckAt + timeoutMs
    },
    expired() {
      const time = now()
      const elapsed = time - lastCheckAt
      if (elapsed < 0 || elapsed > intervalMs * 2) deadlineAt = time + timeoutMs
      lastCheckAt = time
      return time >= deadlineAt
    },
  }
}
