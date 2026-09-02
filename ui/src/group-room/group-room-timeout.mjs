export class PausableDeadline {
  #callback;
  #remainingMs;
  #startedAt = 0;
  #timer = null;
  #paused = false;
  #cleared = false;

  constructor(timeoutMs, callback) {
    this.#remainingMs = Math.max(0, Number(timeoutMs) || 0);
    this.#callback = callback;
    this.#schedule();
  }

  #schedule() {
    if (this.#cleared || this.#paused || this.#timer) return;
    this.#startedAt = Date.now();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#cleared || this.#paused) return;
      this.#remainingMs = 0;
      this.#cleared = true;
      this.#callback();
    }, this.#remainingMs);
    this.#timer.unref?.();
  }

  pause() {
    if (this.#cleared || this.#paused) return;
    this.#paused = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
      this.#remainingMs = Math.max(0, this.#remainingMs - (Date.now() - this.#startedAt));
    }
  }

  resume() {
    if (this.#cleared || !this.#paused) return;
    this.#paused = false;
    this.#schedule();
  }

  clear() {
    this.#cleared = true;
    this.#paused = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
