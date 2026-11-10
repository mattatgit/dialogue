// Product identity lives beside, rather than replacing, the legacy Git store.
// Storage slugs are private adapters: changing a name never moves a worktree.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { parseRemote } = require('./deploy-key.js');
const { isValidRefName } = require('./git.js');

class CatalogError extends Error { constructor(status, message) { super(message); this.status = status; } }
const id = prefix => `${prefix}-${randomUUID()}`;
const legacyId = (prefix, slug) => `${prefix}-${createHash('sha256').update(slug).digest('hex').slice(0, 32)}`;
const now = () => new Date().toISOString();
const operationKey = key => { if (key !== undefined && !/^[0-9a-f-]{36}$/.test(key)) throw new CatalogError(400, 'Invalid operation identity.'); return key; };
const text = (value, label, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new CatalogError(400, `Provide a valid ${label}.`);
  return value.trim();
};
const TARGETS = ['Web', 'macOS', 'iOS', 'NixOS'];
function buildPlan(input) {
  const name = text(input.name, 'build name');
  if (!TARGETS.includes(input.target)) throw new CatalogError(400, 'Choose Web, macOS, iOS or NixOS.');
  const root = input.root ?? '.';
  if (typeof root !== 'string' || root.length > 400 || root.includes('\\') || /[\x00-\x1f]/.test(root) || root.startsWith('/') || root.split('/').includes('..')) throw new CatalogError(400, 'The application root must stay inside the repository.');
  const ref = text(input.ref || 'main', 'source branch', 200);
  if (!isValidRefName(ref)) throw new CatalogError(400, 'Choose a valid source branch.');
  const destinationRef = text(input.destinationRef || ref, 'destination branch', 200);
  if (!isValidRefName(destinationRef)) throw new CatalogError(400, 'Choose a valid destination branch.');
  const verification = input.verification || {};
  return { name, target: input.target, root: path.posix.normalize(root || '.'), ref, destinationRef,
    approach: String(input.approach || '').slice(0, 8000), limitations: String(input.limitations || '').slice(0, 8000),
    verification: { clickText: String(verification.clickText || '').slice(0, 160), expectedText: String(verification.expectedText || '').slice(0, 1000) },
    selected: input.selected !== false };
}
function proposal(value) {
  if (!value || !Array.isArray(value.builds) || !value.builds.length || value.builds.length > 12) throw new CatalogError(400, 'Propose between one and twelve builds.');
  return { projectName: text(value.projectName, 'project name'), assessment: String(value.assessment || '').slice(0, 16000), builds: value.builds.map(buildPlan) };
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceView = source => source && ({ id: source.id, url: `https://${source.repo.host}/${source.repo.owner}/${source.repo.repo}`, repo: { host: source.repo.host, owner: source.repo.owner, repo: source.repo.repo }, createdAt: source.createdAt });

class Catalog {
  constructor(file, legacy) { this.file = file; this.legacy = legacy; this.queue = Promise.resolve(); }
  async load() {
    if (this.data) return this.data;
    let data;
    try { data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new CatalogError(500, 'The build catalog could not be read. Existing data was not replaced.'); }
    if (data && (data.schemaVersion !== 1 || !['projects', 'sources', 'builds', 'imports'].every(k => Array.isArray(data[k])))) throw new CatalogError(500, 'Unsupported build catalog. Existing data was not replaced.');
    this.data = data || { schemaVersion: 1, projects: [], sources: [], builds: [], imports: [] };
    // Deterministic identities and the original storage slug make interrupted
    // and repeated migration safe without touching any Git/account files.
    const legacy = await this.legacy.list();
    let changed = !data;
    for (const old of legacy.filter(p => !p.catalogRole)) {
      if (this.data.builds.some(b => b.storageSlug === old.slug)) continue;
      const projectId = legacyId('project', old.slug), sourceId = legacyId('source', old.slug), buildId = legacyId('build', old.slug);
      this.data.projects.push({ id: projectId, name: old.name, legacySlug: old.slug, createdAt: old.createdAt, sourceIds: [sourceId] });
      this.data.sources.push({ id: sourceId, url: old.repo.url, repo: old.repo, keySlug: old.slug, createdAt: old.createdAt });
      this.data.builds.push({ id: buildId, projectId, sourceId, name: old.name, target: 'Web', root: null, ref: null, storageSlug: old.slug,
        recipePath: '.dialogue/preview.json', legacy: true, publication: 'source repository', createdAt: old.createdAt });
      changed = true;
    }
    if (changed) await this.write();
    return this.data;
  }
  async write() {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(this.data, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(temp, this.file); }
    finally { await fs.rm(temp, { force: true }); }
  }
  mutate(fn) {
    const task = this.queue.catch(() => {}).then(async () => { await this.load(); const prior = structuredClone(this.data); try { const result = await fn(this.data); await this.write(); return structuredClone(result); } catch (error) { this.data = prior; throw error; } });
    this.queue = task; return task;
  }
  async snapshot() { await this.queue.catch(() => {}); await this.load(); return structuredClone(this.data); }
  project(data, key) { const p = data.projects.find(p => p.id === key || p.legacySlug === key); if (!p) throw new CatalogError(404, 'Project not found.'); return p; }
  build(data, key) { const b = data.builds.find(b => b.id === key || b.storageSlug === key); if (!b) throw new CatalogError(404, 'Build not found.'); return b; }
  attempt(data, key) { const a = data.imports.find(a => a.id === key); if (!a) throw new CatalogError(404, 'Import not found.'); return a; }
  async createProject(name, operationId) { operationKey(operationId); name = text(name, 'project name'); return this.mutate(data => { const existing = operationId && data.projects.find(p => p.operationId === operationId); if (existing) { if (existing.name !== name) throw new CatalogError(409, 'This creation request already has a different name.'); return existing; } const p = { id: id('project'), name, sourceIds: [], createdAt: now(), operationId }; data.projects.push(p); return p; }); }
  async connect(projectId, url) {
    return this.mutate(data => {
      const remote = parseRemote(String(url || '').trim());
      if (!remote || remote.host !== 'github.com' || remote.port || !/^[A-Za-z0-9-]+$/.test(remote.owner) || !/^[A-Za-z0-9_.-]+$/.test(remote.repo) || !/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/.test(url.trim())) throw new CatalogError(400, 'Use a GitHub repository address without embedded credentials.');
      // Identity belongs to the connection, not the project or URL-derived slug.
      let s = data.sources.find(s => s.repo?.host === remote.host && s.repo.owner.toLowerCase() === remote.owner.toLowerCase() && s.repo.repo.toLowerCase() === remote.repo.toLowerCase());
      if (!s) { const sourceId = id('source'); s = { id: sourceId, url: url.trim(), repo: { ...remote, url: url.trim() }, keySlug: sourceId, createdAt: now() }; data.sources.push(s); }
      else if (/^(?:git@|ssh:)/.test(url.trim()) && s.url !== url.trim()) { s.url = url.trim(); s.repo = { ...s.repo, url: s.url }; }
      if (projectId) { const p = this.project(data, projectId); if (!p.sourceIds.includes(s.id)) p.sourceIds.push(s.id); }
      return s;
    });
  }
  async startImport({ projectId = null, sourceId, scope = projectId ? 'build' : 'project', actorId, operationId }) {
    operationKey(operationId);
    return this.mutate(data => {
      if (projectId) this.project(data, projectId);
      if (!data.sources.some(s => s.id === sourceId)) throw new CatalogError(404, 'Source not found.');
      const existing = operationId && data.imports.find(a => a.operationId === operationId);
      if (existing) { if (existing.sourceId !== sourceId || existing.scope !== scope || scope === 'build' && existing.projectId !== projectId) throw new CatalogError(409, 'This import request already connects a different source or project.'); return existing; }
      const a = { id: id('import'), projectId, sourceId, scope, actorId, operationId, state: 'connecting', createdAt: now(), updatedAt: now(), events: [], attempts: [], prepared: [], plan: null, revision: null, error: null };
      data.imports.push(a); return a;
    });
  }
  async patchImport(key, patch) { return this.mutate(data => { const a = this.attempt(data, key); Object.assign(a, patch, { updatedAt: now() }); a.events.push({ state: a.state, at: a.updatedAt, error: a.error || null }); a.events = a.events.slice(-100); return a; }); }
  async setPlan(key, input) {
    const plan = proposal(input);
    return this.mutate(data => { const a = this.attempt(data, key); if (['connecting', 'inspecting', 'preparing', 'validating'].includes(a.state)) throw new CatalogError(409, 'Wait for the current step or cancel it before changing the plan.');
      if (a.prepared.length) {
        if (plan.builds.length !== a.plan.builds.length || plan.builds.some((b,i) => b.selected !== a.plan.builds[i].selected)) throw new CatalogError(409, 'Use another import to add/remove selected builds after preparation starts. Existing builds and work were retained.');
        for (const item of a.prepared) { const build = this.build(data,item.buildId), next = plan.builds[item.index]; if (build.workspaceId && (next.ref !== build.ref || next.destinationRef !== build.destinationRef)) throw new CatalogError(409, 'This working copy already exists. Keep its source/destination branches, or open a separate branch/import; no local work was overwritten.'); }
      }
      a.plan = plan; a.revision = digest({ sourceSha: a.sourceSha, plan }); a.approval = null; a.state = 'awaiting-confirmation'; a.error = null; return a; });
  }
  async approve(key, revision) {
    return this.mutate(data => { const a = this.attempt(data, key);
      if (!a.plan || a.revision !== revision || a.state !== 'awaiting-confirmation') throw new CatalogError(409, 'The source or plan changed. Review and confirm the current plan.');
      if (!a.plan.builds.some(b => b.selected)) throw new CatalogError(400, 'Select at least one build.');
      a.approval = { revision, sourceSha: a.sourceSha, plan: structuredClone(a.plan), at: now() }; a.state = 'preparing'; a.error = null;
      if (!a.projectId) { const p = { id: id('project'), name: a.plan.projectName, sourceIds: [a.sourceId], createdAt: now() }; data.projects.push(p); a.projectId = p.id; }
      const p = this.project(data, a.projectId); if (!p.sourceIds.includes(a.sourceId)) p.sourceIds.push(a.sourceId);
      a.plan.builds.forEach((plan, index) => { if (!plan.selected) return;
        const existing = a.prepared.find(b => b.index === index); if (existing) { Object.assign(this.build(data,existing.buildId),plan,{approvedPlan:structuredClone(a.approval),state:'preparing',error:null,uiVerified:false}); return; }
        const buildId = id('build'); const b = { ...plan, id: buildId, projectId: p.id, sourceId: a.sourceId, importId: a.id, storageSlug: buildId, recipePath: `.dialogue/builds/${buildId}/preview.json`, publication: 'source repository', createdAt: now(), state: 'preparing', approvedPlan: structuredClone(a.approval) };
        data.builds.push(b); a.prepared.push({ index, buildId });
      }); return a;
    });
  }
  async patchBuild(key, patch) { return this.mutate(data => Object.assign(this.build(data, key), patch)); }
  async createBuild(projectId, input) { operationKey(input.operationId); const plan = buildPlan({ ...input, root: '.', ref: 'main', destinationRef: 'main' }); return this.mutate(data => {
    const existing = input.operationId && data.builds.find(b => b.operationId === input.operationId); if (existing) { if (existing.projectId !== projectId || existing.name !== plan.name || existing.target !== plan.target || existing.prompt !== input.prompt || (existing.figmaUrl || null) !== (input.figmaUrl || null)) throw new CatalogError(409, 'This creation request already has different build details.'); return existing; }
    const p = this.project(data, projectId), buildId = id('build');
    const b = { ...plan, id: buildId, projectId: p.id, sourceId: null, storageSlug: buildId, recipePath: `.dialogue/builds/${buildId}/preview.json`, publication: 'local only', createdAt: now(), state: input.target === 'Web' ? 'preparing' : 'unsupported', prompt: String(input.prompt || '').slice(0, 16000), figmaUrl: input.figmaUrl || null, operationId: input.operationId };
    data.builds.push(b); return b;
  }); }
  async recover() { return this.mutate(data => { for (const a of [...data.imports, ...data.builds]) if (['connecting', 'inspecting', 'preparing', 'validating'].includes(a.state)) { a.state = 'failed'; a.error = 'Dialogue restarted during this step. Source, decisions and any working copies were retained. Resume to continue.'; a.failureKind = 'interrupted'; } return null; }); }
}
module.exports = { Catalog, CatalogError, TARGETS, buildPlan, proposal, digest, sourceView };
