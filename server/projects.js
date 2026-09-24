// Project records in db.json: a project is a git repository. Node builtins
// only. Display names are derived at read time so two repositories called
// `app` show as `owner/app` without any stored name going stale.
const fsp = require('node:fs/promises');
const { parseRemote } = require('./deploy-key.js');

const SCHEMA_VERSION = 3;

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
function projectFromUrl(url, prototypePath = null, now = new Date()) {
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
      repo: remote.repo,
      prototypePath: prototypePath || null
    }
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
    name: counts.get(project.repo.repo.toLowerCase()) > 1 ? `${project.repo.owner}/${project.repo.repo}` : project.repo.repo,
    webUrl: webUrlFor(project.repo)
  }));
}

// Older db.json layouts: v2 stored { id, slug, name, description, repo: { url, prototypePath } }.
function migrate(data) {
  if (!data || typeof data !== 'object') return { schemaVersion: SCHEMA_VERSION, projects: [] };
  if (data.schemaVersion === SCHEMA_VERSION) return data;
  const projects = [];
  for (const old of Array.isArray(data.projects) ? data.projects : []) {
    const url = old?.repo?.url;
    if (!url) continue;
    try {
      const fresh = projectFromUrl(url, old.repo.prototypePath || null, new Date(old.createdAt || Date.now()));
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
  }

  async load() {
    let raw = null;
    try {
      raw = JSON.parse(await fsp.readFile(this.dbPath, 'utf8'));
    } catch {
      // missing or unreadable: start empty
    }
    const data = migrate(raw);
    if (!raw || raw.schemaVersion !== SCHEMA_VERSION) await this.save(data);
    return data;
  }

  save(data) {
    this.writing = this.writing.then(() => fsp.writeFile(this.dbPath, `${JSON.stringify(data, null, 2)}\n`));
    return this.writing;
  }

  async list() {
    return withNames((await this.load()).projects);
  }

  async find(slug) {
    const project = (await this.list()).find((item) => item.slug === slug);
    if (!project) throw new ProjectError(404, 'Project not found.');
    return project;
  }

  // Returns the stored (nameless) record; caller decorates via list()/find().
  async add(url, prototypePath = null) {
    const project = projectFromUrl(url, prototypePath);
    const data = await this.load();
    if (data.projects.some((item) => item.slug === project.slug)) throw new ProjectError(409, 'This repository has already been added.');
    data.projects.push(project);
    await this.save(data);
    return project;
  }

  async update(slug, patch) {
    const data = await this.load();
    const project = data.projects.find((item) => item.slug === slug);
    if (!project) throw new ProjectError(404, 'Project not found.');
    Object.assign(project.repo, patch);
    await this.save(data);
    return project;
  }

  async remove(slug) {
    const data = await this.load();
    const index = data.projects.findIndex((item) => item.slug === slug);
    if (index < 0) throw new ProjectError(404, 'Project not found.');
    const [removed] = data.projects.splice(index, 1);
    await this.save(data);
    return removed;
  }

  // Add every seed entry not present yet. Seeds: [{ url, prototypePath? }].
  async seed(entries) {
    const data = await this.load();
    let changed = false;
    for (const entry of entries) {
      let project;
      try {
        project = projectFromUrl(entry.url, entry.prototypePath || null);
      } catch (error) {
        console.error(`Ignoring seed project ${JSON.stringify(entry)}: ${error.message}`);
        continue;
      }
      if (data.projects.some((item) => item.slug === project.slug)) continue;
      data.projects.push(project);
      changed = true;
    }
    if (changed) await this.save(data);
  }
}

module.exports = { ProjectError, ProjectStore, SCHEMA_VERSION, migrate, projectFromUrl, slugFor, withNames };
