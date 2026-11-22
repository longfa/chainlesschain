/** Runner lifecycle timing and bounded FIFO hook admission. */
export class RunnerLifecycleMetrics {
  constructor({ now = () => Date.now(), hookConcurrency = 4 } = {}) {
    this.now = now;
    if (!Number.isSafeInteger(hookConcurrency) || hookConcurrency < 1)
      throw new RangeError(
        "runner hook concurrency must be a positive integer",
      );
    this.hookConcurrency = hookConcurrency;
    this.marks = new Map();
    this.activeHooks = 0;
    this.waitingHooks = [];
  }

  mark(stage, at = this.now()) {
    if (!["ordered", "registered", "first-session"].includes(stage))
      throw new Error(`unknown runner lifecycle stage: ${stage}`);
    if (!Number.isFinite(at))
      throw new TypeError("invalid runner lifecycle timestamp");
    if (!this.marks.has(stage)) this.marks.set(stage, at);
    return this;
  }

  async runHook(hook, ...args) {
    if (typeof hook !== "function")
      throw new TypeError("runner hook is required");
    if (this.activeHooks >= this.hookConcurrency) {
      await new Promise((resolve) => this.waitingHooks.push(resolve));
    } else this.activeHooks += 1;
    try {
      return await hook(...args);
    } finally {
      const next = this.waitingHooks.shift();
      if (next) next();
      else this.activeHooks -= 1;
    }
  }

  snapshot() {
    const ordered = this.marks.get("ordered") ?? null;
    const registered = this.marks.get("registered") ?? null;
    const firstSession = this.marks.get("first-session") ?? null;
    return {
      order_to_registered_seconds:
        ordered != null && registered != null
          ? Math.max(0, (registered - ordered) / 1000)
          : null,
      order_to_first_session_seconds:
        ordered != null && firstSession != null
          ? Math.max(0, (firstSession - ordered) / 1000)
          : null,
      registered_to_first_session_seconds:
        registered != null && firstSession != null
          ? Math.max(0, (firstSession - registered) / 1000)
          : null,
      stages: { ordered, registered, "first-session": firstSession },
      hookConcurrency: this.hookConcurrency,
      activeHooks: this.activeHooks,
      queueDepth: this.waitingHooks.length,
    };
  }
}

export default { RunnerLifecycleMetrics };
