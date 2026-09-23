// Per-workspace file watcher fanning out debounced change events to SSE
// clients. One watcher per workspace directory, created on first subscriber
// and closed when the last subscriber leaves.
const fs = require('node:fs');
const path = require('node:path');

const DEBOUNCE_MS = 150;

class WorkspaceWatcher {
  constructor(dir, prototypePath) {
    this.dir = dir;
    this.roots = [path.join(dir, prototypePath), path.join(dir, '.git')];
    this.clients = new Set();
    this.watchers = [];
    this.timer = null;
    this.onChange = null;
  }

  start() {
    for (const root of this.roots) {
      try {
        const watcher = fs.watch(root, { recursive: true }, () => this.schedule());
        watcher.on('error', () => {});
        this.watchers.push(watcher);
      } catch {
        // Missing path (e.g. prototypePath absent on this ref): nothing to watch.
      }
    }
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange?.();
    }, DEBOUNCE_MS);
  }

  broadcast(event, payload) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.clients) res.write(frame);
  }

  close() {
    clearTimeout(this.timer);
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }
}

class WatchRegistry {
  constructor() {
    this.watchers = new Map();
  }

  subscribe(id, dir, prototypePath, res, onChange) {
    let watcher = this.watchers.get(id);
    if (!watcher) {
      watcher = new WorkspaceWatcher(dir, prototypePath);
      watcher.onChange = () => onChange(watcher);
      watcher.start();
      this.watchers.set(id, watcher);
    }
    watcher.clients.add(res);
    res.on('close', () => {
      watcher.clients.delete(res);
      if (!watcher.clients.size) {
        watcher.close();
        this.watchers.delete(id);
      }
    });
    return watcher;
  }

  drop(id) {
    const watcher = this.watchers.get(id);
    if (!watcher) return;
    for (const res of watcher.clients) res.end();
    watcher.close();
    this.watchers.delete(id);
  }
}

module.exports = { WatchRegistry };
