(() => {
  const openButton = document.querySelector('[data-create-open]');
  const layer = document.querySelector('[data-create-layer]');
  const closeButton = document.querySelector('[data-create-close]');
  const cancelButton = document.querySelector('[data-create-cancel]');
  const form = document.querySelector('[data-create-form]');
  const editor = document.querySelector('[data-create-prompt]');
  const promptValue = document.querySelector('[data-create-prompt-value]');
  const figmaInput = document.querySelector('[data-create-figma-input]');
  const figmaValue = document.querySelector('[data-create-figma-value]');
  const figmaChip = document.querySelector('[data-create-figma-chip]');
  const figmaLabel = document.querySelector('[data-create-figma-label]');
  const figmaRemove = document.querySelector('[data-create-figma-remove]');
  const submitButton = document.querySelector('[data-create-submit]');
  const status = document.querySelector('[data-create-status]');

  if (!openButton || !layer || !form || !editor || !submitButton) return;

  let attachedFigma = null;
  let lastFocus = null;
  const projectSlug = new URLSearchParams(window.location.search).get('slug');
  let pending = false;
  const setStatus = (message = '', error = false) => {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', error);
  };

  const placeCaret = (node, offset) => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(node, Math.max(0, Math.min(offset, node.nodeType === Node.TEXT_NODE ? node.data.length : node.childNodes.length)));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const placeCaretAtEnd = (node) => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const serializeInline = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node;
    if (element.tagName === 'BR') return '\n';
    const content = Array.from(element.childNodes).map(serializeInline).join('');
    if (element.dataset.mdLink) return `[${content}](${element.dataset.mdLink})`;
    if (element.dataset.mdOpen || element.dataset.mdClose) {
      return `${element.dataset.mdOpen || ''}${content}${element.dataset.mdClose || ''}`;
    }
    return content;
  };

  const serializeEditor = () => {
    const nodes = Array.from(editor.childNodes);
    if (!nodes.length) return '';
    return nodes.map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.data;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const element = node;
      if (element.tagName === 'BR') return '';
      const prefix = element.dataset.mdPrefix || '';
      return prefix + Array.from(element.childNodes).map(serializeInline).join('');
    }).join('\n').replace(/\u00a0/g, ' ');
  };

  const updatePromptState = () => {
    const markdown = serializeEditor();
    if (promptValue) promptValue.value = markdown;
    editor.dataset.empty = markdown.trim() ? 'false' : 'true';
    updateSubmitState();
    return markdown;
  };

  const appendInlineMarkdown = (parent, source) => {
    let rest = source;
    const patterns = [
      { kind: 'link', regex: /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/ },
      { kind: 'strong', regex: /\*\*([^*\n]+)\*\*/ },
      { kind: 'strongUnderscore', regex: /__([^_\n]+)__/ },
      { kind: 'em', regex: /\*([^*\n]+)\*/ },
      { kind: 'emUnderscore', regex: /_([^_\n]+)_/ }
    ];

    while (rest) {
      let winner = null;
      for (const pattern of patterns) {
        const match = pattern.regex.exec(rest);
        if (!match) continue;
        if (!winner || match.index < winner.match.index || (match.index === winner.match.index && match[0].length > winner.match[0].length)) {
          winner = { pattern, match };
        }
      }

      if (!winner) {
        parent.append(document.createTextNode(rest));
        break;
      }

      if (winner.match.index > 0) parent.append(document.createTextNode(rest.slice(0, winner.match.index)));
      const { pattern, match } = winner;
      let element;

      if (pattern.kind === 'link') {
        element = document.createElement('a');
        element.href = match[2];
        element.target = '_blank';
        element.rel = 'noreferrer';
        element.dataset.mdLink = match[2];
        element.append(document.createTextNode(match[1]));
      } else if (pattern.kind === 'strong' || pattern.kind === 'strongUnderscore') {
        element = document.createElement('strong');
        const marker = pattern.kind === 'strong' ? '**' : '__';
        element.dataset.mdOpen = marker;
        element.dataset.mdClose = marker;
        element.append(document.createTextNode(match[1]));
      } else {
        element = document.createElement('em');
        const marker = pattern.kind === 'em' ? '*' : '_';
        element.dataset.mdOpen = marker;
        element.dataset.mdClose = marker;
        element.append(document.createTextNode(match[1]));
      }

      parent.append(element);
      rest = rest.slice(winner.match.index + winner.match[0].length);
    }
  };

  const createMarkdownBlock = (line) => {
    const block = document.createElement('div');
    if (!line) {
      block.append(document.createElement('br'));
      return block;
    }

    let content = line;
    let match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      block.dataset.mdBlock = 'heading';
      block.dataset.mdPrefix = `${match[1]} `;
      block.className = `md-heading md-h${match[1].length}`;
      content = match[2];
    } else if ((match = /^[-*]\s+(.+)$/.exec(line))) {
      block.dataset.mdBlock = 'ul';
      block.dataset.mdPrefix = '- ';
      block.className = 'md-list-item';
      content = match[1];
    } else if ((match = /^(\d+)\.\s+(.+)$/.exec(line))) {
      block.dataset.mdBlock = 'ol';
      block.dataset.mdPrefix = `${match[1]}. `;
      block.dataset.mdLabel = `${match[1]}.`;
      block.className = 'md-list-item';
      content = match[2];
    }

    appendInlineMarkdown(block, content);
    if (!block.childNodes.length) block.append(document.createElement('br'));
    return block;
  };

  const renderMarkdown = (markdown) => {
    const fragment = document.createDocumentFragment();
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    for (const line of lines) fragment.append(createMarkdownBlock(line));
    editor.replaceChildren(fragment);
    updatePromptState();
  };

  const findInlineMatch = (text) => {
    const patterns = [
      { tag: 'a', regex: /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/, inner: 1, link: 2 },
      { tag: 'strong', regex: /\*\*([^*\n]+)\*\*/, inner: 1, open: '**', close: '**' },
      { tag: 'strong', regex: /__([^_\n]+)__/, inner: 1, open: '__', close: '__' },
      { tag: 'em', regex: /\*([^*\n]+)\*/, inner: 1, open: '*', close: '*' },
      { tag: 'em', regex: /_([^_\n]+)_/, inner: 1, open: '_', close: '_' }
    ];
    let winner = null;
    for (const pattern of patterns) {
      const match = pattern.regex.exec(text);
      if (!match) continue;
      if (!winner || match.index < winner.match.index || (match.index === winner.match.index && match[0].length > winner.match[0].length)) {
        winner = { pattern, match };
      }
    }
    return winner;
  };

  const transformTextNode = (textNode) => {
    if (!textNode?.data || textNode.parentElement?.closest('[data-md-open],[data-md-link]')) return false;
    const winner = findInlineMatch(textNode.data);
    if (!winner) return false;

    const selection = window.getSelection();
    const caretOffset = selection?.isCollapsed && selection.anchorNode === textNode ? selection.anchorOffset : null;
    const { pattern, match } = winner;
    const start = match.index;
    const end = start + match[0].length;
    const innerText = match[pattern.inner];
    const innerStart = start + match[0].indexOf(innerText);
    const innerEnd = innerStart + innerText.length;

    const beforeText = document.createTextNode(textNode.data.slice(0, start));
    const afterText = document.createTextNode(textNode.data.slice(end));
    const formatted = document.createElement(pattern.tag);
    formatted.append(document.createTextNode(innerText));

    if (pattern.tag === 'a') {
      formatted.href = match[pattern.link];
      formatted.target = '_blank';
      formatted.rel = 'noreferrer';
      formatted.dataset.mdLink = match[pattern.link];
    } else {
      formatted.dataset.mdOpen = pattern.open;
      formatted.dataset.mdClose = pattern.close;
    }

    const fragment = document.createDocumentFragment();
    if (beforeText.data) fragment.append(beforeText);
    fragment.append(formatted);
    if (afterText.data) fragment.append(afterText);
    textNode.replaceWith(fragment);

    if (caretOffset !== null) {
      if (caretOffset <= start && beforeText.data) placeCaret(beforeText, caretOffset);
      else if (caretOffset >= end && afterText.data) placeCaret(afterText, caretOffset - end);
      else if (caretOffset >= innerStart && caretOffset <= innerEnd) placeCaret(formatted.firstChild, caretOffset - innerStart);
      else if (caretOffset >= end) placeCaretAtEnd(formatted);
      else placeCaretAtEnd(formatted);
    }
    return true;
  };

  const processInlineMarkdown = () => {
    let passes = 0;
    let changed = true;
    while (changed && passes < 40) {
      changed = false;
      passes += 1;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (transformTextNode(node)) {
          changed = true;
          break;
        }
      }
    }
  };

  const blockForSelection = () => {
    const selection = window.getSelection();
    if (!selection?.anchorNode || !editor.contains(selection.anchorNode)) return null;
    let node = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
    if (node === editor) return null;
    while (node && node.parentElement !== editor) node = node.parentElement;
    return node && node.parentElement === editor ? node : null;
  };

  const rangeTextBeforeCaret = (container) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const probe = document.createRange();
    probe.selectNodeContents(container);
    try { probe.setEnd(range.startContainer, range.startOffset); } catch { return null; }
    return probe.toString();
  };

  const rangeTextAfterCaret = (container) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const probe = document.createRange();
    probe.selectNodeContents(container);
    try { probe.setStart(range.endContainer, range.endOffset); } catch { return null; }
    return probe.toString();
  };

  const unwrapInlineAtCaret = (key) => {
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode) return false;
    const origin = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
    const formatted = origin?.closest?.('[data-md-open],[data-md-link]');
    if (!formatted || !editor.contains(formatted)) return false;

    const atStart = rangeTextBeforeCaret(formatted) === '';
    const atEnd = rangeTextAfterCaret(formatted) === '';
    if ((key === 'Backspace' && !atStart) || (key === 'Delete' && !atEnd)) return false;

    const children = Array.from(formatted.childNodes);
    const fragment = document.createDocumentFragment();
    for (const child of children) fragment.append(child);
    const first = children[0] || document.createTextNode('');
    const last = children[children.length - 1] || first;
    formatted.replaceWith(fragment);
    if (key === 'Backspace') {
      if (first.nodeType === Node.TEXT_NODE) placeCaret(first, 0);
      else placeCaretAtEnd(first);
    } else {
      if (last.nodeType === Node.TEXT_NODE) placeCaret(last, last.data.length);
      else placeCaretAtEnd(last);
    }
    updatePromptState();
    return true;
  };

  const removeBlockMarkdownAtCaret = () => {
    const block = blockForSelection();
    if (!block?.dataset.mdPrefix) return false;
    const selection = window.getSelection();
    if (!selection?.isCollapsed || rangeTextBeforeCaret(block) !== '') return false;
    delete block.dataset.mdPrefix;
    delete block.dataset.mdBlock;
    delete block.dataset.mdLabel;
    block.className = '';
    updatePromptState();
    return true;
  };

  const transformBlockPrefix = () => {
    const block = blockForSelection();
    if (!block || block.dataset.mdPrefix) return;
    const text = block.textContent || '';
    let match;
    let prefix = '';
    let type = '';
    let className = '';
    let label = '';

    if ((match = /^(#{1,3})\s+(.+)$/.exec(text))) {
      prefix = `${match[1]} `;
      type = 'heading';
      className = `md-heading md-h${match[1].length}`;
    } else if ((match = /^[-*]\s+(.+)$/.exec(text))) {
      prefix = '- ';
      type = 'ul';
      className = 'md-list-item';
    } else if ((match = /^(\d+)\.\s+(.+)$/.exec(text))) {
      prefix = `${match[1]}. `;
      type = 'ol';
      label = `${match[1]}.`;
      className = 'md-list-item';
    } else {
      return;
    }

    const content = match[match.length - 1];
    block.dataset.mdPrefix = prefix;
    block.dataset.mdBlock = type;
    if (label) block.dataset.mdLabel = label;
    block.className = className;
    block.replaceChildren(document.createTextNode(content));
    placeCaretAtEnd(block);
  };

  const insertTextAtSelection = (text) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    selection.deleteFromDocument();
    const range = selection.getRangeAt(0);
    const node = document.createTextNode(text);
    range.insertNode(node);
    placeCaret(node, node.data.length);
  };

  const nextListPrefix = (block) => {
    if (block.dataset.mdBlock !== 'ol') return block.dataset.mdPrefix || '- ';
    const current = Number.parseInt(block.dataset.mdPrefix || '1', 10);
    return `${Number.isFinite(current) ? current + 1 : 1}. `;
  };

  const createNextBlock = (block) => {
    const next = document.createElement('div');
    if (block.dataset.mdBlock === 'ul' || block.dataset.mdBlock === 'ol') {
      const prefix = nextListPrefix(block);
      next.dataset.mdBlock = block.dataset.mdBlock;
      next.dataset.mdPrefix = prefix;
      next.className = 'md-list-item';
      if (block.dataset.mdBlock === 'ol') next.dataset.mdLabel = prefix.trim();
    }
    next.append(document.createElement('br'));
    block.after(next);
    placeCaret(next, 0);
    updatePromptState();
  };

  const parseFigmaUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 2048 || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|[?#]|$)/i.test(raw)) return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname)
        || url.username || url.password || url.port || url.hash) return null;
      const match = /^\/(design|file)\/([a-zA-Z0-9]+)(?:\/([^/]+))?\/?$/.exec(url.pathname);
      if (!match || (match[3] && /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(match[3]))) return null;
      const nodeIds = url.searchParams.getAll('node-id');
      if (nodeIds.length > 1 || (nodeIds.length && !/^\d+[:-]\d+$/.test(nodeIds[0]))) return null;
      const name = decodeURIComponent(match[3] || 'Figma design');
      return { url: url.href, label: name || 'Figma design' };
    } catch {
      return null;
    }
  };

  const attachFigma = (parsed) => {
    attachedFigma = parsed;
    if (figmaValue) figmaValue.value = parsed.url;
    if (figmaLabel) figmaLabel.textContent = parsed.label;
    if (figmaInput) {
      figmaInput.value = '';
      figmaInput.hidden = true;
      figmaInput.removeAttribute('aria-invalid');
    }
    if (figmaChip) figmaChip.hidden = false;
    updateSubmitState();
  };

  const removeFigma = ({ focus = true } = {}) => {
    attachedFigma = null;
    if (figmaValue) figmaValue.value = '';
    if (figmaChip) figmaChip.hidden = true;
    if (figmaInput) {
      figmaInput.hidden = false;
      figmaInput.value = '';
      figmaInput.removeAttribute('aria-invalid');
      if (focus) figmaInput.focus();
    }
    updateSubmitState();
  };

  function updateSubmitState() {
    const markdown = promptValue?.value ?? serializeEditor();
    const rawFigma = figmaInput && !figmaInput.hidden ? figmaInput.value.trim() : '';
    submitButton.disabled = pending || !markdown.trim() || markdown.length > 4000 || Boolean(rawFigma && !parseFigmaUrl(rawFigma));
  }


  const openModal = () => {
    lastFocus = document.activeElement;
    layer.classList.remove('is-closing');
    layer.classList.add('is-open');
    layer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('share-modal-open');
    window.setTimeout(() => editor.focus(), 0);
  };

  const closeModal = () => {
    if (pending || !layer.classList.contains('is-open')) return;
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    const finish = () => {
      layer.classList.remove('is-closing');
      layer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('share-modal-open');
      if (lastFocus instanceof HTMLElement) lastFocus.focus();
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else window.setTimeout(finish, 100);
  };

  editor.addEventListener('click', (event) => {
    if (event.target.closest('a')) event.preventDefault();
  });

  editor.addEventListener('input', () => {
    transformBlockPrefix();
    processInlineMarkdown();
    const markdown = updatePromptState();
    setStatus(markdown.length > 4000 ? 'Describe the prototype in 4,000 characters or fewer.' : '', markdown.length > 4000);
  });

  editor.addEventListener('blur', () => {
    const markdown = updatePromptState();
    if (markdown.trim()) renderMarkdown(markdown);
  });

  editor.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain');
    if (typeof text !== 'string') return;
    event.preventDefault();
    const current = serializeEditor();
    const selection = window.getSelection();
    const wholeEditorSelected = selection?.rangeCount && selection.getRangeAt(0).toString() === editor.textContent;
    if (!current.trim() || wholeEditorSelected) {
      renderMarkdown(text);
      placeCaretAtEnd(editor);
    } else {
      insertTextAtSelection(text);
      window.setTimeout(() => {
        transformBlockPrefix();
        processInlineMarkdown();
        updatePromptState();
      }, 0);
    }
  });

  editor.addEventListener('keydown', (event) => {
    if ((event.key === 'Backspace' || event.key === 'Delete') && unwrapInlineAtCaret(event.key)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Backspace' && removeBlockMarkdownAtCaret()) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      const block = blockForSelection();
      if (block?.dataset.mdBlock && rangeTextAfterCaret(block) === '') {
        event.preventDefault();
        if ((block.dataset.mdBlock === 'ul' || block.dataset.mdBlock === 'ol') && !(block.textContent || '').trim()) {
          delete block.dataset.mdPrefix;
          delete block.dataset.mdBlock;
          delete block.dataset.mdLabel;
          block.className = '';
          updatePromptState();
        } else {
          createNextBlock(block);
        }
      }
    }
  });

  figmaInput?.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain') || '';
    const parsed = parseFigmaUrl(text);
    if (!parsed) return;
    event.preventDefault();
    attachFigma(parsed);
  });

  figmaInput?.addEventListener('input', () => {
    figmaInput.removeAttribute('aria-invalid');
    setStatus();
    updateSubmitState();
  });

  figmaInput?.addEventListener('blur', () => {
    const value = figmaInput.value.trim();
    if (!value) return;
    const parsed = parseFigmaUrl(value);
    if (parsed) attachFigma(parsed);
    else {
      figmaInput.setAttribute('aria-invalid', 'true');
      setStatus('Paste an HTTPS Figma design or file link, or leave this blank.', true);
    }
  });

  figmaInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const parsed = parseFigmaUrl(figmaInput.value);
    if (!parsed) return;
    event.preventDefault();
    attachFigma(parsed);
  });

  figmaRemove?.addEventListener('click', () => removeFigma());
  openButton.addEventListener('click', openModal);
  closeButton?.addEventListener('click', () => closeModal());
  cancelButton?.addEventListener('click', () => closeModal());
  layer.addEventListener('click', (event) => {
    if (event.target === layer) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && layer.classList.contains('is-open')) closeModal();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const markdown = updatePromptState().trim();
    if (pending || !markdown) return;
    if (markdown.length > 4000) {
      setStatus('Describe the prototype in 4,000 characters or fewer.', true);
      return;
    }
    const submittedFigma = attachedFigma || parseFigmaUrl(figmaInput?.value);
    if (figmaInput?.value.trim() && !submittedFigma) {
      figmaInput.setAttribute('aria-invalid', 'true');
      setStatus('Use an HTTPS figma.com design link.', true);
      return;
    }
    pending = true;
    updateSubmitState();
    setStatus('Opening the project workspace…');
    try {
      if (!projectSlug) throw new Error('Open a project before creating a prototype.');
      const refsResponse = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/refs`, { cache: 'no-store' });
      const refs = await refsResponse.json().catch(() => ({}));
      if (!refsResponse.ok) throw new Error(refs.error || 'Could not load the project branches.');
      const defaultBranch = refs.project?.defaultBranch;
      if (!defaultBranch || !refs.branches?.some(branch => branch.name === defaultBranch)) {
        throw new Error('This repository needs a default branch before a prototype can be created.');
      }
      const modelResponse = await fetch('/api/agent/check', { method: 'POST' });
      const model = await modelResponse.json().catch(() => ({}));
      if (!modelResponse.ok || !model.status?.ready) {
        throw new Error(model.status?.detail || model.error || 'Connect an AI model in Settings before creating a prototype.');
      }
      const workspaceResponse = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: defaultBranch })
      });
      const opened = await workspaceResponse.json().catch(() => ({}));
      if (!workspaceResponse.ok || !opened.workspace) throw new Error(opened.error || 'Could not open the default branch.');
      setStatus('Sending the prototype request…');
      const requestResponse = await fetch(`/api/workspaces/${opened.workspace.id}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: markdown, ...(submittedFigma ? { figmaUrl: submittedFigma.url } : {}) })
      });
      const result = await requestResponse.json().catch(() => ({}));
      if (!requestResponse.ok || !result.request) throw new Error(result.error || 'Could not start the prototype request.');
      window.location.href = opened.workspace.viewerUrl;
    } catch (error) {
      setStatus(error.message || 'Could not start the prototype request.', true);
    } finally {
      pending = false;
      updateSubmitState();
    }
  });

  renderMarkdown('');
})();
