(() => {
  const body = document.querySelector('[data-workspace-body]');
  const frame = document.querySelector('[data-prototype-frame]');
  const frameShell = document.querySelector('[data-prototype-frame-shell]');
  const state = document.querySelector('[data-prototype-state]');
  const refTitles = document.querySelectorAll('[data-ref-title]');
  const projectNode = document.querySelector('[data-project-title]');
  const projectLink = document.querySelector('[data-project-link]');
  const status = document.querySelector('[data-workspace-status]');
  const restartButton = document.querySelector('[data-restart]');
  const terminalPane = document.querySelector('[data-terminal-pane]');
  const terminalHost = document.querySelector('[data-terminal-host]');
  const overlay = document.querySelector('[data-terminal-overlay]');
  const overlayText = document.querySelector('[data-terminal-overlay-text]');
  const workspaceId = new URLSearchParams(window.location.search).get('id');
  let currentSource = '';
  let terminal = null;

  if (!frame || !frameShell || !state || !body) return;

  const showError = (message) => {
    state.textContent = message;
    state.classList.add('is-error');
    state.hidden = false;
    frameShell.hidden = true;
  };

  const reloadPrototype = () => {
    if (!currentSource) return;
    frame.src = 'about:blank';
    window.setTimeout(() => {
      frame.src = currentSource;
    }, 0);
  };

  const renderStatus = (head, dirty) => {
    if (!status) return;
    status.replaceChildren();
    const sha = document.createElement('code');
    sha.textContent = (head?.sha || '').slice(0, 7);
    const text = document.createElement('span');
    text.textContent = dirty ? 'uncommitted changes' : 'clean';
    status.append(sha, document.createTextNode(' · '), text);
    status.classList.toggle('is-dirty', Boolean(dirty));
    status.title = head?.subject || '';
    status.hidden = false;
  };

  const setOverlay = (message) => {
    if (!overlay) return;
    overlay.hidden = !message;
    if (overlayText) overlayText.textContent = message || '';
  };

  const mountTerminal = () => {
    if (!terminalPane || !terminalHost || !window.DialogueTerminal) return;
    terminalPane.hidden = false;
    body.classList.add('has-terminal');
    terminal = window.DialogueTerminal.mount(terminalHost, workspaceId, {
      onStatus: (kind, detail) => {
        if (kind === 'connected') setOverlay('');
        else if (kind === 'connecting') setOverlay('Connecting…');
        else if (kind === 'reconnecting') setOverlay('Reconnecting…');
        else if (kind === 'error') setOverlay(detail || 'The agent terminal could not be started.');
      }
    });
    overlay?.addEventListener('click', () => terminal?.retry());
  };

  const subscribe = () => {
    const events = new EventSource(`/api/workspaces/${workspaceId}/events`);
    events.addEventListener('change', (event) => {
      try {
        const payload = JSON.parse(event.data);
        renderStatus(payload.head, payload.dirty);
      } catch {
        // ignore malformed frames
      }
      reloadPrototype();
    });
  };

  const load = async () => {
    if (!workspaceId) {
      showError('No workspace was selected.');
      return;
    }
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.workspace) throw new Error(payload.error || 'Workspace not found.');
      const workspace = payload.workspace;

      refTitles.forEach((node) => { node.textContent = workspace.ref; });
      document.title = `Dialogue — ${workspace.project?.name || 'Project'} · ${workspace.ref}`;
      if (projectNode) projectNode.textContent = workspace.project?.name || 'Project';
      if (projectLink) projectLink.href = workspace.project?.slug === 'landline' ? 'project-landline.html' : 'projects.html';
      renderStatus(workspace.head, workspace.dirty);

      if (workspace.entryPoint) {
        currentSource = `${workspace.filesUrl}${workspace.entryPoint}`;
        frame.title = `${workspace.project?.name || 'Prototype'} · ${workspace.ref}`;
        frame.src = currentSource;
        state.hidden = true;
        frameShell.hidden = false;
      } else {
        showError(`This branch has no prototype at ${workspace.prototypePath}/index.html yet.`);
      }

      if (workspace.terminal) mountTerminal();
      subscribe();
    } catch (error) {
      showError(error.message || 'Could not load this workspace.');
    }
  };

  restartButton?.addEventListener('click', reloadPrototype);
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey
      && !/input|textarea/i.test(document.activeElement?.tagName || '')
      && !document.activeElement?.closest('.terminal-pane')) {
      reloadPrototype();
    }
  }, { capture: true });

  load();
})();
