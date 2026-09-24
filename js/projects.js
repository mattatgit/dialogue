(() => {
  const grid = document.querySelector('[data-project-grid]');
  const note = document.querySelector('[data-projects-note]');
  const form = document.querySelector('[data-add-project-form]');
  const urlField = form?.querySelector('[name="url"]');
  const submit = form?.querySelector('[data-add-project-submit]');
  const errorNode = form?.querySelector('[data-add-project-error]');
  if (!grid) return;

  const setNote = (message = '', state = '') => {
    if (!note) return;
    note.textContent = message;
    note.hidden = !message;
    note.classList.toggle('is-error', state === 'error');
  };

  const setError = (message = '') => {
    if (!errorNode) return;
    errorNode.textContent = message;
    errorNode.hidden = !message;
  };

  const initials = (project) => project.repo.repo.replace(/[-_]+/g, ' ').split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() || '').join('') || '?';

  const projectUrl = (project) => `project.html?slug=${encodeURIComponent(project.slug)}`;

  const buildCard = (project) => {
    const card = document.createElement('a');
    card.className = 'project-card';
    card.href = projectUrl(project);

    const badge = document.createElement('div');
    badge.className = 'project-badge';
    badge.textContent = initials(project);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'project-remove';
    remove.title = 'Remove from Dialogue';
    remove.setAttribute('aria-label', `Remove ${project.name} from Dialogue`);
    remove.textContent = '×';
    remove.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = window.confirm(`Remove ${project.name} from Dialogue?\n\nThis deletes Dialogue's local copy and any open workspaces. Nothing on ${project.host} is changed.`);
      if (!ok) return;
      card.classList.add('is-busy');
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not remove the project.');
        await load();
      } catch (error) {
        card.classList.remove('is-busy');
        setNote(error.message, 'error');
      }
    });

    const name = document.createElement('div');
    name.className = 'project-name';
    name.textContent = project.name;

    const desc = document.createElement('p');
    desc.className = 'project-desc';
    desc.textContent = `${project.repo.owner}/${project.repo.repo} on ${project.repo.host}`;

    const divider = document.createElement('div');
    divider.className = 'project-divider';

    const meta = document.createElement('div');
    meta.className = 'project-meta';
    const added = document.createElement('div');
    added.className = 'meta-item';
    added.innerHTML = '<div class="meta-label">Added</div><div class="meta-value"></div>';
    added.querySelector('.meta-value').textContent = new Date(project.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const proto = document.createElement('div');
    proto.className = 'meta-item';
    proto.innerHTML = '<div class="meta-label">Prototype</div><div class="meta-value"></div>';
    proto.querySelector('.meta-value').textContent = project.repo.prototypePath === null ? 'no index.html found' : project.repo.prototypePath || 'repository root';

    card.append(badge, remove, name, desc, divider, meta);
    return card;
  };

  const load = async () => {
    try {
      const response = await fetch('/api/projects', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not load projects.');
      grid.replaceChildren(...payload.projects.map(buildCard));
      setNote(payload.projects.length ? '' : 'No projects yet. Add one with the address of its Git repository.');
    } catch (error) {
      setNote(error.message || 'Could not load projects.', 'error');
    }
  };

  // Turn server errors into guidance a designer can act on.
  const explain = (payload, url) => {
    const isSsh = /^(git@|ssh:\/\/)/.test(url);
    if (payload.reason === 'repo' && !isSsh) {
      return 'Dialogue can\'t see this repository. If it is private, add it with its SSH address instead: on GitHub open the repository, click Code, choose SSH and copy the address. If it is public, check the address for typos.';
    }
    if (payload.reason === 'network') return 'The repository host could not be reached. Check your internet connection and the address, then try again.';
    return payload.error || 'Could not add the project.';
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = urlField?.value.trim() || '';
    if (!url) return;
    setError('');
    submit.disabled = true;
    submit.textContent = 'Adding…';
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        window.location.href = projectUrl(payload.project);
        return;
      }
      if (payload.setup?.slug) {
        // Private repository over SSH: the project exists; its page shows
        // the key to register.
        window.location.href = `project.html?slug=${encodeURIComponent(payload.setup.slug)}`;
        return;
      }
      setError(explain(payload, url));
    } catch (error) {
      setError(error.message || 'Could not add the project.');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Add';
    }
  });

  load();
})();
