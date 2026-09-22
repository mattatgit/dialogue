(() => {
  const frame = document.querySelector('[data-prototype-frame]');
  const frameShell = document.querySelector('[data-prototype-frame-shell]');
  const state = document.querySelector('[data-prototype-state]');
  const titleNodes = document.querySelectorAll('[data-prototype-title]');
  const projectNode = document.querySelector('[data-project-title]');
  const projectLink = document.querySelector('[data-project-link]');
  const restartButton = document.querySelector('[data-restart]');
  const revisionId = new URLSearchParams(window.location.search).get('revision');
  let currentSource = '';

  if (!frame || !frameShell || !state) return;

  const showError = (message) => {
    state.textContent = message;
    state.classList.add('is-error');
    state.hidden = false;
    frameShell.hidden = true;
  };

  const encodedEntryPath = (entryPoint) =>
    String(entryPoint || 'index.html')
      .split('/')
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join('/');

  const reloadPrototype = () => {
    if (!currentSource) return;
    frame.src = 'about:blank';
    window.setTimeout(() => {
      frame.src = currentSource;
    }, 0);
  };

  const load = async () => {
    if (!revisionId) {
      showError('No prototype revision was selected.');
      return;
    }

    try {
      const response = await fetch(`/api/revisions/${encodeURIComponent(revisionId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.revision) throw new Error(payload.error || 'Prototype revision not found.');

      const revision = payload.revision;
      const title = revision.title || `${revision.prototype?.name || 'Prototype'} ${revision.version || ''}`.trim();
      titleNodes.forEach((node) => { node.textContent = title; });
      document.title = `Dialogue — ${title}`;

      if (projectNode) projectNode.textContent = revision.project?.name || 'Project';
      if (projectLink) {
        projectLink.href = revision.project?.slug === 'landline' ? 'project-landline.html' : 'projects.html';
      }

      currentSource = `/prototype-files/${encodeURIComponent(revision.id)}/${encodedEntryPath(revision.entryPoint)}`;
      frame.title = title;
      frame.src = currentSource;
      state.hidden = true;
      frameShell.hidden = false;
    } catch (error) {
      showError(error.message || 'Could not load this prototype revision.');
    }
  };

  restartButton?.addEventListener('click', reloadPrototype);
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'r' && !/input|textarea/i.test(document.activeElement?.tagName || '')) {
      reloadPrototype();
    }
  }, { capture: true });

  load();
})();
