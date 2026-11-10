const { CatalogError, sourceView } = require('./catalog.js');

function catalogHttp({ catalog, guided, projects, repoFor, preview, identity, readJson, sendJson }) {
  const buildView = async (b, d) => {
    const engine = await guided.engineRecord(b).catch(() => null);
    const shot = engine && await preview(engine);
    const source = d.sources.find(s => s.id === b.sourceId);
    return { ...b, sourceUrl: sourceView(source)?.url || null, previewSetup: engine?.previewSetup || null, previewUrl: shot?.previewUrl || null,
      uiVerified: b.uiVerified === true, state: b.state || (engine?.previewSetup?.status === 'ready' ? 'configured' : engine?.previewSetup?.status || 'connected') };
  };
  return async (req, res, url) => {
    const p = url.pathname;
    if (!p.startsWith('/api/catalog/')) return false;
    const actor = identity().user;
    if (p === '/api/catalog/projects') {
      if (req.method === 'GET') {
        const d = await catalog.snapshot();
        sendJson(res, 200, { projects: d.projects.map(project => ({ ...project, buildCount: d.builds.filter(b => b.projectId === project.id).length })) });
      } else if (req.method === 'POST') { const body = await readJson(req); sendJson(res, 201, { project: await catalog.createProject(body.name, body.operationId) }); }
      else throw new CatalogError(405, 'Method not allowed.');
      return true;
    }
    let m = /^\/api\/catalog\/projects\/([a-z0-9-]+)$/.exec(p);
    if (m && req.method === 'GET') {
      const d = await catalog.snapshot(), project = catalog.project(d, m[1]);
      sendJson(res, 200, { project, builds: await Promise.all(d.builds.filter(b => b.projectId === project.id).map(b => buildView(b, d))),
        sources: d.sources.filter(s => project.sourceIds.includes(s.id)).map(sourceView), imports: d.imports.filter(a => a.projectId === project.id).map(a => ({ id: a.id, state: a.state, createdAt: a.createdAt, error: a.error })) }); return true;
    }
    m = /^\/api\/catalog\/projects\/([a-z0-9-]+)\/builds$/.exec(p);
    if (m && req.method === 'POST') { sendJson(res, 202, { build: await guided.create(m[1], await readJson(req, 6 * 1024 * 1024), actor) }); return true; }
    if (p === '/api/catalog/imports' && req.method === 'POST') { sendJson(res, 202, { attempt: await guided.connect(await readJson(req), actor) }); return true; }
    if (p === '/api/catalog/imports' && req.method === 'GET') {
      const d = await catalog.snapshot(); sendJson(res, 200, { attempts: d.imports.map(a => ({ id: a.id, projectId: a.projectId, state: a.state, createdAt: a.createdAt, error: a.error })) }); return true;
    }
    m = /^\/api\/catalog\/imports\/([a-z0-9-]+)(?:\/(plan|discuss|confirm|resume|cancel|reconnect))?$/.exec(p);
    if (m) {
      const a = await guided.get(m[1]);
      if (req.method === 'GET' && !m[2]) {
        const d = await catalog.snapshot(), records = guided.history(a);
        sendJson(res, 200, { attempt: { ...a, pendingInputFile: undefined, attempts: a.attempts?.map(({ inputFile, ...rest }) => rest) }, source: sourceView(d.sources.find(s => s.id === a.sourceId)),
          builds: await Promise.all(a.prepared.map(b => buildView(catalog.build(d, b.buildId), d))),
          requests: records.map(r => ({ id: r.id, status: r.status, error: r.error, workingDetail: r.workingDetail, createdAt: r.createdAt, reply: r.reply, worker: r.worker ? { outcome: r.worker.outcome, memoryMiB: r.worker.memoryMiB, peakBytes: r.worker.peakBytes } : null })) }); return true;
      }
      if (req.method === 'POST') {
        if (m[2] === 'plan') await catalog.setPlan(a.id, await readJson(req));
        else if (m[2] === 'confirm') await guided.confirm(a.id, (await readJson(req)).revision, actor);
        else if (m[2] === 'discuss') await guided.discuss(a.id, await readJson(req, 6 * 1024 * 1024), actor);
        else if (m[2] === 'resume') await guided.resume(a.id, actor);
        else if (m[2] === 'reconnect') await guided.reconnect(a.id, actor);
        else if (m[2] === 'cancel') await guided.cancel(a.id);
        else throw new CatalogError(404, 'Import action not found.');
        sendJson(res, 202, { attempt: await guided.get(a.id) }); return true;
      }
    }
    m = /^\/api\/catalog\/builds\/([a-z0-9-]+)(?:\/(resume|cancel|open|branch))?$/.exec(p);
    if (m) {
      const d = await catalog.snapshot(), b = catalog.build(d, m[1]);
      if (!m[2] && req.method === 'GET') {
        const engine = await guided.engineRecord(b).catch(() => null);
        let refs = { branches: [], tags: [] }, error = null, defaultBranch = b.destinationRef || b.ref;
        if (engine && b.target === 'Web' && (b.legacy || b.workspaceId)) {
          try { const repo = await repoFor(engine); refs = await repo.refs(); defaultBranch ||= await repo.defaultBranchName(); }
          catch (e) { error = e.message; }
        }
        sendJson(res, 200, { build: await buildView(b, d), project: catalog.project(d, b.projectId), source: sourceView(d.sources.find(s => s.id === b.sourceId)) || null, refs, defaultBranch, error }); return true;
      }
      if (req.method === 'POST') {
        if (m[2] === 'resume') await guided.resumeBuild(b.id, actor);
        else if (m[2] === 'cancel') await guided.cancel(b.importId || b.id);
        else if (m[2] === 'open' || m[2] === 'branch') {
          if (b.target !== 'Web') throw new CatalogError(409, `${b.target} execution is unavailable on this host.`);
          if (['preparing', 'validating'].includes(b.state)) throw new CatalogError(409, 'Wait for preparation, or cancel it before opening a working copy.');
          const repo = await repoFor(await guided.engineRecord(b));
          const body = await readJson(req), ref = body.ref || b.destinationRef || b.ref || await repo.defaultBranchName();
          let workspace;
          if (m[2] === 'branch') {
            const source = await repo.resolveRef(body.from || b.destinationRef || b.ref || await repo.defaultBranchName());
            if (!source) throw new CatalogError(404, 'Source branch not found.');
            workspace = await repo.ensureBranchFrom(ref, source.sha);
          } else workspace = await repo.ensureWorkspace(ref);
          sendJson(res, 201, { viewerUrl: `workspace.html?id=${encodeURIComponent(workspace.id)}`, workspaceId: workspace.id }); return true;
        } else throw new CatalogError(404, 'Build action not found.');
        sendJson(res, 202, { build: catalog.build(await catalog.snapshot(), b.id) }); return true;
      }
    }
    throw new CatalogError(404, 'Catalog route not found.');
  };
}
module.exports = { catalogHttp };
