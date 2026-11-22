/** Monotonic remote runner lifecycle timing with bounded hook admission. */
export class RunnerLifecycleMetrics {
  constructor({ now = () => Date.now(), hookConcurrency = 4 } = {}) {
    this.now = now;
    this.hookConcurrency = Math.max(1, Number(hookConcurrency) || 4);
    this.startedAt = this.now();
    this.marks = new Map();
    this.activeHooks = 0;
    this.queueDepth = 0;
  }

  mark(stage, at = this.now()) {
    if (!["ordered", "registered", "first-session"].includes(stage))
      throw new Error(`unknown runner lifecycle stage: ${stage}`);
    this.marks.set(stage, Number(at));
    return this;
  }

  async runHook(hook, ...args) {
    if (typeof hook !== "function")
      throw new TypeError("runner hook is required");
    if (this.activeHooks >= this.hookConcurrency) {
      this.queueDepth += 1;
      await new Promise((resolve) => {
        const poll = () => {
          if (this.activeHooks < this.hookConcurrency) return resolve();
          setTimeout(poll, 0).unref?.();
        };
        poll();
      });
      this.queueDepth = Math.max(0, this.queueDepth - 1);
    }
    this.activeHooks += 1;
    try {
      return await hook(...args);
    } finally {
      this.activeHooks = Math.max(0, this.activeHooks - 1);
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
      stages: { ordered, registered, "first-session": firstSession },
      hookConcurrency: this.hookConcurrency,
      activeHooks: this.activeHooks,
      queueDepth: this.queueDepth,
    };
  }
}

export default { RunnerLifecycleMetrics };
