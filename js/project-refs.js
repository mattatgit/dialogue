(() => {
  const grid = document.querySelector('[data-ref-groups]');
  const note = document.querySelector('[data-ref-note]');
  const projectSlug = document.body.dataset.project || 'landline';
  if (!grid) return;

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
    const tile = document.createElement('a');
    tile.className = 'proto-tile ref-tile';
    tile.href = `workspace.html?id=${encodeURIComponent(ref.workspaceId)}`;
    tile.dataset.kind = kind;

    const surface = document.createElement('span');
    surface.className = 'proto-surface';

    const preview = document.createElement('span');
    preview.className = 'proto-preview ref-preview';
    const image = document.createElement('img');
    image.className = 'landline-proto-img';
    image.src = 'assets/landline-proto.png';
    image.alt = '';
    preview.appendChild(image);

    if (ref.open) {
      const badge = document.createElement('span');
      badge.className = 'ref-open-badge';
      badge.textContent = 'Open';
      surface.appendChild(badge);
    }

    const info = document.createElement('span');
    info.className = 'proto-info';
    const title = document.createElement('span');
    title.className = 'proto-name ref-name';
    title.textContent = ref.name;
    title.title = ref.name;
    const meta = document.createElement('span');
    meta.className = 'proto-time ref-meta';
    const sha = document.createElement('code');
    sha.textContent = ref.sha.slice(0, 7);
    meta.append(sha, document.createTextNode(` · ${ref.subject || ''}`));
    meta.title = ref.subject || '';
    const when = document.createElement('span');
    when.className = 'ref-when';
    when.textContent = relativeLabel(ref.committedAt);

    info.append(title, meta, when);
    surface.append(preview, info);
    tile.appendChild(surface);

    tile.addEventListener('click', (event) => {
      event.preventDefault();
      if (tile.classList.contains('is-busy')) return;
      openWorkspace(ref, tile);
    });
    return tile;
  };

  const buildGroup = (label, refs, kind) => {
    const section = document.createElement('section');
    section.className = 'ref-group';
    const heading = document.createElement('h2');
    heading.className = 'ref-group-title';
    heading.textContent = label;
    const count = document.createElement('span');
    count.className = 'ref-group-count';
    count.textContent = String(refs.length);
    heading.appendChild(count);
    const list = document.createElement('div');
    list.className = 'grid';
    list.append(...refs.map((ref) => buildTile(ref, kind)));
    section.append(heading, list);
    return section;
  };

  const load = async () => {
    setNote('Fetching branches…');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/refs`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not read the repository.');

      const groups = [];
      if (payload.branches?.length) groups.push(buildGroup('Branches', payload.branches, 'branch'));
      if (payload.tags?.length) groups.push(buildGroup('Tags', payload.tags, 'tag'));
      grid.replaceChildren(...groups);
      if (!groups.length) setNote('This repository has no branches yet.');
      else if (payload.fetchError) setNote(`Showing the last known branches — GitHub could not be reached (${payload.fetchError}).`, 'error');
      else setNote('');
    } catch (error) {
      setNote(error.message || 'Could not read the repository.', 'error');
    }
  };

  load();
})();
