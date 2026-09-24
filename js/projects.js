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
    if (project.previewUrl) {
      const shot = document.createElement('img');
      shot.className = 'project-shot';
      shot.src = project.previewUrl;
      shot.alt = '';
      shot.loading = 'lazy';
      shot.addEventListener('load', () => badge.classList.add('has-shot'));
      badge.appendChild(shot);
    }

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
    const preview = document.createElement('div');
    preview.className = 'meta-item';
    preview.innerHTML = '<div class="meta-label">Preview</div><div class="meta-value"></div>';
    preview.querySelector('.meta-value').textContent = setupLabel(project.previewSetup);

    meta.append(added, preview);
    card.append(badge, remove, name, desc, divider, meta);
    if (project.previewSetup?.status === 'failed') {
      card.classList.add('has-setup-failure');
      card.append(buildSetupFailure(project));
    }
    return card;
  };

  const setupLabel = (setup) => {
    switch (setup?.status) {
      case 'ready': return 'Ready';
      case 'running': return setup.attempt > 1 ? `Setting up… (try ${setup.attempt} of 3)` : 'Setting up…';
      case 'waiting-for-agent': return 'Waiting for an AI model';
      case 'failed': return 'Setup failed';
      default: return 'Waiting to set up';
    }
  };

  // Setup gave up: say why and offer a retry, the log, or the agent.
  const buildSetupFailure = (project) => {
    const box = document.createElement('div');
    box.className = 'setup-failure';
    const reason = document.createElement('p');
    reason.textContent = project.previewSetup.error || 'Dialogue could not work out how to show this project.';
    const actions = document.createElement('div');
    actions.className = 'setup-actions';
    const action = (label, handler) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pill outline';
      button.textContent = label;
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        try {
          await handler();
        } catch (error) {
          setNote(error.message, 'error');
        } finally {
          button.disabled = false;
        }
      });
      return button;
    };
    const base = `/api/projects/${encodeURIComponent(project.slug)}/setup`;
    const post = async (url) => {
      const response = await fetch(url, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'That did not work.');
      return payload;
    };
    actions.append(
      action('Retry', async () => { await post(`${base}/retry`); await load(); }),
      action('Fix with agent', async () => { window.location.href = (await post(`${base}/fix`)).viewerUrl; }),
      action('Show log', async () => { window.open(`${base}/log`, '_blank', 'noopener'); })
    );
    box.append(reason, actions);
    return box;
  };

  // Setups in progress change on their own; poll until they settle.
  let pollTimer = null;
  const pollWhileBusy = (list) => {
    clearTimeout(pollTimer);
    const busy = list.some((project) => ['queued', 'running'].includes(project.previewSetup?.status));
    if (busy) pollTimer = window.setTimeout(load, 3000);
  };

  const load = async () => {
    try {
      const response = await fetch('/api/projects', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not load projects.');
      grid.replaceChildren(...payload.projects.map(buildCard));
      pollWhileBusy(payload.projects);
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
