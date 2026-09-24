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
  const commitButton = document.querySelector('[data-commit]');
  const setupLayer = document.querySelector('[data-setup-layer]');
  const setupClose = document.querySelector('[data-setup-close]');
  const setupRepo = document.querySelector('[data-setup-repo]');
  const setupKey = document.querySelector('[data-setup-key]');
  const setupCopy = document.querySelector('[data-setup-copy]');
  const setupHost = document.querySelector('[data-setup-host]');
  const setupInstructions = document.querySelector('[data-setup-instructions]');
  const setupLink = document.querySelector('[data-setup-link]');
  const setupError = document.querySelector('[data-setup-error]');
  const setupDetails = document.querySelector('[data-setup-details]');
  const setupDetailText = document.querySelector('[data-setup-detail-text]');
  const setupRetry = document.querySelector('[data-setup-retry]');
  const terminalPane = document.querySelector('[data-terminal-pane]');
  const terminalHost = document.querySelector('[data-terminal-host]');
  const overlay = document.querySelector('[data-terminal-overlay]');
  const overlayText = document.querySelector('[data-terminal-overlay-text]');
  const workspaceId = new URLSearchParams(window.location.search).get('id');
  let currentSource = '';
  let terminal = null;
  let canCommit = false;
  let committing = false;

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

  const renderCommitButton = (dirty, ahead) => {
    if (!commitButton || !canCommit) return;
    const pending = dirty || ahead > 0;
    commitButton.hidden = !pending;
    if (committing) return;
    commitButton.textContent = dirty ? 'Commit' : ahead === 1 ? 'Push 1 commit' : `Push ${ahead} commits`;
  };

  const renderStatus = (head, dirty, ahead = 0) => {
    renderCommitButton(dirty, ahead);
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

  // --- deploy-key setup panel ------------------------------------------------

  const instructionsFor = (setup) => {
    const write = `tick "${setup.writeOption}"`;
    if (setup.kind === 'github') return `On the page that opens, type "Dialogue" as the title, paste the key into the big "Key" box, ${write}, then click "${setup.addButton}".`;
    if (setup.kind === 'gitlab') return `On the page that opens, expand "Deploy keys", click "Add new key", paste the key, type "Dialogue" as the title, ${write}, then click "${setup.addButton}".`;
    if (setup.kind === 'gitea') return `On the page that opens, click "${setup.addButton}", paste the key, type "Dialogue" as the title, ${write}, then click the add button.`;
    return `Open your repository's settings, find "Deploy keys" (sometimes "Access keys"), add the key with the title "Dialogue" and make sure it has ${setup.writeOption}.`;
  };

  const closeSetup = () => {
    if (!setupLayer || setupLayer.hidden) return;
    setupLayer.classList.remove('is-open');
    window.setTimeout(() => { setupLayer.hidden = true; }, 160);
    commitButton?.focus();
  };

  const showSetup = (setup, failedBefore) => {
    if (!setupLayer) return;
    if (setupRepo) setupRepo.textContent = setup.repository || 'this repository';
    if (setupKey) setupKey.textContent = setup.publicKey || '';
    if (setupHost) setupHost.textContent = setup.name || 'the repository';
    if (setupInstructions) setupInstructions.textContent = instructionsFor(setup);
    if (setupLink) setupLink.href = setup.settingsUrl || '#';
    if (setupError) {
      setupError.hidden = !failedBefore;
      setupError.textContent = failedBefore
        ? `${setup.name || 'The repository'} has not accepted the key yet. Check that the whole key was pasted and that "${setup.writeOption}" was ticked, then try again.`
        : '';
    }
    if (setupDetails && setupDetailText) {
      setupDetails.hidden = !setup.detail;
      setupDetailText.textContent = setup.detail || '';
    }
    if (setupLayer.hidden) {
      setupLayer.hidden = false;
      requestAnimationFrame(() => setupLayer.classList.add('is-open'));
    }
    (failedBefore ? setupRetry : setupCopy)?.focus();
  };

  let copyResetTimer = null;
  setupCopy?.addEventListener('click', async () => {
    const key = setupKey?.textContent || '';
    try {
      await navigator.clipboard.writeText(key);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(setupKey);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
    }
    setupCopy.textContent = 'Copied!';
    clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => { setupCopy.textContent = 'Copy'; }, 3000);
  });
  setupClose?.addEventListener('click', closeSetup);
  setupLayer?.addEventListener('click', (event) => {
    if (event.target === setupLayer) closeSetup();
  });

  // --- commit ----------------------------------------------------------------

  const requestCommit = async (retry = false) => {
    if (!commitButton || committing) return;
    const label = commitButton.textContent;
    committing = true;
    commitButton.disabled = true;
    commitButton.textContent = retry ? 'Checking…' : 'Committing…';
    if (setupRetry) setupRetry.disabled = true;
    let accepted = false;
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/commit`, { method: 'POST', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload.setup) {
        showSetup(payload.setup, retry);
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'Could not start the commit.');
      closeSetup();
      accepted = true;
      // The agent reports in the terminal; the chip follows via SSE.
      commitButton.textContent = 'Working…';
    } catch (error) {
      closeSetup();
      state.hidden = false;
      state.classList.add('is-error');
      state.textContent = error.message || 'Could not start the commit.';
      window.setTimeout(() => { state.hidden = Boolean(currentSource); state.classList.remove('is-error'); }, 6000);
    } finally {
      committing = false;
      commitButton.disabled = false;
      if (!accepted) commitButton.textContent = label;
      if (setupRetry) setupRetry.disabled = false;
    }
  };

  commitButton?.addEventListener('click', () => requestCommit(false));
  setupRetry?.addEventListener('click', () => requestCommit(true));

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
      let files = true;
      try {
        const payload = JSON.parse(event.data);
        renderStatus(payload.head, payload.dirty, payload.ahead);
        files = payload.files !== false;
      } catch {
        // ignore malformed frames
      }
      if (files) reloadPrototype();
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
      canCommit = Boolean(workspace.terminal);
      renderStatus(workspace.head, workspace.dirty, workspace.ahead);

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
