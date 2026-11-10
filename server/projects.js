// Project records in db.json: a project is a git repository. Node builtins
// only. Display names are derived at read time so two repositories called
// `app` show as `owner/app` without any stored name going stale.
const fsp = require('node:fs/promises');
const { parseRemote } = require('./deploy-key.js');

const SCHEMA_VERSION = 4;

function queuedSetup() {
  return { status: 'queued', attempt: 0, error: null, finishedAt: null };
}

class ProjectError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- pure helpers ---------------------------------------------------------

function slugFor(remote) {
  const clean = (part) => part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = `${clean(remote.owner)}-${clean(remote.repo)}`.replace(/-{2,}/g, '-');
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null;
}

function webUrlFor(remote) {
  return `https://${remote.host}${remote.port ? `:${remote.port}` : ''}/${remote.owner}/${remote.repo}`;
}

// Build a project record from a pasted URL. Throws ProjectError(400).
// Every new project starts with its preview setup queued.
function projectFromUrl(url, now = new Date()) {
  const remote = parseRemote(String(url || '').trim());
  if (!remote) throw new ProjectError(400, 'That does not look like a git repository address.');
  const slug = slugFor(remote);
  if (!slug) throw new ProjectError(400, 'Could not derive a name from that address.');
  return {
    slug,
    createdAt: now.toISOString(),
    repo: {
      url: String(url).trim(),
      host: remote.host,
      owner: remote.owner,
      repo: remote.repo
    },
    previewSetup: queuedSetup()
  };
}

// `repo` alone unless another project has the same repo name; then
// `owner/repo` for each of the clashing ones.
function withNames(projects) {
  const counts = new Map();
  for (const project of projects) {
    const key = project.repo.repo.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return projects.map((project) => ({
    ...project,
    name: project.name || (counts.get(project.repo.repo.toLowerCase()) > 1 ? `${project.repo.owner}/${project.repo.repo}` : project.repo.repo),
    webUrl: project.local ? null : webUrlFor(project.repo)
  }));
}

// Older db.json layouts: v2 stored { id, slug, name, description, repo: { url, prototypePath } };
// v3 stored a detected prototypePath. Both are rebuilt from the URL, which
// drops prototypePath and queues the preview setup that replaces it.
function migrate(data) {
  if (!data || typeof data !== 'object') return { schemaVersion: SCHEMA_VERSION, projects: [] };
  if (data.schemaVersion === SCHEMA_VERSION) return data;
  const projects = [];
  for (const old of Array.isArray(data.projects) ? data.projects : []) {
    const url = old?.repo?.url;
    if (!url) continue;
    try {
      const fresh = projectFromUrl(url, new Date(old.createdAt || Date.now()));
      if (!projects.some((p) => p.slug === fresh.slug)) projects.push(fresh);
    } catch {
      // unparseable legacy entry: drop it
    }
  }
  return { schemaVersion: SCHEMA_VERSION, projects };
}

// --- store -------------------------------------------------------------------

class ProjectStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.writing = Promise.resolve();
    this.mutations = Promise.resolve();
  }

  async load() {
    let raw = null;
    try {
      raw = JSON.parse(await fsp.readFile(this.dbPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new ProjectError(500, 'Project storage could not be read. Existing data was not replaced.');
    }
    if (raw && (raw.schemaVersion > SCHEMA_VERSION || !Array.isArray(raw.projects))) throw new ProjectError(500, 'Unsupported project storage. Existing data was not replaced.');
    const data = migrate(raw);
    if (!raw || raw.schemaVersion !== SCHEMA_VERSION) await this.save(data);
    return data;
  }

  save(data) {
    this.writing = this.writing.catch(() => {}).then(async () => {
      const temp = `${this.dbPath}.${require('node:crypto').randomUUID()}.tmp`;
      try { await fsp.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); await fsp.rename(temp, this.dbPath); }
      finally { await fsp.rm(temp, { force: true }); }
    });
    return this.writing;
  }

  mutate(fn) {
    const task = this.mutations.catch(() => {}).then(async () => { const data = await this.load(); const result = fn(data); await this.save(data); return result; });
    this.mutations = task; return task;
  }

  // Trusted catalog adapter only. Repository URLs still enter through the
  // catalog's validated source connection, never arbitrary client paths.
  async insert(record) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(record.slug)) throw new ProjectError(400, 'Invalid storage identity.');
    return this.mutate(data => { const existing = data.projects.find(p => p.slug === record.slug); if (existing) return existing; data.projects.push(record); return record; });
  }

  async list() {
    await this.mutations.catch(() => {});
    return withNames((await this.load()).projects);
  }

  async find(slug) {
    const project = (await this.list()).find((item) => item.slug === slug);
    if (!project) throw new ProjectError(404, 'Project not found.');
    return project;
  }

  // Returns the stored (nameless) record; caller decorates via list()/find().
  async add(url) {
    const project = projectFromUrl(url);
    return this.mutate(data => { if (data.projects.some((item) => item.slug === project.slug)) throw new ProjectError(409, 'This repository has already been added.'); data.projects.push(project); return project; });
  }

  async setPreviewSetup(slug, patch) {
    return this.mutate(data => { const project = data.projects.find((item) => item.slug === slug); if (!project) throw new ProjectError(404, 'Project not found.'); project.previewSetup = { ...queuedSetup(), ...project.previewSetup, ...patch }; return project.previewSetup; });
  }

  async remove(slug) {
    return this.mutate(data => { const index = data.projects.findIndex((item) => item.slug === slug); if (index < 0) throw new ProjectError(404, 'Project not found.'); return data.projects.splice(index, 1)[0]; });
  }

  // Add every seed entry not present yet. Seeds: [{ url }].
  async seed(entries) {
    return this.mutate(data => {
    for (const entry of entries) {
      let project;
      try {
        project = projectFromUrl(entry.url);
      } catch (error) {
        console.error(`Ignoring seed project ${JSON.stringify(entry)}: ${error.message}`);
        continue;
      }
      if (data.projects.some((item) => item.slug === project.slug)) continue;
      data.projects.push(project);
    }
    });
  }
}

module.exports = { ProjectError, ProjectStore, SCHEMA_VERSION, migrate, projectFromUrl, slugFor, withNames };
