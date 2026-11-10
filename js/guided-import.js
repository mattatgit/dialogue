import { api, el, note, files, stateLabel, submit, disabled } from './build-ui.mjs';
import { replyMarkdown } from './reply-markdown.mjs';
const $ = s => document.querySelector(s), query = new URLSearchParams(location.search);
let id = query.get('attempt'), projectId = query.get('project'), current, shownRevision, dirty = false, timer;
const busy = a => ['connecting','inspecting','preparing','validating'].includes(a.state);
const operationId = crypto.randomUUID();
if (projectId) {
  $('[data-import-title]').textContent = 'Import build';
  $('[data-import-back]').href = `project.html?id=${projectId}`;
  api(`/api/catalog/projects/${projectId}`).then(d => { const select = $('[data-existing-source]');
    d.sources.forEach(s => { const o = el('option', s.url); o.value = s.id; select.append(o); }); $('[data-existing-source-label]').hidden = !d.sources.length;
  }).catch(e=>note(e.message));
}
const field = (parent, label, name, value, tag = 'input') => { const row = el('label',label), input = el(tag); input.name = name; input.className = 'form-field'; input.value = value || ''; row.append(input); parent.append(row); return input; };
function renderPlan(a) {
  if (!a.plan || dirty || shownRevision === a.revision) return;
  shownRevision = a.revision; const form = $('[data-import-plan]'); form.elements.projectName.value = a.plan.projectName; form.elements.projectName.disabled = Boolean(a.projectId);
  $('[data-proposed-builds]').replaceChildren(...a.plan.builds.map((b,i) => {
    const box = el('fieldset','','flow-plan-build'); box.dataset.index = i;
    const selected = el('label','','flow-select'), check = el('input'); check.type = 'checkbox'; check.name = 'selected'; check.checked = b.selected; check.className = 'flow-check'; selected.append(check,el('span','Prepare this build')); box.append(selected);
    field(box,'Build name','name',b.name); const target = field(box,'Target','target',b.target,'select');
    for (const t of ['Web','macOS','iOS','NixOS']) { const o=el('option',t); o.value=t; target.append(o); } target.value=b.target;
    field(box,'Application root','root',b.root); field(box,'Assessed source branch (change through assessment above)','ref',b.ref).readOnly=true; field(box,'Destination branch (nothing is pushed yet)','destinationRef',b.destinationRef);
    field(box,'Approach and any simulations','approach',b.approach,'textarea'); field(box,'Limitations and missing input','limitations',b.limitations,'textarea');
    field(box,'Representative safe button label (optional)','clickText',b.verification?.clickText); field(box,'Text expected after that click','expectedText',b.verification?.expectedText);
    return box;
  }));
}
const planInput = () => ({ ...current.attempt.plan, projectName: $('[data-import-plan]').elements.projectName.value,
  builds: [...document.querySelectorAll('.flow-plan-build')].map(box => { const f = name => box.querySelector(`[name="${name}"]`); return { selected:f('selected').checked,name:f('name').value,target:f('target').value,root:f('root').value,ref:f('ref').value,destinationRef:f('destinationRef').value,approach:f('approach').value,limitations:f('limitations').value,verification:{clickText:f('clickText').value,expectedText:f('expectedText').value} }; }) });
