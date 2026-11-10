import { api, el, note, files, stateLabel, importRows, submit } from './build-ui.mjs';
const q = new URLSearchParams(location.search), id = q.get('id') || q.get('slug'); let project;
async function load() {
 const data = await api(`/api/catalog/projects/${encodeURIComponent(id)}`); project = data.project;
 document.querySelector('[data-project-name]').textContent = project.name; document.title = `Dialogue — ${project.name}`;
 document.querySelector('[data-import-build]').href = `import.html?project=${project.id}`;
 document.querySelector('[data-build-grid]').replaceChildren(...data.builds.map(b => { const card = el('a', '', 'proto-tile'); card.href = `build.html?id=${b.id}`; const surface = el('span', '', 'proto-surface'), preview = el('span', b.previewUrl ? '' : b.target, 'proto-preview');
 if (b.previewUrl) { const img = el('img'); img.src = b.previewUrl; img.alt = ''; preview.append(img); }
 const info = el('span', '', 'proto-info'); info.append(el('span', b.name, 'proto-name'), el('span', `${b.target} · ${stateLabel(b.state)}`, 'ref-when')); surface.append(preview, info); card.append(surface); return card; }));
 document.querySelector('[data-build-empty]').hidden = data.builds.length > 0;
 document.querySelector('[data-sources-panel]').hidden = !data.sources.length;
 document.querySelector('[data-sources]').replaceChildren(...data.sources.map(s => el('p', s.url, 'flow-help')));
 importRows(document.querySelector('[data-import-list]'), data.imports);
 if (data.builds.some(b => ['preparing','validating'].includes(b.state))) setTimeout(()=>load().catch(e=>note(e.message)),2000);
}
const operationId = crypto.randomUUID();
const form = document.querySelector('[data-build-create]'); form.addEventListener('submit', e => { e.preventDefault(); submit(form, async () => {
 const input = Object.fromEntries(new FormData(form)); delete input.files; input.attachments = await files(form.elements.files); input.operationId = operationId; if (!input.figmaUrl) delete input.figmaUrl;
 const { build } = await api(`/api/catalog/projects/${project.id}/builds`, input); location.href = `build.html?id=${build.id}`;
}, document.querySelector('[data-create-error]')); }); load().catch(e=>note(e.message));
