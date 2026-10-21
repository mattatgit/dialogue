(() => {
  const grid = document.querySelector('[data-ref-groups]');
  const empty = document.querySelector('[data-ref-empty]');
  const note = document.querySelector('[data-ref-note]');
  const titleNode = document.querySelector('[data-project-title]');
  const linkNode = document.querySelector('[data-project-link]');
  const projectSlug = new URLSearchParams(window.location.search).get('slug') || '';
  if (!grid) return;
  if (!projectSlug) {
    window.location.replace('projects.html');
    return;
  }

  const setNote = (message = '', state = '') => {
    if (!note) return;
    note.textContent = message;
    note.hidden = !message;
    note.classList.toggle('is-error', state === 'error');
  };

  const relativeLabel = (isoDate) => {
    const time = new Date(isoDate).getTime();
    if (!Number.isFinite(time)) return '';
    const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const openWorkspace = async (ref, tile) => {
    tile.classList.add('is-busy');
    setNote(`Opening ${ref.name}…`);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: ref.name })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.workspace) throw new Error(payload.error || 'Could not open this branch.');
      window.location.href = payload.workspace.viewerUrl;
    } catch (error) {
      tile.classList.remove('is-busy');
      setNote(error.message || 'Could not open this branch.', 'error');
    }
  };

  const buildTile = (ref, kind) => {
    const tile = document.createElement('div');
    tile.className = 'proto-tile ref-tile';
    tile.dataset.kind = kind;
    const link = document.createElement('a');
    link.className = 'ref-link';
    link.href = `workspace.html?id=${encodeURIComponent(ref.workspaceId)}`;

    const surface = document.createElement('span');
    surface.className = 'proto-surface';

    const preview = document.createElement('span');
    preview.className = 'proto-preview ref-preview';
    if (ref.previewUrl) {
      const image = document.createElement('img');
      image.className = 'ref-shot';
      image.src = ref.previewUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => { image.remove(); preview.classList.add('is-empty'); });
      preview.appendChild(image);
      // No image of its own yet: main's stands in until the branch is opened.
      if (ref.previewExact === false) {
        const from = document.createElement('span');
        from.className = 'ref-shot-source';
        from.textContent = 'from main';
        preview.appendChild(from);
      }
    } else {
      preview.classList.add('is-empty');
    }

    if (ref.open) {
      const badge = document.createElement('span');
      badge.className = 'ref-open-badge';
      badge.textContent = 'Open';
      badge.title = 'A local working copy exists. This does not indicate merge status or an active editor.';
      surface.appendChild(badge);
    }

    const info = document.createElement('span');
    info.className = 'proto-info';
    const title = document.createElement('span');
    title.className = 'proto-name ref-name';
    title.textContent = ref.name;
    title.title = ref.name;
    const when = document.createElement('time');
    when.className = 'ref-when';
    when.dateTime = ref.committedAt;
    const savedAt = relativeLabel(ref.committedAt);
    when.textContent = savedAt ? `Saved ${savedAt}` : '';
    when.title = `Last commit: ${ref.committedAt}`;

    info.append(title, when);
    surface.append(preview, info);
    link.appendChild(surface);

    const details = document.createElement('details');
    details.className = 'ref-details';
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', `Details for ${ref.name}`);
    summary.title = `Details for ${ref.name}`;
    const menuIcon = document.createElement('img');
    menuIcon.src = 'assets/tile-menu.svg';
    menuIcon.alt = '';
    menuIcon.width = 32;
    menuIcon.height = 32;
    summary.appendChild(menuIcon);
    const panel = document.createElement('div');
    panel.className = 'ref-details-panel';
    const metadata = document.createElement('dl');
    for (const [label, value] of [
      [kind === 'branch' ? 'Branch' : 'Tag', ref.name],
      ['Last commit', `${ref.sha.slice(0, 7)}${ref.subject ? ` · ${ref.subject}` : ''}`],
      ['Saved', ref.committedAt],
      ['Working copy', ref.open ? 'Available locally' : 'Created when opened']
    ]) {
      const term = document.createElement('dt');
      term.textContent = label;
      const definition = document.createElement('dd');
      definition.textContent = value;
      metadata.append(term, definition);
    }
    panel.appendChild(metadata);
    details.append(summary, panel);
    details.addEventListener('toggle', () => {
      if (details.open) grid.querySelectorAll('.ref-details[open]').forEach((other) => {
        if (other !== details) other.open = false;
      });
    });
    tile.append(link, details);

    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (tile.classList.contains('is-busy')) return;
      openWorkspace(ref, tile);
    });
    return tile;
  };

  document.addEventListener('click', (event) => {
    grid.querySelectorAll('.ref-details[open]').forEach((details) => {
      if (!details.contains(event.target)) details.open = false;
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    grid.querySelectorAll('.ref-details[open]').forEach((details) => {
      if (details.contains(document.activeElement)) details.querySelector('summary').focus();
      details.open = false;
    });
  });

  const buildGroup = (label, refs, kind) => {
    const section = document.createElement('section');
    section.className = 'ref-group';
    section.setAttribute('aria-label', label);
    if (kind === 'tag') {
      const heading = document.createElement('h2');
      heading.className = 'ref-group-title';
      heading.textContent = label;
      const count = document.createElement('span');
      count.className = 'ref-group-count';
      count.textContent = String(refs.length);
      heading.appendChild(count);
      section.appendChild(heading);
    }
    const list = document.createElement('div');
    list.className = 'grid';
    list.append(...refs.map((ref) => buildTile(ref, kind)));
    section.appendChild(list);
    return section;
  };

  const showProject = (project) => {
    if (!project) return;
    document.title = `Dialogue — ${project.name}`;
    if (titleNode) titleNode.textContent = project.name;
    if (linkNode) {
      linkNode.href = project.webUrl;
      linkNode.textContent = project.repo.host === 'github.com' ? 'Open on GitHub' : `Open on ${project.repo.host}`;
      linkNode.hidden = false;
    }
  };

  // Private repository over SSH whose key is not registered yet: guide the
  // user through adding it, then reload the refs.
  const showConnect = (setup, failedBefore) => {
    window.DialogueConnect?.show(setup, {
      failedBefore,
      intro: `This repository is private. Add Dialogue's key to ${setup.repository || 'it'} so Dialogue can read it — a one-time step that takes about a minute. Tick write access too, so changes can be saved later.`,
      after: 'Once the key is added, press the button below. Dialogue connects to the repository and shows its branches.',
      onRetry: () => {
        window.DialogueConnect.busy(true);
        load(true).finally(() => window.DialogueConnect.busy(false));
      }
    });
  };

  // While the preview is being set up, re-read quietly so screenshots
  // appear as soon as the setup finishes.
  let pollTimer = null;
  const setupMessage = (setup) => {
    if (setup?.status === 'queued' || setup?.status === 'running') return 'Setting up the preview for this project… screenshots appear when it is done.';
    if (setup?.status === 'waiting-for-agent') return 'The preview is waiting for an AI model to be connected (see Settings).';
    if (setup?.status === 'failed') return 'Dialogue could not set up a preview for this project. See the Projects page to retry or fix it.';
    return '';
  };

  const load = async (retry = false, quiet = false) => {
    clearTimeout(pollTimer);
    if (!quiet) setNote('Fetching branches…');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/refs`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) {
        window.location.replace('projects.html');
        return;
      }
      if (payload.setup) {
        setNote('Dialogue cannot read this repository yet.', 'error');
        if (empty) empty.hidden = true;
        showConnect(payload.setup, retry);
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'Could not read the repository.');
      window.DialogueConnect?.close();
      showProject(payload.project);

      const groups = [];
      if (payload.branches?.length) groups.push(buildGroup('Branches', payload.branches, 'branch'));
      if (payload.tags?.length) groups.push(buildGroup('Tags', payload.tags, 'tag'));
      grid.replaceChildren(...groups);
      if (empty) {
        const hasPreview = Boolean(payload.project?.previewUrl || [...(payload.branches || []), ...(payload.tags || [])].some((ref) => ref.previewUrl));
        empty.hidden = hasPreview;
        const message = empty.querySelector('[data-ref-empty-message]');
        if (message) message.textContent = payload.branches?.length
          ? 'No preview yet. Open a branch below, or Create to request a prototype.'
          : 'No branches yet. Push a branch to your repository to start a prototype.';
      }
      const setupNote = setupMessage(payload.project?.previewSetup);
      if (!groups.length) setNote('This repository has no branches yet.');
      else if (payload.fetchError) setNote(`Showing the last known branches — ${payload.project?.repo?.host || 'the repository host'} could not be reached (${payload.fetchError}).`, 'error');
      else setNote(setupNote, payload.project?.previewSetup?.status === 'failed' ? 'error' : '');
      if (['queued', 'running'].includes(payload.project?.previewSetup?.status)) {
        pollTimer = window.setTimeout(() => load(false, true), 3000);
      }
    } catch (error) {
      if (empty) empty.hidden = true;
      setNote(error.message || 'Could not read the repository.', 'error');
    }
  };

  // Title and link first, so the page is not blank while cloning.
  fetch(`/api/projects/${encodeURIComponent(projectSlug)}`, { cache: 'no-store' })
    .then((response) => response.json())
    .then((payload) => showProject(payload.project))
    .catch(() => {});

  load();
})();
