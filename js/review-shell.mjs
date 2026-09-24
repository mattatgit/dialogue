import { readGrid, writeGrid, preferencesPersisted } from './review-preferences.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="assets/review-icons.svg#${name}"/></svg>`;
const nav = document.querySelector('.side-nav');
const page = location.pathname.split('/').pop();
if (nav) nav.innerHTML = [['projects.html','folder','Projects'],['design-systems.html','system','Design systems'],['settings.html','settings','Settings']].map(([href, image, title]) => {
  const current = page === href || (href === 'projects.html' && page === 'project-landline.html');
  return `<a class="side-link${current ? ' active' : ''}" href="${href}" ${current ? 'aria-current="page"' : ''} title="${title}">${icon(image)}<span>${title}</span></a>`;
}).join('');
const brand = document.querySelector('.brand');
if (brand) brand.innerHTML = `<a href="projects.html" aria-label="Dialogue projects">${icon('mark')}</a>`;

const grid = document.querySelector('[data-project-grid]');
if (grid) {
  const empty = document.querySelector('[data-project-empty]');
  const status = document.querySelector('[data-project-status]');
  async function loadProjects() {
    status.textContent = 'Loading projects...'; status.hidden = false; empty.hidden = true;
    grid.replaceChildren();
    try {
      const response = await fetch('/api/projects', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.projects)) throw new Error('Projects could not be loaded.');
      const preview = new URLSearchParams(location.search).get('empty') === '1';
      const projects = preview ? [] : body.projects;
      for (const project of projects) {
        const link = document.createElement('a'); link.className = 'project-card';
        link.href = 'project-landline.html';
        // Only the Landline project route is implemented in the current local app.
        if (project.slug !== 'landline') { link.href = '#'; link.addEventListener('click', e => { e.preventDefault(); status.hidden = false; status.textContent = 'Only the Landline project is connected in this local build.'; }); }
        const initials = String(project.name || 'Project').split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase();
        link.innerHTML = `<div class="project-badge">${esc(initials)}</div><div class="project-name">${esc(project.name)}</div><p class="project-desc">${esc(project.description)}</p><div class="project-divider"></div><div class="project-meta"><div><div class="meta-label">Created</div><div class="meta-value">${esc(new Date(project.createdAt).toLocaleDateString())}</div></div><div class="meta-item"><div class="meta-label">Prototypes</div><div class="meta-value">${esc(project.prototypes ?? 0)}</div></div></div>`;
        grid.append(link);
      }
      empty.hidden = projects.length !== 0;
      status.hidden = !preview;
      status.textContent = preview ? 'Empty-state preview. Your saved projects have not been changed.' : '';
    } catch {
      empty.hidden = true; status.hidden = false;
      status.textContent = 'Could not connect to Dialogue. This is not an empty project list. ';
      const retry = document.createElement('button'); retry.className = 'review-button'; retry.textContent = 'Retry'; retry.onclick = loadProjects; status.append(retry);
    }
  }
  // Preserve the existing UI-only New Project prototype, but do not imply it is saved.
  new MutationObserver(() => { if (grid.childElementCount) empty.hidden = true; }).observe(grid, { childList: true });
  document.querySelector('[data-new-project-form]')?.addEventListener('submit', () => {
    status.hidden = false; status.textContent = 'New project is a UI preview only; creation is not connected to storage yet.';
  });
  loadProjects();
}

const gridForm = document.querySelector('[data-grid-settings]');
if (gridForm) {
  const color = gridForm.querySelector('[name="gridColor"]');
  const size = gridForm.querySelector('[name="gridSize"]');
  const opacity = gridForm.querySelector('[name="gridOpacity"]');
  function paint() {
    const settings = readGrid(); color.value = settings.color; size.value = settings.size; opacity.value = settings.opacity;
    gridForm.querySelector('[data-grid-color-label]').textContent = settings.color;
  }
  gridForm.addEventListener('submit', e => e.preventDefault());
  gridForm.addEventListener('change', () => {
    if (!gridForm.reportValidity()) return;
    const result = writeGrid({ ...readGrid(), color: color.value, size: Number(size.value), opacity: Number(opacity.value) });
    gridForm.querySelector('[data-grid-color-label]').textContent = result.color;
    document.querySelector('[data-settings-status]').textContent = preferencesPersisted() ? 'Grid preferences saved in this browser.' : 'Browser storage is unavailable. Changes apply only in this session.';
  });
  addEventListener('storage', paint); paint();
}
