class Semaphore {
  #active = 0;
  #limit;
  #queue = [];

  constructor(limit) {
    this.#limit = Math.max(1, Number(limit) || 1);
  }

  acquire(signal) {
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('Aborted'));
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: null };
      entry.onAbort = () => {
        const index = this.#queue.indexOf(entry);
        if (index >= 0) this.#queue.splice(index, 1);
        reject(signal.reason || new Error('Aborted'));
      };
      if (signal) signal.addEventListener('abort', entry.onAbort, { once: true });
      this.#queue.push(entry);
      this.#drain();
    });
  }

  #drain() {
    while (this.#active < this.#limit && this.#queue.length > 0) {
      const entry = this.#queue.shift();
      if (entry.signal?.aborted) continue;
      if (entry.signal) entry.signal.removeEventListener('abort', entry.onAbort);
      this.#active += 1;
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        this.#active -= 1;
        this.#drain();
      });
    }
  }
}

export class RoomExecutionScheduler {
  #global;
  #roomLimit;
  #rooms = new Map();
  #members = new Map();
  #connectors = new Map();

  constructor({ globalLimit = 4, roomLimit = 3 } = {}) {
    this.#global = new Semaphore(globalLimit);
    this.#roomLimit = Math.max(1, Number(roomLimit) || 3);
  }

  #for(map, key, limit) {
    if (!map.has(key)) map.set(key, new Semaphore(limit));
    return map.get(key);
  }

  async run({ roomId, memberId, connectorLeaseIds = [], signal }, task) {
    const releases = [];
    const acquire = async (semaphore) => releases.push(await semaphore.acquire(signal));
    try {
      await acquire(this.#for(this.#members, `${roomId}:${memberId}`, 1));
      for (const connectorId of [...new Set(connectorLeaseIds)].sort()) {
        await acquire(this.#for(this.#connectors, connectorId, 1));
      }
      await acquire(this.#for(this.#rooms, roomId, this.#roomLimit));
      await acquire(this.#global);
      return await task();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }
}
