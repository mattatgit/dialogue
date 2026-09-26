const activity = (type, message) => ({ id: crypto.randomUUID(), type, message, at: new Date().toISOString(), simulated: true });
// Replace this adapter, not the view, when the new connection layer is ready.
// Simulation never calls a model, publishes a revision, or writes .dialogue-data.
export class MockReviewAdapter {
  constructor(key, storage, delay = 700) {
    this.key = 'dialogue.review.simulation.v1:' + key;
    try { this.storage = storage ?? globalThis.localStorage; } catch { this.storage = null; }
    this.delay = delay; this.listeners = new Set(); this.runs = new Map();
    this.storageAvailable = true;
    try { this.requests = JSON.parse(this.storage.getItem(this.key) || '[]'); }
    catch { this.requests = []; this.storageAvailable = false; }
    if (!Array.isArray(this.requests)) this.requests = [];
    this.requests = this.requests.filter(r => r && typeof r.id === 'string' && r.base && Array.isArray(r.events)).slice(-100);
    for (const r of this.requests) {
      r.events = r.events.filter(e => typeof e === 'string' || (e && typeof e.message === 'string'));
      if (['queued', 'working'].includes(r.status)) {
        r.status = 'failed'; r.error = 'The simulation was interrupted. Retry to run it again.';
      }
    }
    this.save();
  }
  get isBusy() { return this.runs.size > 0; }
  save() {
    try { this.storage.setItem(this.key, JSON.stringify(this.requests)); }
    catch { this.storageAvailable = false; }
  }
  emit() { this.save(); for (const fn of this.listeners) fn(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  listRequests() { return structuredClone(this.requests); }
  listRevisions() { return this.requests.filter(r => r.result).map(r => structuredClone(r.result)); }
  async createRequest({ base, feedback, anchor, scenario = 'success' }) {
    if (!feedback.trim() || feedback.length > 4000) throw new Error('Enter a comment of 1-4000 characters.');
    if (this.runs.size) throw new Error('Wait for the current simulation or cancel it first.');
    const request = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), base: structuredClone(base),
      feedback: feedback.trim(), anchor: structuredClone(anchor), status: 'queued', events: [activity('request_created', 'Simulation queued')], result: null, error: null };
    this.requests.push(request);
    if (this.requests.length > 100) this.requests.shift();
    this.emit(); this.run(request, scenario); return structuredClone(request);
  }
  async run(request, scenario) {
    const controller = new AbortController(); this.runs.set(request.id, controller);
    const wait = () => new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('Cancelled')); };
      const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, this.delay);
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      await wait();
      if (scenario === 'failure') throw new Error('Simulated connection failure. Your comment has been kept.');
      request.status = 'working'; request.events.push(activity('request_acknowledged', 'Simulated: request accepted')); this.emit();
      await wait(); request.events.push(activity('tool_called', 'Simulated: inspecting ' + (request.base.entryPoint || 'index.html'))); this.emit();
      await wait();
      const count = this.requests.filter(r => r.result).length + 1;
      request.result = { ...structuredClone(request.base), id: 'sim-' + request.id, sourceRevisionId: request.base.sourceRevisionId || request.base.id,
        version: 'Demo ' + count, title: 'Demo ' + count + ' (unchanged preview)', simulated: true,
        createdAt: new Date().toISOString(), requestId: request.id };
      request.status = 'complete'; request.events.push(activity('revision_ready', 'Simulated: preview ready')); this.emit();
    } catch (error) {
      request.status = controller.signal.aborted ? 'cancelled' : 'failed';
      request.error = controller.signal.aborted ? 'Simulation cancelled. No prototype files changed.' : error.message;
      this.emit();
    } finally { this.runs.delete(request.id); }
  }
  cancel(id) { this.runs.get(id)?.abort(); }
  retry(id) {
    if (this.runs.size) return;
    const request = this.requests.find(r => r.id === id);
    if (!request || !['failed', 'cancelled'].includes(request.status)) return;
    request.status = 'queued'; request.error = null; request.events = []; this.emit(); this.run(request, 'success');
  }
  dispose() { for (const run of this.runs.values()) run.abort(); this.listeners.clear(); }
}