async function savePlan() { await api(`/api/catalog/imports/${id}/plan`,planInput()); dirty=false; shownRevision=null; await load(); }
async function load() {
  clearTimeout(timer); const data = current = await api(`/api/catalog/imports/${id}`), a = data.attempt;
  $('[data-connect-panel]').hidden=true; $('[data-import-work]').hidden=false;
  $('[data-import-state]').textContent=stateLabel(a.state);
  $('[data-import-progress]').textContent=a.error || data.requests.findLast(r=>r.status==='running')?.workingDetail || 'Source, discussion and decisions are saved. Preparation does not publish code.';
  $('[data-source-revision]').textContent=`${data.source?.url || ''}${a.sourceRef ? ' · '+a.sourceRef : ''}${a.sourceSha ? ' · '+a.sourceSha : ''}`;
  $('[data-import-resume]').hidden=busy(a)||a.state==='ready'||a.state==='configured'||a.state==='awaiting-confirmation';
  $('[data-import-cancel]').hidden=!busy(a); $('[data-import-reconnect]').hidden=a.failureKind!=='repository-access'||busy(a); $('[data-model-settings]').hidden=a.failureKind!=='ai-access';
  $('[data-assessment-panel]').hidden=!a.plan&&!a.assessmentReply;
  $('[data-assessment]').innerHTML=replyMarkdown(a.plan?.assessment || a.assessmentReply || '');
  $('[data-import-discussion]').replaceChildren(...(a.attempts || []).filter(t=>t.message!=='Inspect source').map(t=>{
    const box=el('div','','flow-discussion-item'); box.append(el('p',t.message)); const record=data.requests.find(r=>r.id===t.requestId);
    if(record?.reply) { const reply=el('details'); reply.append(el('summary','Dialogue’s retained response')); const body=el('div'); body.innerHTML=replyMarkdown(record.reply); reply.append(body); box.append(reply); } return box;
  }));
  for (const control of $('[data-import-discuss]').elements) disabled(control,busy(a)||Boolean(a.prepared.length));
  $('[data-discussion-help]').hidden=!a.prepared.length;
  $('[data-plan-panel]').hidden=!a.plan; renderPlan(a);
  for (const control of $('[data-import-plan]').elements) disabled(control,busy(a));
  for (const box of document.querySelectorAll('.flow-plan-build')) {
    const build=data.builds.find(b=>a.prepared.some(p=>p.buildId===b.id && p.index===Number(box.dataset.index)));
    disabled(box.querySelector('[name=selected]'),busy(a)||Boolean(a.prepared.length));
    for(const name of ['ref','destinationRef']) disabled(box.querySelector(`[name=${name}]`),busy(a)||Boolean(build?.workspaceId));
  }
  disabled($('[data-import-plan]').elements.projectName,Boolean(a.projectId)||busy(a));
  disabled($('[data-plan-confirm]'),a.state!=='awaiting-confirmation');
  $('[data-results-panel]').hidden=!data.builds.length;
  $('[data-build-results]').replaceChildren(...data.builds.map(b=>{const row=el('div','','flow-row'), copy=el('div'); copy.append(el('strong',`${b.name} · ${b.target}`),el('p',stateLabel(b.state)),el('p',b.error || b.verificationOutstanding || '', 'flow-help')); const link=el('a','Open build','pill outline'); link.href=`build.html?id=${b.id}`; row.append(copy,link); return row;}));
  $('[data-open-project]').hidden=!a.projectId; $('[data-open-project]').href=`project.html?id=${a.projectId}`;
  $('[data-import-diagnostics]').textContent=JSON.stringify({state:a.state,failureKind:a.failureKind,sourceRevision:a.sourceSha,approvedRevision:a.approval?.revision,events:a.events,requests:data.requests.map(r=>({id:r.id,status:r.status,error:r.error,worker:r.worker}))},null,2);
  if(a.access) window.DialogueConnect?.show(a.access,{failedBefore:true,intro:'Connect this repository for read access. Write access is only needed later if you choose to publish versions.',onRetry:()=>action('resume')}); else window.DialogueConnect?.close();
  if(busy(a)) timer=setTimeout(()=>load().catch(e=>note(e.message)),1500);
}
async function action(name,body={}) { note(''); try { await api(`/api/catalog/imports/${id}/${name}`,body); await load(); } catch(e){note(e.message);await load().catch(()=>{});} }
$('[data-import-connect]').addEventListener('submit',e=>{e.preventDefault();submit(e.target,async()=>{
  const form=e.target,sourceId=form.elements.sourceId.value,input={operationId,...(projectId?{projectId}:{}),...(sourceId?{sourceId}:{url:form.elements.url.value}),...(form.elements.ref.value?{ref:form.elements.ref.value}:{})};
  const data=await api('/api/catalog/imports',input);id=data.attempt.id;history.replaceState({},'',`import.html?attempt=${id}`);await load();
});});
$('[data-import-plan]').addEventListener('input',()=>{dirty=true;});
$('[data-import-plan]').addEventListener('submit',e=>{e.preventDefault();submit(e.target,savePlan);});
$('[data-plan-confirm]').addEventListener('click',()=>submit($('[data-import-plan]'),async()=>{if(dirty)await savePlan();await action('confirm',{revision:current.attempt.revision});}));
$('[data-import-discuss]').addEventListener('submit',e=>{e.preventDefault();submit(e.target,async()=>{const input={message:e.target.elements.message.value,attachments:await files(e.target.elements.files)};if(e.target.elements.ref.value)input.ref=e.target.elements.ref.value;if(e.target.elements.figmaUrl.value)input.figmaUrl=e.target.elements.figmaUrl.value;await action('discuss',input);});});
for(const name of ['resume','cancel','reconnect']) $(`[data-import-${name}]`).addEventListener('click',()=>action(name));
if(id) load().catch(e=>note(e.message));
