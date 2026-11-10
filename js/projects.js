import { api, el, note, importRows, submit } from './build-ui.mjs';
const grid = document.querySelector('[data-project-grid]');
async function load() {
 const { projects } = await api('/api/catalog/projects');
 grid.replaceChildren(...projects.map(p => { const card = el('a', '', 'project-card'); card.href = `project.html?id=${p.id}`; card.append(el('div', p.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase(), 'project-badge'), el('div', p.name, 'project-name'), el('p', `${p.buildCount} ${p.buildCount === 1 ? 'build' : 'builds'}`, 'project-desc')); return card; }));
 document.querySelector('[data-project-empty]').hidden = projects.length > 0;
 importRows(document.querySelector('[data-import-list]'), (await api('/api/catalog/imports')).attempts);
}
const operationId = crypto.randomUUID();
const form = document.querySelector('[data-project-create]');
form.addEventListener('submit', e => { e.preventDefault(); submit(form, async () => { const { project } = await api('/api/catalog/projects', { name: form.elements.name.value, operationId }); location.href = `project.html?id=${project.id}`; }, document.querySelector('[data-create-error]')); });
load().catch(e => note(e.message));
