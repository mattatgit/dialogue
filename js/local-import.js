(() => {
  const openButton = document.querySelector('[data-import-open]');
  const layer = document.querySelector('[data-import-layer]');
  const closeButton = document.querySelector('[data-import-close]');
  const form = document.querySelector('[data-import-form]');
  const fileInput = document.querySelector('[data-import-file]');
  const fileButton = document.querySelector('[data-import-file-trigger]');
  const fileName = document.querySelector('[data-import-file-name]');
  const status = document.querySelector('[data-import-status]');
  const grid = document.querySelector('[data-prototype-grid]');
  const versionField = form?.querySelector('[name="version"]');
  const nameField = form?.querySelector('[name="prototypeName"]');
  const submitButton = form?.querySelector('[type="submit"]');

  if (!openButton || !layer || !form || !grid) return;

  const setStatus = (message = '', state = '') => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', state === 'error');
    status.classList.toggle('is-success', state === 'success');
  };

  const openModal = () => {
    layer.classList.remove('is-closing');
    layer.classList.add('is-open');
    layer.setAttribute('aria-hidden', 'false');
    setStatus('');
    window.setTimeout(() => nameField?.focus(), 0);
  };

  const closeModal = () => {
    if (!layer.classList.contains('is-open')) return;
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    const finish = () => {
      layer.classList.remove('is-closing');
      layer.setAttribute('aria-hidden', 'true');
      openButton.focus();
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else window.setTimeout(finish, 100);
  };

  const relativeEditedLabel = (isoDate) => {
    const time = new Date(isoDate).getTime();
    if (!Number.isFinite(time)) return 'Edited recently';
    const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (seconds < 60) return 'Edited just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `Edited ${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `Edited ${hours}h ago`;
    const days = Math.round(hours / 24);
    return `Edited ${days}d ago`;
  };

  const buildTile = (revision, isNewest) => {
    const link = document.createElement('a');
    link.className = 'proto-tile';
    link.href = revision.viewerUrl || `prototype.html?revision=${encodeURIComponent(revision.id)}`;

    const surface = document.createElement('span');
    surface.className = 'proto-surface';

    if (isNewest) {
      const badge = document.createElement('img');
      badge.className = 'new-badge-img';
      badge.src = 'assets/badge-new.svg';
      badge.alt = 'New';
      surface.appendChild(badge);
    }

    const preview = document.createElement('span');
    preview.className = 'proto-preview';
    const image = document.createElement('img');
    image.className = 'landline-proto-img';
    image.src = 'assets/landline-proto.png';
    image.alt = `${revision.title || 'Prototype'} preview`;
    preview.appendChild(image);

    const info = document.createElement('span');
    info.className = 'proto-info';
    const title = document.createElement('span');
    title.className = 'proto-name';
    title.textContent = revision.title || `${revision.prototype?.name || 'Prototype'} ${revision.version || ''}`.trim();
    const time = document.createElement('span');
    time.className = 'proto-time';
    time.textContent = relativeEditedLabel(revision.createdAt);
    const menu = document.createElement('img');
    menu.className = 'tile-menu';
    menu.src = 'assets/tile-menu.svg';
    menu.alt = '';

    info.append(title, time, menu);
    surface.append(preview, info);
    link.appendChild(surface);
    return link;
  };

  const updateSuggestedVersion = (revisions) => {
    if (!versionField || !revisions.length) return;
    const numbers = revisions
      .map((revision) => /^v?(\d+)$/i.exec(revision.version || ''))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    if (numbers.length) versionField.value = `V${Math.max(...numbers) + 1}`;
  };

  const loadRevisions = async () => {
    try {
      const response = await fetch('/api/projects/landline/revisions', { cache: 'no-store' });
      if (!response.ok) return false;
      const payload = await response.json();
      const revisions = Array.isArray(payload.revisions) ? payload.revisions : [];

      if (revisions.length) {
        grid.replaceChildren(...revisions.map((revision, index) => buildTile(revision, index === 0)));
        updateSuggestedVersion(revisions);
      }
      return true;
    } catch {
      return false;
    }
  };

  openButton.addEventListener('click', (event) => {
    event.preventDefault();
    openModal();
  });

  closeButton?.addEventListener('click', closeModal);
  layer.addEventListener('click', (event) => {
    if (event.target === layer) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && layer.classList.contains('is-open')) closeModal();
  });

  fileButton?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (fileName) fileName.textContent = file ? file.name : 'No ZIP selected';
    setStatus('');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput?.files?.[0];
    const prototypeName = nameField?.value.trim() || 'Landline';
    const version = versionField?.value.trim() || '';

    if (!file) {
      setStatus('Choose a prototype ZIP first.', 'error');
      fileInput?.focus();
      return;
    }
    if (!/\.zip$/i.test(file.name)) {
      setStatus('Choose a ZIP package.', 'error');
      return;
    }

    const originalLabel = submitButton?.textContent || 'Import';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Importing…';
    }
    if (fileButton) fileButton.disabled = true;
    setStatus('Validating and importing prototype…');

    try {
      const query = new URLSearchParams({ name: prototypeName });
      if (version) query.set('version', version);
      const response = await fetch(`/api/projects/landline/import?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Import failed.');

      setStatus(`${payload.revision?.title || 'Prototype'} imported.`, 'success');
      form.reset();
      if (nameField) nameField.value = 'Landline';
      if (fileName) fileName.textContent = 'No ZIP selected';
      await loadRevisions();
      window.setTimeout(closeModal, 650);
    } catch (error) {
      const offline = error instanceof TypeError && window.location.protocol === 'file:';
      setStatus(
        offline
          ? 'Run the local Dialogue server before importing prototypes.'
          : error.message || 'Could not import this prototype.',
        'error'
      );
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
      if (fileButton) fileButton.disabled = false;
    }
  });

  loadRevisions();
})();
