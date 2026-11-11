// Settings V2: per-person identity/connection; grid keeps browser-local storage.
const $ = selector => document.querySelector(selector);
const node = (tag,text='',className='') => {const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const initials = name => name.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const popular=[['openai-codex','ChatGPT','chatgpt'],['anthropic','Claude','claude'],['openrouter','OpenRouter','openrouter'],['github-copilot','Copilot','copilot'],['google-gemini-cli','Gemini','gemini']];
const photo = (container,user) => {container.replaceChildren();if(user.avatarUrl){const image=node('img');image.src=user.avatarUrl;image.alt='';container.append(image);}else container.textContent=initials(user.name);};
const textButton = (text,task) => {const b=node('button',text,'settings-text-button');b.type='button';b.addEventListener('click',()=>act(b,task));return b;};
let api,session,members=[],providerState,providers=[],models=[],refreshSequence=0;
const tell = (message,error=true) => {const n=$('[data-account-status]');n.textContent=message;n.style.color=error?'#a33c12':'#6b6b6b';};
async function act(button,work) {if(button.disabled)return;button.disabled=true;tell('');try{await work();}catch(e){tell(e.name==='NotAllowedError'?'The passkey request was cancelled or timed out. Please try again.':e.message);}finally{button.disabled=false;}}
const managementRow = (label,button) => {const row=node('div','','settings-management-row');row.append(node('span',label),button);return row;};
function renderAvatar() {
  $('[data-avatar-image]').src=session.user.avatarUrl || 'assets/settings-v2/avatar-default.png';
  $('[data-avatar-remove]').hidden=!session.user.avatarUrl;
}
async function renderMembers() {
  members=(await api('/api/account/members')).members.sort((a,b)=>Number(b.role==='owner')-Number(a.role==='owner'));
  $('[data-settings-members]').replaceChildren(...members.map(user=>{
    const row=node('div','','settings-row-card settings-member'),avatar=node('span','','settings-member-avatar'),copy=node('span','','settings-member-copy');photo(avatar,user);
    copy.append(node('strong',user.name),node('small',user.email));row.append(avatar,copy,node('span',user.role==='owner'?'Owner':user.verified?'Editor':'Invited','settings-member-role'));return row;
  }));
  const tools=$('[data-member-tools]');tools.replaceChildren();
  if(session.workspace.role==='owner') {
    tools.append(node('h3','Workspace members'));
    for(const user of members.filter(m=>m.role!=='owner')) tools.append(managementRow(user.name,textButton('Remove',async()=>{
      if(!confirm(`Remove ${user.name} from this workspace?`))return;
      await api('/api/account/members/'+user.id,'DELETE');await renderMembers();
    })));
    const form=node('form'),email=node('input'),invite=node('button','Invite','settings-text-button');email.type='email';email.required=true;email.placeholder='Email address';email.setAttribute('aria-label','Invite email address');invite.type='submit';form.append(email,invite);
    form.addEventListener('submit',e=>{e.preventDefault();act(invite,async()=>{await api('/api/account/members','POST',{email:email.value});await renderMembers();tell('Member invited. They can sign in at the Dialogue address.',false);});});tools.append(form);
  }
  const copies=(await api('/api/account/editing')).workingCopies,working=$('[data-working-copies]');working.replaceChildren(node('h3','Working copies'));
  if(!copies.length)working.append(node('p','No working copies are reserved.'));
  for(const copy of copies)working.append(managementRow(`${copy.id}${copy.editorName?' · '+copy.editorName:''}`,textButton('Release',async()=>{
    if(!confirm('Release this working copy for another editor? Unfinished changes are kept.'))return;
    await api('/api/account/editing/release','POST',{id:copy.id});await renderMembers();
  })));
}
async function renderPasskeys() {
  const keys=(await api('/api/account/passkeys')).passkeys;
  $('[data-passkey-count]').textContent=keys.length?`${keys.length} passkey${keys.length===1?'':'s'} registered`:'No passkeys registered';
  $('[data-key-manager]').hidden=!keys.length;
  $('[data-passkey-list]').replaceChildren(...keys.map(key=>managementRow(key.name,textButton('Remove',async()=>{
    if(!confirm('Remove this passkey? You can still sign in using an email code.'))return;
    await api('/api/account/passkeys/'+key.id,'DELETE');await renderPasskeys();
  }))));
}
async function avatarUpload(file) {
  if(!file)return;
  if(file.size>8*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPEG or WebP image up to 8 MB.');
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width>8192 || bitmap.height>8192)throw Error('Choose an image no larger than 8192 pixels on either side.');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const side=Math.min(bitmap.width,bitmap.height);canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);
    const png=canvas.toDataURL('image/png').split(',')[1],result=await api('/api/account/avatar','PUT',{png});
    session.user.avatarUrl=result.avatarUrl;window.DialogueAccount.updateProfile(session.user);renderAvatar();await renderMembers();$('[data-profile-save]').textContent='Saved';
  } finally {bitmap.close();}
}
function bindProfile() {
  const name=$('#account-name');name.value=session.user.name;$('#account-email').value=session.user.email;renderAvatar();
  let timer,queued=Promise.resolve(),saved=session.user.name;
  const save=()=>{clearTimeout(timer);queued=queued.catch(()=>{}).then(async()=>{
    const value=name.value.trim();if(value===saved){$('#name-feedback').textContent='';$('[data-profile-save]').textContent='Saved';return;}
    if(!value){$('#name-feedback').textContent='Enter your display name.';return;}
    $('#name-feedback').textContent='';$('[data-profile-save]').textContent='Saving…';
    try {await api('/api/account/profile','PATCH',{name:value});saved=value;session.user.name=value;window.DialogueAccount.updateProfile(session.user);await renderMembers();$('[data-profile-save]').textContent='Saved';}
    catch(e){$('[data-profile-save]').textContent='Not saved';$('#name-feedback').textContent=e.message;}
  });};
  name.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(save,600);});name.addEventListener('blur',save);name.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save();}});
  $('[data-add-passkey]').addEventListener('click',e=>act(e.currentTarget,async()=>{await window.DialogueAccount.passkey(true);await renderPasskeys();tell('Passkey added.',false);}));
  const input=$('#avatar-file'),target=$('[data-avatar-upload]');
  const withAvatarLock=async task=>{target.disabled=$('[data-avatar-remove]').disabled=true;try{return await task();}finally{target.disabled=$('[data-avatar-remove]').disabled=false;}};
  const upload=file=>act(target,()=>withAvatarLock(async()=>{$('[data-profile-save]').textContent='Saving…';try{await avatarUpload(file);}catch(e){$('[data-profile-save]').textContent='Not saved';throw e;}}));
  target.addEventListener('click',()=>input.click());input.addEventListener('change',()=>{upload(input.files[0]);input.value='';});
  for(const event of ['dragenter','dragover'])target.addEventListener(event,e=>{e.preventDefault();target.classList.add('is-dragging');});
  target.addEventListener('dragleave',()=>target.classList.remove('is-dragging'));target.addEventListener('drop',e=>{e.preventDefault();target.classList.remove('is-dragging');upload(e.dataTransfer.files[0]);});
  $('[data-avatar-remove]').addEventListener('click',e=>act(e.currentTarget,()=>withAvatarLock(async()=>{await api('/api/account/avatar','DELETE');session.user.avatarUrl=null;window.DialogueAccount.updateProfile(session.user);renderAvatar();await renderMembers();$('[data-profile-save]').textContent='Saved';})));
}
function connectionMessage(message) {$('[data-connection-status]').textContent=message;}
function providerRow(provider,icon) {
  const active=!providerState.disconnected && provider.authenticated && provider.id===providerState.model?.split('/')[0] && !['not-connected','rejected'].includes(providerState.status?.reason);
  const row=node('div','','settings-row-card settings-provider'+(active?' is-connected':''));row.dataset.provider=provider.id;
  if(icon){const img=node('img','','settings-provider-icon');img.src=`assets/settings-v2/${icon}.svg`;img.alt='';row.append(img);}else row.append(node('span',initials(provider.name),'settings-provider-fallback'));
  row.append(node('span',provider.name,'settings-provider-name'));
  if(active) {
    const dot=node('img','','settings-connected-dot');dot.src='assets/settings-v2/connected-dot.svg';dot.alt='Connected';row.append(dot);
    const select=node('select','','settings-model');select.setAttribute('aria-label',`${provider.name} model`);select.id='agent-model';
    const choices=models.filter(m=>m.provider===provider.id);if(!choices.some(m=>m.id===providerState.model))choices.unshift({id:providerState.model,name:providerState.model.split('/').slice(1).join('/')});
    for(const model of choices){const option=node('option',model.name);option.value=model.id;select.append(option);}select.value=providerState.model;
    const measure=document.createElement('canvas').getContext('2d');measure.font='12px "Inter Tight"';select.style.width=Math.min(210,Math.max(96,Math.ceil(measure.measureText(select.selectedOptions[0]?.textContent || '').width+48)))+'px';
    select.addEventListener('change',()=>{select.disabled=true;connectionMessage('Switching model…');api('/api/agent/model','PUT',{model:select.value}).then(refreshConnection).catch(e=>{select.value=providerState.model;connectionMessage(e.message);}).finally(()=>select.disabled=false);});const modelControl=node('span','','settings-model-control'),arrow=node('img');arrow.src='assets/settings-v2/model-chevron.svg';arrow.alt='';modelControl.append(select,arrow);row.append(modelControl);
    const disconnect=textButton('Disconnect',async()=>{connectionMessage('Disconnecting…');try{await api('/api/agent/connection','DELETE');await refreshConnection();}catch(e){connectionMessage(e.message);}});disconnect.classList.add('disconnect-action');row.append(disconnect);
  } else {
    const connect=textButton('Connect',async()=>window.DialogueAgent.show({provider,onClose:()=>refreshConnection()}));connect.classList.add('connect-action');connect.disabled=provider.available===false;row.append(connect);
  }
  return row;
}
async function refreshConnection() {
  const sequence=++refreshSequence;
  try {
    const [state,data,catalog]=await Promise.all([api('/api/agent'),api('/api/agent/providers'),api('/api/agent/models')]);
    if(sequence!==refreshSequence)return;
    providerState=state;providers=data.providers;models=catalog.models;
    const lookup=new Map(providers.map(p=>[p.id,p]));
    const rows=popular.map(([id,name,icon])=>providerRow({...lookup.get(id),id,name,available:lookup.has(id)},icon));
    const extra=providers.filter(p=>!popular.some(([id])=>id===p.id));const connected=extra.find(p=>!state.disconnected && p.authenticated && p.id===state.model?.split('/')[0] && !['not-connected','rejected'].includes(state.status?.reason));if(connected)rows.push(providerRow(connected));
    $('[data-settings-providers]').replaceChildren(...rows);$('[data-other-provider-list]').replaceChildren(...extra.filter(p=>p!==connected).map(p=>providerRow(p)));
    $('[data-other-services]').hidden=false;
    connectionMessage(state.status && !state.status.ready && !['not-connected'].includes(state.status.reason)?(state.status.detail || 'The model connection needs attention.'):'');
    $('[data-connection-detail]').textContent=state.disconnected?'No service connected.':state.status?.detail || 'Select a service to connect.';
    if(location.hash==='#agent-model'){const target=$('#agent-model') || $('[data-settings-providers] .connect-action:not(:disabled)');target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true});}
  } catch(e){if(sequence===refreshSequence)connectionMessage(e.message);}
}
async function init() {
  if(document.readyState==='loading')await new Promise(r=>document.addEventListener('DOMContentLoaded',r,{once:true}));
  session=await window.DialogueAccountReady;if(!session?.user)return;api=window.DialogueAccount.api;
  bindProfile();providerState={disconnected:true,model:null};$('[data-settings-providers]').replaceChildren(...popular.map(([id,name,icon])=>providerRow({id,name,available:false},icon)));await Promise.all([renderPasskeys(),renderMembers(),refreshConnection()]);
  $('[data-check-connection]').addEventListener('click',e=>act(e.currentTarget,async()=>{await api('/api/agent/check','POST');await refreshConnection();}));
  const menu=$('[data-profile-menu]'),profile=$('[data-profile-button]');const close=()=>{menu.hidden=true;profile.setAttribute('aria-expanded','false');};
  profile.addEventListener('click',()=>{menu.hidden=!menu.hidden;profile.setAttribute('aria-expanded',String(!menu.hidden));});
  document.addEventListener('click',e=>{if(!menu.contains(e.target)&&!profile.contains(e.target))close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();for(const detail of document.querySelectorAll('.settings-manage[open]'))detail.open=false;}});
  $('[data-sign-out]').addEventListener('click',e=>act(e.currentTarget,async()=>{await api('/api/auth/logout','POST');location.assign('/');}));
  if(session.development){const host=$('[data-local-accounts]');host.append(node('h3','Local development'));for(const user of session.developmentAccounts.filter(u=>u.email!==session.user.email))host.append(textButton(`Switch to ${user.name}`,async()=>{await api('/api/auth/development-session','POST',{email:user.email});location.reload();}));}
  const links=[...document.querySelectorAll('.settings-subnav a')],sections=[...document.querySelectorAll('.settings-section')];
  const update=()=>{let selected=sections[0];for(const section of sections)if(section.getBoundingClientRect().top<=160)selected=section;for(const link of links){const active=link.hash==='#'+selected.id;link.classList.toggle('is-active',active);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}};
  window.addEventListener('scroll',update,{passive:true});update();
}
init().catch(e=>tell(e.message));
