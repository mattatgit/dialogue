(() => {
  const nativeFetch = window.fetch.bind(window);
  const signInPage = Boolean(document.querySelector('[data-email-signin]'));
  const next = () => {
    const requested = new URLSearchParams(location.search).get('next');
    try { const url = new URL(requested || '/projects.html', location.origin); if (url.origin === location.origin && url.pathname.endsWith('.html') && url.pathname !== '/index.html') return url.pathname + url.search; } catch {}
    return '/projects.html';
  };
  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (!['GET', 'HEAD'].includes(method)) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        init = { ...init, headers };
        if (!(input instanceof Request) && init.body === undefined && method !== 'DELETE') init.body = '{}';
      }
    }
    const response = await nativeFetch(input, init);
    if (response.status === 401 && !signInPage && url.origin === location.origin && url.pathname.startsWith('/api/')) location.assign(`/?next=${encodeURIComponent(location.pathname + location.search)}`);
    if (response.status === 428 && !signInPage && url.origin === location.origin && url.pathname.startsWith('/api/')) location.assign(`/?reauth=1&next=${encodeURIComponent(location.pathname + location.search)}`);
    return response;
  };
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(route, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The account action could not be completed.');
    return data;
  };
  const status = document.querySelector('[data-account-status]');
  const tell = (message, error = false) => { if (status) { status.textContent = message; status.classList.toggle('is-error', error); } };
  const action = async (button, task) => {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    tell('');
    try { await task(); } catch (error) { tell(error.name === 'NotAllowedError' ? 'The passkey request was cancelled or timed out. You can try again or use an email code.' : error.message, true); }
    finally { if (button) button.disabled = false; }
  };
  const button = (label, run, secondary = false) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
    if (secondary) node.className = 'secondary'; node.addEventListener('click', () => action(node, run)); return node;
  };
  const bytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const b64 = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const credentialJSON = credential => {
    const r = credential.response;
    return { id: credential.id, rawId: b64(credential.rawId), type: credential.type, authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(), response: { clientDataJSON: b64(r.clientDataJSON),
        ...(r.attestationObject ? { attestationObject: b64(r.attestationObject), transports: r.getTransports?.() || [] } : { authenticatorData: b64(r.authenticatorData), signature: b64(r.signature), userHandle: r.userHandle ? b64(r.userHandle) : null }) } };
  };
  const passkey = async (register = false) => {
    if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('Passkeys are not available in this browser. Use an email code to sign in.');
    const { options, challengeId } = await api(register ? '/api/account/passkeys/options' : '/api/auth/passkey/options', 'POST');
    const publicKey = { ...options, challenge: bytes(options.challenge) };
    if (register) { publicKey.user = { ...options.user, id: bytes(options.user.id) }; publicKey.excludeCredentials = (options.excludeCredentials || []).map(c => ({ ...c, id: bytes(c.id) })); }
    else publicKey.allowCredentials = (options.allowCredentials || []).map(c => ({ ...c, id: bytes(c.id) }));
    const result = await navigator.credentials[register ? 'create' : 'get']({ publicKey });
    await api(register ? '/api/account/passkeys' : '/api/auth/passkey/verify', 'POST', { challengeId, credential: credentialJSON(result), name: 'My passkey' });
  };
  let challengeId;
  document.querySelector('[data-passkey-signin]')?.addEventListener('click', event => action(event.currentTarget, async () => { await passkey(); location.assign(next()); }));
  document.querySelector('[data-email-signin]')?.addEventListener('submit', event => {
    event.preventDefault(); action(event.submitter, async () => {
      const result = await api('/api/auth/email/start', 'POST', { email: document.querySelector('#signin-email').value }); challengeId = result.challengeId;
      event.target.hidden = true; document.querySelector('[data-code-signin]').hidden = false;
      document.querySelector('[data-code-message]').textContent = result.message; document.querySelector('#signin-code').focus();
    });
  });
  document.querySelector('[data-code-signin]')?.addEventListener('submit', event => {
    event.preventDefault(); action(event.submitter, async () => { await api('/api/auth/email/verify', 'POST', { challengeId, code: document.querySelector('#signin-code').value }); location.assign(next()); });
  });
  document.querySelector('[data-email-back]')?.addEventListener('click', () => { document.querySelector('[data-code-signin]').hidden = true; document.querySelector('[data-email-signin]').hidden = false; tell(''); });

  const renderSettings = async session => {
    const host = document.querySelector('[data-account-settings]'); if (!host) return;
    host.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = 'Your account';
    const email = document.createElement('p'); email.className = 'account-profile-email'; email.textContent = session.user.email;
    const workspace = document.createElement('p'); workspace.className = 'account-workspace-name'; workspace.textContent = `${session.workspace.name} · ${session.workspace.role === 'owner' ? 'Owner' : 'Editor'}`;
    const form = document.createElement('form'); const label = document.createElement('label'); label.htmlFor = 'account-name'; label.textContent = 'Your name';
    const name = document.createElement('input'); name.id = 'account-name'; name.value = session.user.name; name.required = true; name.maxLength = 80; name.autocomplete = 'name';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save name';
    form.append(label, name, save); form.addEventListener('submit', event => { event.preventDefault(); action(save, async () => { await api('/api/account/profile', 'PATCH', { name: name.value }); location.reload(); }); });
    const actions = document.createElement('div'); actions.className = 'account-actions';
    actions.append(button('Add a passkey', async () => { await passkey(true); await renderSettings(session); tell('Passkey added.'); }), button('Sign out', async () => { await api('/api/auth/logout', 'POST'); location.assign('/'); }, true));
    const keys = await api('/api/account/passkeys'); const list = document.createElement('ul'); list.className = 'account-list';
    for (const key of keys.passkeys) { const row = document.createElement('li'); const text = document.createElement('span'); text.textContent = key.name; row.append(text, button('Remove passkey', async () => { if (!confirm('Remove this passkey? You can still sign in using an email code.')) return; await api(`/api/account/passkeys/${key.id}`, 'DELETE'); await renderSettings(session); }, true)); list.append(row); }
    host.append(heading, email, workspace, form, actions, list);
    const membersHeading = document.createElement('h3'); membersHeading.textContent = 'Workspace members'; host.append(membersHeading);
    const members = await api('/api/account/members'); const memberList = document.createElement('ul'); memberList.className = 'account-list';
    for (const member of members.members) {
      const row = document.createElement('li'); const text = document.createElement('span'); text.textContent = member.name;
      const detail = document.createElement('span'); detail.className = 'account-hint'; detail.textContent = `${member.email} · ${member.role === 'owner' ? 'Owner' : member.verified ? 'Editor' : 'Invited'}`; text.append(detail); row.append(text);
      if (session.workspace.role === 'owner' && member.role !== 'owner') row.append(button('Remove member', async () => { if (!confirm(`Remove ${member.name} from this workspace?`)) return; await api(`/api/account/members/${member.id}`, 'DELETE'); await renderSettings(session); }, true));
      memberList.append(row);
    }
    host.append(memberList);
    if (session.workspace.role === 'owner') {
      const invite = document.createElement('form'); const input = document.createElement('input'); input.type = 'email'; input.required = true; input.placeholder = 'Email address'; input.setAttribute('aria-label', 'Invite email address');
      const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Invite member'; invite.append(input, submit);
      invite.addEventListener('submit', event => { event.preventDefault(); action(submit, async () => { await api('/api/account/members', 'POST', { email: input.value }); await renderSettings(session); tell('Member invited. Share the Dialogue address with them; they can request their own sign-in code.'); }); }); host.append(invite);
    }
    const editing = await api('/api/account/editing');
    if (editing.workingCopies.length) { const title = document.createElement('h3'); title.textContent = 'Working copies'; host.append(title); for (const copy of editing.workingCopies) { const row = document.createElement('div'); row.className = 'account-actions'; const text = document.createElement('span'); text.textContent = copy.editorName ? `${copy.id} · ${copy.editorName}` : copy.id; row.append(text, button('Release for another editor', async () => { if (!confirm('Close this working copy’s terminal and release it for another editor? Unfinished file changes are kept.')) return; await api('/api/account/editing/release', 'POST', { id: copy.id }); await renderSettings(session); }, true)); host.append(row); } }
    if (session.development) {
      const title = document.createElement('h3'); title.textContent = 'Local development';
      const choices = document.createElement('div'); choices.className = 'account-actions';
      for (const person of session.developmentAccounts.filter(p => p.email !== session.user.email)) choices.append(button(`Switch to ${person.name}`, async () => { await api('/api/auth/development-session', 'POST', { email: person.email }); location.reload(); }, true));
      host.append(title, choices);
    }
  };
  api('/api/auth/session').then(async session => {
    if (signInPage) {
      if (session.user && new URLSearchParams(location.search).get('reauth') !== '1') { location.replace(next()); return; }
      if (session.user) document.querySelector('#signin-email').value = session.user.email;
      if (session.development) {
        const host = document.querySelector('[data-development-accounts]'); host.hidden = false;
        for (const person of session.developmentAccounts) host.querySelector('[data-development-buttons]').append(button(`Continue as ${person.name}`, async () => { await api('/api/auth/development-session', 'POST', { email: person.email }); location.assign(next()); }));
      }
      return;
    }
    if (!session.user) { location.replace(`/?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
    for (const profile of document.querySelectorAll('[data-account-profile]')) {
      profile.querySelector('.avatar').textContent = session.user.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
      profile.querySelector('strong').textContent = session.user.name;
      profile.querySelector('.profile-copy>span').textContent = session.workspace.name;
    }
    await renderSettings(session);
  }).catch(error => tell(error.message, true));
})();
