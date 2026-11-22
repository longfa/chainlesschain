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
    this._shutdown = typeof shutdown === "function" ? shutdown : async () => {};
  }

  acquire(taskId) {
    if (this.closed) throw new Error(`MCP server "${this.name}" is closed`);
    if (!taskId || typeof taskId !== "string")
      throw new TypeError("MCP server holder taskId is required");
    this.holders.add(taskId);
    this.events.push({ type: "acquired", taskId, at: Date.now() });
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
    this.events.push({ type: "released", taskId, at: Date.now() });
    if (this.holders.size > 0 || this.closed)
      return { released: true, closed: false, holders: this.holders.size };
    await this._shutdown();
    this.closed = true;
    this.events.push({ type: "shutdown", at: Date.now() });
    return { released: true, closed: true, holders: 0 };
  }

  snapshot() {
    return {
      name: this.name,
      holders: [...this.holders],
      holderCount: this.holders.size,
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
    if (result.closed) this.handles.delete(name);
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
