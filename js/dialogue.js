(() => {
  const openHashModal = (layer) => {
    if (!layer) return;
    layer.classList.remove('is-closing');
    layer.classList.add('is-open');
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${layer.id}`);
  };

  const closeHashModal = (layer) => {
    if (!layer || layer.classList.contains('is-closing') || !layer.classList.contains('is-open')) return;
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    const finish = () => {
      layer.classList.remove('is-closing');
      history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else window.setTimeout(finish, 100);
  };

  ['new-project'].forEach((id) => {
    const layer = document.getElementById(id);
    if (!layer) return;

    document.querySelectorAll(`a[href="#${id}"]`).forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        openHashModal(layer);
      });
    });

    const closeButton = layer.querySelector('.modal-close');
    closeButton?.addEventListener('click', (event) => {
      event.preventDefault();
      closeHashModal(layer);
    });

    layer.addEventListener('click', (event) => {
      if (event.target === layer) closeHashModal(layer);
    });
  });

  const initialModalId = window.location.hash.slice(1);
  if (initialModalId === 'new-project') {
    openHashModal(document.getElementById(initialModalId));
  }

  const gridForm = document.querySelector('[data-grid-settings]');
  if (gridForm) {
    import('./review-preferences.mjs').then(({ readGrid, writeGrid, preferencesPersisted }) => {
      const color = gridForm.elements.gridColor;
      const size = gridForm.elements.gridSize;
      const opacity = gridForm.elements.gridOpacity;
      const label = gridForm.querySelector('[data-grid-color-label]');
      const status = gridForm.querySelector('[data-settings-status]');
      const paint = () => {
        const grid = readGrid();
        color.value = grid.color;
        size.value = grid.size;
        opacity.value = grid.opacity;
        label.textContent = grid.color;
      };
      gridForm.addEventListener('submit', (event) => event.preventDefault());
      gridForm.addEventListener('change', () => {
        if (!gridForm.reportValidity()) return;
        const grid = writeGrid({ ...readGrid(), color: color.value, size: Number(size.value), opacity: Number(opacity.value) });
        label.textContent = grid.color;
        status.textContent = preferencesPersisted() ? 'Grid preferences saved in this browser.' : 'Browser storage is unavailable. Changes apply only in this session.';
      });
      window.addEventListener('storage', paint);
      paint();
    }).catch(() => {
      gridForm.querySelector('[data-settings-status]').textContent = 'Grid preferences are unavailable right now.';
      for (const control of gridForm.querySelectorAll('input,select')) control.disabled = true;
    });
  }
})();
