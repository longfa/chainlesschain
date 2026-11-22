/**
 * Reference-counted MCP server ownership.
 *
 * A server can be shared by a parent session and several child tasks. A child
 * releasing its lease must never tear down a server still held by another
 * task. The implementation is transport agnostic and can wrap an existing
 * async shutdown callback.
 */
export class McpServerHandle {
  constructor(name, { shutdown } = {}) {
    if (!name || typeof name !== "string")
      throw new TypeError("MCP server handle name is required");
    this.name = name;
    this.holders = new Set();
    this.events = [];
    this.closed = false;
    this.closing = false;
    this._shutdown = typeof shutdown === "function" ? shutdown : async () => {};
  }

  acquire(taskId) {
    if (this.closed || this.closing)
      throw new Error(`MCP server "${this.name}" is shutting down or closed`);
    if (!taskId || typeof taskId !== "string")
      throw new TypeError("MCP server holder taskId is required");
    if (!this.holders.has(taskId)) {
      this.holders.add(taskId);
      this._record("acquired", taskId);
    }
    return this;
  }

  async release(taskId) {
    if (!taskId || !this.holders.has(taskId)) {
      return {
        released: false,
        closed: this.closed,
        holders: this.holders.size,
      };
    }
    this.holders.delete(taskId);
    this._record("released", taskId);
    if (this.holders.size > 0 || this.closed)
      return { released: true, closed: false, holders: this.holders.size };
    this.closing = true;
    try {
      await this._shutdown();
      this.closed = true;
      this._record("shutdown");
    } finally {
      this.closing = false;
    }
    return { released: true, closed: true, holders: 0 };
  }

  _record(type, taskId) {
    this.events.push({ type, ...(taskId ? { taskId } : {}), at: Date.now() });
    if (this.events.length > 256) this.events.shift();
  }

  snapshot() {
    return {
      name: this.name,
      holders: [...this.holders],
      holderCount: this.holders.size,
      closing: this.closing,
      closed: this.closed,
      events: this.events.map((event) => ({ ...event })),
    };
  }
}

export class McpServerHandleRegistry {
  constructor() {
    this.handles = new Map();
  }

  get(name) {
    return this.handles.get(name) || null;
  }

  acquire(name, taskId, options = {}) {
    let handle = this.handles.get(name);
    if (!handle || handle.closed) {
      handle = new McpServerHandle(name, options);
      this.handles.set(name, handle);
    }
    handle.acquire(taskId);
    return handle;
  }

  async release(name, taskId) {
    const handle = this.handles.get(name);
    if (!handle) return { released: false, closed: false, holders: 0 };
    const result = await handle.release(taskId);
    if (result.closed && this.handles.get(name) === handle)
      this.handles.delete(name);
    return result;
  }

  list() {
    return [...this.handles.values()].map((handle) => handle.snapshot());
  }
}

export function createMcpServerHandleRegistry() {
  return new McpServerHandleRegistry();
}

export default {
  McpServerHandle,
  McpServerHandleRegistry,
  createMcpServerHandleRegistry,
};
