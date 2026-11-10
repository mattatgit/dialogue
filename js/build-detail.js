import { api, el, note, stateLabel } from './build-ui.mjs';
import { replyMarkdown } from './reply-markdown.mjs';
const id = new URLSearchParams(location.search).get('id'); let current;
async function load() {
 const d = current = await api(`/api/catalog/builds/${encodeURIComponent(id)}`), b = d.build;
 document.querySelector('[data-build-name]').textContent = b.name; document.title = `Dialogue — ${b.name}`;
 const project = document.querySelector('[data-project-link]'); project.textContent = d.project.name; project.href = `project.html?id=${d.project.id}`;
 document.querySelector('[data-build-source]').textContent = `${b.target} · ${d.source?.url || 'Local source · no remote repository'} · root ${b.root || "existing branch recipe"}`;
 document.querySelector('[data-build-scope]').textContent = `Publication: ${b.publication}. Each branch publishes the whole repository, including shared paths. This build has its own working copy and recipe; other builds’ pending edits are separate.`;
 document.querySelector('[data-build-state]').textContent = `${stateLabel(b.state)}${b.error ? ': '+b.error : ''}${b.verificationOutstanding ? '. '+b.verificationOutstanding : ''}`;
 document.querySelector('[data-build-resume]').hidden = !['failed','cancelled'].includes(b.state);
 document.querySelector('[data-build-cancel]').hidden = !['preparing','validating'].includes(b.state);
 const link = document.querySelector('[data-build-import]'); link.hidden = !b.importId; link.href = `import.html?attempt=${b.importId}`;
 document.querySelector('[data-branch-panel]').hidden = b.target !== 'Web' || !d.refs.branches.length;
 const select = document.querySelector('[data-branch-select]'), previous = select.value;
 select.replaceChildren(...[...d.refs.branches.map(r=>({...r,kind:'Branch'})),...d.refs.tags.map(r=>({...r,kind:'Tag'}))].map(r => { const o = el('option', `${r.kind}: ${r.name}`); o.value = r.name; return o; })); select.value = previous || d.defaultBranch;
 document.querySelector('[data-build-plan]').hidden = !b.approvedPlan && !b.prompt;
 document.querySelector('[data-build-plan-content]').innerHTML = replyMarkdown(b.approach || b.prompt || '') + replyMarkdown(b.limitations || '');
 if (d.error) note(d.error); if (['preparing','validating'].includes(b.state)) setTimeout(()=>load().catch(e=>note(e.message)),1500);
}
for (const [selector,action] of [['[data-open-branch]','open'],['[data-new-branch]','branch']]) document.querySelector(selector).addEventListener('submit',async e=>{e.preventDefault();try {location.href=(await api(`/api/catalog/builds/${id}/${action}`,{ref:e.target.elements.ref.value,from:document.querySelector('[data-branch-select]').value})).viewerUrl;}catch(e){note(e.message);}});
for (const action of ['resume','cancel']) document.querySelector(`[data-build-${action}]`).addEventListener('click',async()=>{try {await api(`/api/catalog/builds/${id}/${action}`,{});await load();}catch(e){note(e.message);}});
load().catch(e=>note(e.message));
