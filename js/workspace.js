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
  const modelLabel = document.querySelector('[data-terminal-model]');
  const params = new URLSearchParams(window.location.search);
  const workspaceId = params.get('id');
  let wantsFix = params.get('fix') === '1';
  let currentSource = '';
  let previewUrl = '';
  let channel = '';
  let reloadMode = 'dialogue';
  let setupStatus = '';
  let terminal = null;

  if (!frame || !frameShell || !state || !body) return;

  const showError = (message) => {
    state.textContent = message;
    state.classList.add('is-error', 'error');
    state.hidden = false;
    frameShell.hidden = true;
  };

  const showState = (message) => {
    state.replaceChildren(document.createTextNode(message));
    state.classList.remove('is-error', 'error');
    state.hidden = false;
    frameShell.hidden = true;
  };

  const reloadPrototype = () => {
    if (!currentSource) return;
    channel = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const url = new URL(currentSource);
    url.searchParams.set('reviewChannel', channel);
    url.searchParams.set('reviewOrigin', location.origin);
    window.dispatchEvent(new CustomEvent('dialogue:channel', { detail: channel }));
    frame.src = url.href;
  };

  const restartPreview = async () => {
    showState('Restarting the preview…');
    await fetch(`/api/workspaces/${workspaceId}/preview/restart`, { method: 'POST', cache: 'no-store' }).catch(() => {});
  };

  // The preview server's lifecycle, pushed over SSE as `runner` events.
  const renderRunner = (runner) => {
    reloadMode = runner.reload || reloadMode;
    if (runner.state === 'ready') {
      const firstLoad = !currentSource;
      currentSource = previewUrl;
      state.hidden = true;
      frameShell.hidden = false;
      if (firstLoad || runner.restarted) reloadPrototype();
      window.dispatchEvent(new CustomEvent('dialogue:runner', { detail: runner }));
      return;
    }
    currentSource = '';
    window.dispatchEvent(new CustomEvent('dialogue:runner', { detail: runner }));
    if (runner.state === 'crashed') {
      showError(runner.message || 'The preview stopped.');
      if (runner.log) {
        const log = document.createElement('pre');
        log.className = 'prototype-log';
        log.textContent = runner.log;
        state.append(log);
      }
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'pill';
      retry.textContent = 'Restart preview';
      retry.addEventListener('click', restartPreview);
      state.append(retry);
      return;
    }
    // Opened while the project's preview is still being set up: it starts
    // here by itself when the setup finishes.
    if (runner.state === 'no-recipe' && ['queued', 'running'].includes(setupStatus)) {
      showState('Dialogue is setting up the preview for this project. It appears here as soon as it is ready.');
      return;
    }
    showState(runner.message || 'Starting the preview…');
  };

  // Arrived from "Fix with agent": hand the agent the failure once its
  // terminal is up.
  const requestFix = async () => {
    if (!wantsFix) return;
    wantsFix = false;
    const response = await fetch(`/api/workspaces/${workspaceId}/fix-preview`, { method: 'POST', cache: 'no-store' }).catch(() => null);
    if (response && !response.ok) {
      const payload = await response.json().catch(() => ({}));
      showError(payload.error || 'Could not hand the problem to the agent.');
    }
  };

  const renderStatus = (head, dirty, ahead = 0) => {
    if (!status) return;
    status.replaceChildren();
    const sha = document.createElement('code');
    sha.textContent = (head?.sha || '').slice(0, 7);
    const text = document.createElement('span');
    text.textContent = dirty ? 'uncommitted changes' : ahead > 0 ? `${ahead} to push` : 'clean';
    status.append(sha, document.createTextNode(' · '), text);
    status.classList.toggle('is-dirty', Boolean(dirty));
    status.title = head?.subject || '';
    status.hidden = false;
  };

  window.DialogueWorkspace = {
    id: workspaceId,
    reload: () => (currentSource ? reloadPrototype() : restartPreview()),
    restartPreview,
    updateStatus: renderStatus,
    get previewUrl() { return previewUrl; },
    get channel() { return channel; },
    get ready() { return Boolean(currentSource); }
  };

  const setOverlay = (message) => {
    if (!overlay) return;
    overlay.hidden = !message;
    if (overlayText) overlayText.textContent = message || '';
  };

  const mountTerminal = () => {
    if (!terminalPane || !terminalHost || !window.DialogueTerminal || terminal) return;
    terminalPane.hidden = false;
    if (modelLabel) fetch('/api/agent', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((agent) => {
        if (!agent?.model) return;
        modelLabel.textContent = agent.model.split('/').at(-1);
        modelLabel.title = agent.model;
      })
      .catch(() => {});
    terminal = window.DialogueTerminal.mount(terminalHost, workspaceId, {
      onStatus: (kind, detail) => {
        if (kind === 'connected') { setOverlay(''); requestFix(); }
        else if (kind === 'connecting') setOverlay('Connecting…');
        else if (kind === 'reconnecting') setOverlay('Reconnecting…');
        else if (kind === 'error') setOverlay(detail || 'The agent terminal could not be started.');
      }
    });
    overlay?.addEventListener('click', () => terminal?.retry());
  };

  window.addEventListener('dialogue:mode', (event) => {
    if (!terminalPane) return;
    if (event.detail === 'terminal') {
      if (terminal) terminalPane.hidden = false;
      else mountTerminal();
    } else {
      terminalPane.hidden = true;
    }
  });

  const subscribe = () => {
    const events = new EventSource(`/api/workspaces/${workspaceId}/events`);
    events.addEventListener('runner', (event) => {
      try {
        renderRunner(JSON.parse(event.data));
      } catch {
        // ignore malformed frames
      }
    });
    events.addEventListener('change', (event) => {
      let files = true;
      try {
        const payload = JSON.parse(event.data);
        renderStatus(payload.head, payload.dirty, payload.ahead);
        window.dispatchEvent(new CustomEvent('dialogue:change', { detail: payload }));
        files = payload.files !== false;
      } catch {
        // ignore malformed frames
      }
      // Dev servers with their own live reload handle file changes.
      if (files && reloadMode === 'dialogue') reloadPrototype();
    });
    events.addEventListener('request', (event) => {
      try { window.dispatchEvent(new CustomEvent('dialogue:request', { detail: JSON.parse(event.data) })); } catch {}
    });
    events.addEventListener('activity', (event) => {
      try { window.dispatchEvent(new CustomEvent('dialogue:activity', { detail: JSON.parse(event.data) })); } catch {}
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
      window.DialogueWorkspace.current = workspace;

      refTitles.forEach((node) => { node.textContent = workspace.ref; });
      document.title = `Dialogue — ${workspace.project?.name || 'Project'} · ${workspace.ref}`;
      if (projectNode) projectNode.textContent = workspace.project?.name || 'Project';
      if (projectLink) projectLink.href = workspace.project?.slug ? `project.html?slug=${encodeURIComponent(workspace.project.slug)}` : 'projects.html';
      renderStatus(workspace.head, workspace.dirty, workspace.ahead);

      previewUrl = workspace.previewUrl || '';
      setupStatus = workspace.project?.previewSetup?.status || '';
      frame.title = `${workspace.project?.name || 'Prototype'} · ${workspace.ref}`;
      renderRunner(workspace.runner || { state: 'starting' });

      window.dispatchEvent(new CustomEvent('dialogue:workspace', { detail: workspace }));
      subscribe();
    } catch (error) {
      showError(error.message || 'Could not load this workspace.');
    }
  };

  // The review controller handles Restart / R, including focused-field guards.

  load();
})();
