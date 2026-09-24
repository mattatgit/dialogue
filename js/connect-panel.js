// "Connect Dialogue to your repository": the deploy-key setup panel shared by
// the project page (private repository, read access) and the workspace page
// (first commit, write access). Builds its DOM once on first use.
(() => {
  let layer = null;
  let nodes = null;
  let onRetry = null;
  let copyResetTimer = null;

  const instructionsFor = (setup) => {
    const write = `tick "${setup.writeOption}"`;
    if (setup.kind === 'github') return `On the page that opens, type "Dialogue" as the title, paste the key into the big "Key" box, ${write}, then click "${setup.addButton}".`;
    if (setup.kind === 'gitlab') return `On the page that opens, expand "Deploy keys", click "Add new key", paste the key, type "Dialogue" as the title, ${write}, then click "${setup.addButton}".`;
    if (setup.kind === 'gitea') return `On the page that opens, click "${setup.addButton}", paste the key, type "Dialogue" as the title, ${write}, then click the add button.`;
    return `Open your repository's settings, find "Deploy keys" (sometimes "Access keys"), add the key with the title "Dialogue" and make sure it has ${setup.writeOption}.`;
  };

  const build = () => {
    layer = document.createElement('div');
    layer.className = 'share-modal-layer setup-modal-layer';
    layer.hidden = true;
    layer.innerHTML = `
      <section class="share-modal setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-modal-title">
        <button class="share-modal-close" type="button" aria-label="Close" data-setup-close>×</button>
        <h2 id="setup-modal-title">Connect Dialogue to your repository</h2>
        <p class="setup-intro" data-setup-intro></p>
        <ol class="setup-steps">
          <li>
            <span class="setup-step-title">Copy Dialogue's key</span>
            <div class="setup-key-row">
              <code class="setup-key" data-setup-key></code>
              <button class="share-copy-button" type="button" data-setup-copy>Copy</button>
            </div>
          </li>
          <li>
            <span class="setup-step-title">Add it to <span data-setup-host>the repository</span></span>
            <span class="setup-step-text" data-setup-instructions></span>
            <a class="pill outline setup-open-link" href="#" target="_blank" rel="noopener" data-setup-link>Open the key settings page</a>
          </li>
          <li>
            <span class="setup-step-title">Come back here</span>
            <span class="setup-step-text" data-setup-after></span>
          </li>
        </ol>
        <p class="setup-error" data-setup-error hidden></p>
        <details class="setup-details" data-setup-details hidden><summary>Technical details</summary><pre data-setup-detail-text></pre></details>
        <div class="setup-actions">
          <button class="pill" type="button" data-setup-retry>I've added the key — continue</button>
        </div>
      </section>`;
    document.body.appendChild(layer);
    const q = (sel) => layer.querySelector(sel);
    nodes = {
      intro: q('[data-setup-intro]'), key: q('[data-setup-key]'), copy: q('[data-setup-copy]'), host: q('[data-setup-host]'),
      instructions: q('[data-setup-instructions]'), link: q('[data-setup-link]'), after: q('[data-setup-after]'),
      error: q('[data-setup-error]'), details: q('[data-setup-details]'), detailText: q('[data-setup-detail-text]'),
      retry: q('[data-setup-retry]'), close: q('[data-setup-close]')
    };

    nodes.copy.addEventListener('click', async () => {
      const key = nodes.key.textContent || '';
      try {
        await navigator.clipboard.writeText(key);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(nodes.key);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('copy');
      }
      nodes.copy.textContent = 'Copied!';
      clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => { nodes.copy.textContent = 'Copy'; }, 3000);
    });
    nodes.close.addEventListener('click', close);
    layer.addEventListener('click', (event) => {
      if (event.target === layer) close();
    });
    nodes.retry.addEventListener('click', () => onRetry?.());
  };

  const close = () => {
    if (!layer || layer.hidden) return;
    layer.classList.remove('is-open');
    window.setTimeout(() => { layer.hidden = true; }, 160);
  };

  // options: { intro, after, failedBefore, onRetry }
  const show = (setup, options = {}) => {
    if (!layer) build();
    onRetry = options.onRetry || null;
    const repoLabel = setup.repository || 'this repository';
    nodes.intro.replaceChildren();
    if (options.intro) nodes.intro.append(options.intro);
    else nodes.intro.append('Dialogue needs permission to save changes to ', Object.assign(document.createElement('strong'), { textContent: repoLabel }), '. This is a one-time step and takes about a minute.');
    nodes.key.textContent = setup.publicKey || '';
    nodes.host.textContent = setup.name || 'the repository';
    nodes.instructions.textContent = instructionsFor(setup);
    nodes.link.href = setup.settingsUrl || '#';
    nodes.after.textContent = options.after || 'Once the key is added, press the button below. Dialogue checks the connection and commits your changes.';
    nodes.error.hidden = !options.failedBefore;
    nodes.error.textContent = options.failedBefore
      ? `${setup.name || 'The repository'} has not accepted the key yet. Check that the whole key was pasted and that "${setup.writeOption}" was ticked, then try again.`
      : '';
    nodes.details.hidden = !setup.detail;
    nodes.detailText.textContent = setup.detail || '';
    if (layer.hidden) {
      layer.hidden = false;
      requestAnimationFrame(() => layer.classList.add('is-open'));
    }
    (options.failedBefore ? nodes.retry : nodes.copy).focus();
  };

  const busy = (flag) => {
    if (nodes) nodes.retry.disabled = Boolean(flag);
  };

  window.DialogueConnect = { show, close, busy };
})();
