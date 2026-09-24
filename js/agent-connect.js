// "Connect an AI model": the sign-in flow shared by the Settings page (inline,
// with the model picker) and any page that must stop until the agent is
// ready (a banner that opens the flow in a modal). No terminal involved:
// the provider's page opens in a new tab and whatever the designer lands
// on is pasted back here.
//
// window.DialogueAgent = { status, flow, show, close, banner, settings }
(() => {
  const POPULAR = ['openai-codex', 'anthropic', 'openrouter', 'github-copilot', 'google-gemini-cli'];
  const REASONS = {
    'not-connected': 'Not connected yet.',
    rejected: 'The sign-in was not accepted. Sign in again.',
    quota: 'The account is out of credit or over its limit.',
    unreachable: 'The service could not be reached. Check the internet connection and try again.',
    unknown: 'Something is off with the connection.'
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const api = async (method, route, body) => {
    const response = await fetch(route, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  };

  const status = () => api('GET', '/api/agent');

  const describe = (state) => {
    if (!state) return { text: 'Checking the connection…', tone: 'pending' };
    if (state.ready) return { text: `Connected. ${state.model} is ready to work.`, tone: 'ok' };
    return { text: REASONS[state.reason] || REASONS.unknown, tone: 'error', detail: state.detail };
  };

  // The sign-in flow inside `host`. options: { onReady(status), onStatus(status) }
  const flow = (host, options = {}) => {
    host.classList.add('agent-flow');
    const statusLine = el('p', 'agent-status', 'Checking the connection…');
    const statusDetail = el('details', 'setup-details');
    statusDetail.hidden = true;
    statusDetail.append(el('summary', '', 'Technical details'), el('pre'));
    const intro = el('p', 'agent-intro', 'Dialogue needs an AI model to work on your prototypes. Sign in with one of these services — the account and its costs stay yours.');
    const providerList = el('div', 'agent-providers');
    const more = el('details', 'agent-more');
    more.append(el('summary', '', 'More services'));
    const moreList = el('div', 'agent-providers');
    more.append(moreList);
    more.hidden = true;

    const signin = el('section', 'agent-signin');
    signin.hidden = true;
    const signinTitle = el('h3', '', 'Sign in');
    const steps = el('ol', 'setup-steps');
    const stepOpen = el('li');
    stepOpen.append(el('span', 'setup-step-title', 'Open the sign-in page'));
    const openText = el('span', 'setup-step-text', 'A new tab opens on the service\u2019s website. Sign in there with your own account.');
    const openLink = el('a', 'pill setup-open-link', 'Open the sign-in page');
    openLink.target = '_blank';
    openLink.rel = 'noopener';
    openLink.href = '#';
    stepOpen.append(openText, openLink);
    const stepPaste = el('li');
    stepPaste.append(el('span', 'setup-step-title', 'Paste the address you land on'));
    stepPaste.append(el('span', 'setup-step-text', 'When the website is done it sends you to a page that may not open (its address starts with "localhost"). Copy the whole address from the browser\u2019s address bar and paste it here. A code shown on the page works too.'));
    const pasteRow = el('div', 'agent-paste-row');
    const pasteField = el('input', 'form-field');
    pasteField.placeholder = 'http://localhost:…/callback?code=…';
    pasteField.autocomplete = 'off';
    pasteField.spellcheck = false;
    const pasteButton = el('button', 'pill', 'Continue');
    pasteButton.type = 'button';
    pasteRow.append(pasteField, pasteButton);
    stepPaste.append(pasteRow);
    steps.append(stepOpen, stepPaste);
    const progress = el('p', 'agent-progress');
    progress.hidden = true;
    const error = el('p', 'setup-error');
    error.hidden = true;
    const actions = el('div', 'agent-actions');
    const cancel = el('button', 'pill outline', 'Cancel');
    cancel.type = 'button';
    actions.append(cancel);
    signin.append(signinTitle, steps, progress, error, actions);

    host.replaceChildren(statusLine, statusDetail, intro, providerList, more, signin);

    let current = null;
    let session = null;
    let stream = null;
    let pendingInput = false;
    let queued = null;
    let pollTimer = null;

    const showStatus = (state) => {
      current = state;
      const { text, tone, detail } = describe(state);
      statusLine.textContent = text;
      statusLine.dataset.tone = tone;
      statusDetail.hidden = !detail;
      statusDetail.querySelector('pre').textContent = detail || '';
      intro.hidden = Boolean(state?.ready);
      options.onStatus?.(state);
    };

    const refreshStatus = async () => {
      const payload = await status();
      showStatus(payload.status);
      clearTimeout(pollTimer);
      if (!payload.status) pollTimer = setTimeout(refreshStatus, 2000);
      return payload;
    };

    const setProgress = (message) => {
      progress.textContent = message || '';
      progress.hidden = !message;
    };
    const setError = (message) => {
      error.textContent = message || '';
      error.hidden = !message;
    };

    const stopStream = () => {
      stream?.close();
      stream = null;
      pendingInput = false;
      queued = null;
    };

    const finish = () => {
      stopStream();
      session = null;
      signin.hidden = true;
    };

    const submitPaste = async () => {
      const value = pasteField.value.trim();
      if (!value || !session) return;
      if (!pendingInput) {
        queued = value;
        setProgress('Hold on, the service is not ready for the code yet…');
        return;
      }
      pendingInput = false;
      pasteButton.disabled = true;
      try {
        await api('POST', `/api/agent/login/${session}/input`, { value });
        pasteField.value = '';
        setProgress('Checking the code…');
      } catch (failure) {
        pendingInput = true;
        setError(failure.message);
      } finally {
        pasteButton.disabled = false;
      }
    };

    const listen = (id) => {
      stream = new EventSource(`/api/agent/login/${id}/events`);
      stream.addEventListener('open_url', (event) => {
        const data = JSON.parse(event.data);
        openLink.href = data.url;
        openText.textContent = data.instructions || 'A new tab opens on the service\u2019s website. Sign in there with your own account.';
        window.open(data.url, '_blank', 'noopener');
      });
      stream.addEventListener('progress', (event) => setProgress(JSON.parse(event.data).message));
      stream.addEventListener('input', (event) => {
        const data = JSON.parse(event.data);
        if (data.placeholder) pasteField.placeholder = data.placeholder;
        pendingInput = true;
        if (queued) {
          pasteField.value = queued;
          queued = null;
          submitPaste();
        }
      });
      stream.addEventListener('done', async (event) => {
        const data = JSON.parse(event.data);
        finish();
        showStatus(data.status);
        await loadProviders().catch(() => {});
        if (data.status?.ready) options.onReady?.(data.status);
        else setError(describe(data.status).text);
      });
      stream.addEventListener('error', (event) => {
        if (!event.data) return; // connection hiccup; EventSource retries
        const data = JSON.parse(event.data);
        stopStream();
        setProgress('');
        setError(data.message);
      });
    };

    const startLogin = async (provider) => {
      finish();
      setError('');
      setProgress('Starting the sign-in…');
      signinTitle.textContent = `Sign in to ${provider.name}`;
      openLink.href = '#';
      pasteField.value = '';
      signin.hidden = false;
      signin.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      try {
        const created = await api('POST', '/api/agent/login', { providerId: provider.id });
        session = created.id;
        listen(session);
      } catch (failure) {
        setProgress('');
        setError(failure.message);
      }
    };

    const providerRow = (provider) => {
      const row = el('div', 'agent-provider');
      row.append(el('span', 'agent-provider-name', provider.name));
      if (provider.authenticated) row.append(el('span', 'agent-provider-state', 'Signed in'));
      const button = el('button', provider.authenticated ? 'pill outline' : 'pill', provider.authenticated ? 'Sign in again' : 'Sign in');
      button.type = 'button';
      button.addEventListener('click', () => startLogin(provider));
      row.append(button);
      return row;
    };

    const loadProviders = async () => {
      const { providers } = await api('GET', '/api/agent/providers');
      const byId = new Map(providers.map((provider) => [provider.id, provider]));
      const popular = POPULAR.map((id) => byId.get(id)).filter(Boolean);
      const rest = providers.filter((provider) => !POPULAR.includes(provider.id));
      providerList.replaceChildren(...popular.map(providerRow));
      moreList.replaceChildren(...rest.map(providerRow));
      more.hidden = rest.length === 0;
    };

    pasteButton.addEventListener('click', submitPaste);
    pasteField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitPaste();
      }
    });
    cancel.addEventListener('click', async () => {
      const id = session;
      finish();
      setProgress('');
      if (id) await api('DELETE', `/api/agent/login/${id}`).catch(() => {});
    });

    providerList.textContent = 'Loading services…';
    refreshStatus().catch((failure) => showStatus({ ready: false, reason: 'unknown', detail: failure.message }));
    loadProviders().catch((failure) => {
      providerList.replaceChildren(el('p', 'setup-error', `Could not list the services: ${failure.message}`));
    });

    return {
      refresh: refreshStatus,
      check: async () => {
        showStatus(null);
        const payload = await api('POST', '/api/agent/check');
        showStatus(payload.status);
        if (payload.status?.ready) options.onReady?.(payload.status);
        return payload;
      },
      current: () => current,
      destroy: () => {
        finish();
        clearTimeout(pollTimer);
      }
    };
  };

  // --- modal ------------------------------------------------------------------------
  let layer = null;
  let modalFlow = null;

  const close = () => {
    if (!layer || layer.hidden) return;
    layer.classList.remove('is-open');
    window.setTimeout(() => { layer.hidden = true; }, 160);
  };

  // options: { intro, onReady }
  const show = (options = {}) => {
    if (!layer) {
      layer = el('div', 'share-modal-layer setup-modal-layer');
      layer.hidden = true;
      const modal = el('section', 'share-modal setup-modal agent-modal');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const closeButton = el('button', 'share-modal-close', '×');
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'Close');
      closeButton.addEventListener('click', close);
      modal.append(closeButton, el('h2', '', 'Connect an AI model'), el('div', 'agent-modal-body'));
      layer.append(modal);
      layer.addEventListener('click', (event) => {
        if (event.target === layer) close();
      });
      document.body.appendChild(layer);
    }
    modalFlow?.destroy();
    modalFlow = flow(layer.querySelector('.agent-modal-body'), {
      onReady: (state) => {
        close();
        options.onReady?.(state);
      }
    });
    layer.hidden = false;
    requestAnimationFrame(() => layer.classList.add('is-open'));
  };

  // "Connect an AI model to continue" notice; hidden once the agent is ready.
  const banner = (host, options = {}) => {
    host.classList.add('agent-banner');
    host.hidden = true;
    const text = el('span', 'agent-banner-text');
    const button = el('button', 'pill', 'Connect');
    button.type = 'button';
    button.addEventListener('click', () => show({ onReady: (state) => { render(state); options.onReady?.(state); } }));
    host.replaceChildren(text, button);
    const render = (state) => {
      if (!state) {
        host.hidden = true;
        return;
      }
      host.hidden = Boolean(state.ready);
      text.textContent = state.ready ? '' : `Connect an AI model to continue. ${describe(state).text}`;
    };
    const poll = async () => {
      try {
        const payload = await status();
        render(payload.status);
        if (!payload.status) setTimeout(poll, 2000);
      } catch {
        host.hidden = true;
      }
    };
    poll();
    return { refresh: poll };
  };

  // Settings section: status, sign-in flow, model picker, "Check again".
  const settings = (host) => {
    const flowHost = el('div');
    const tools = el('div', 'agent-tools');
    const modelLabel = el('label', 'agent-model-label', 'Model the agent uses');
    const modelSelect = el('select', 'form-field agent-model');
    modelSelect.id = 'agent-model';
    modelLabel.htmlFor = modelSelect.id;
    const modelNote = el('p', 'agent-model-note');
    const check = el('button', 'pill outline', 'Check again');
    check.type = 'button';
    tools.append(modelLabel, modelSelect, modelNote, check);
    host.replaceChildren(flowHost, tools);

    let selected = null;
    const fillModels = async () => {
      const [{ model, defaultModel }, { models }] = await Promise.all([status(), api('GET', '/api/agent/models')]);
      selected = model;
      const byProvider = new Map();
      for (const entry of models) {
        if (!byProvider.has(entry.provider)) byProvider.set(entry.provider, []);
        byProvider.get(entry.provider).push(entry);
      }
      modelSelect.replaceChildren();
      if (model && !models.some((entry) => entry.id === model)) {
        const option = new Option(`${model} (not available yet)`, model, true, true);
        modelSelect.append(option);
      }
      for (const [provider, entries] of byProvider) {
        const group = document.createElement('optgroup');
        group.label = provider;
        for (const entry of entries) group.append(new Option(entry.name === entry.id.slice(provider.length + 1) ? entry.id : `${entry.name} (${entry.id})`, entry.id, false, entry.id === model));
        modelSelect.append(group);
      }
      modelSelect.disabled = modelSelect.options.length === 0;
      modelNote.textContent = model === defaultModel ? 'This is Dialogue\u2019s default choice.' : `Dialogue\u2019s default is ${defaultModel}.`;
    };

    const panel = flow(flowHost, { onReady: () => fillModels().catch(() => {}) });
    modelSelect.addEventListener('change', async () => {
      const model = modelSelect.value;
      if (!model || model === selected) return;
      modelSelect.disabled = true;
      modelNote.textContent = `Switching to ${model} and checking it…`;
      try {
        const payload = await api('PUT', '/api/agent/model', { model });
        selected = payload.model;
        panel.refresh();
        await fillModels();
      } catch (failure) {
        modelNote.textContent = failure.message;
      } finally {
        modelSelect.disabled = false;
      }
    });
    check.addEventListener('click', async () => {
      check.disabled = true;
      try {
        await panel.check();
      } finally {
        check.disabled = false;
      }
    });
    fillModels().catch((failure) => { modelNote.textContent = `Could not list models: ${failure.message}`; });
    return panel;
  };

  window.DialogueAgent = { status, flow, show, close, banner, settings };

  const settingsHost = document.querySelector('[data-agent-settings]');
  if (settingsHost) settings(settingsHost);
  const bannerHost = document.querySelector('[data-agent-banner]');
  if (bannerHost) banner(bannerHost);
})();
