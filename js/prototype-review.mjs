import { stageGeometry, rootClipPath, rectFromPoints, validRect, safeSelection, clamp } from './review-model.mjs';
import { readGrid, writeGrid } from './review-preferences.mjs';
import { replyMarkdown } from './reply-markdown.mjs';

// Branch activity combines the live Draft, private edit snapshots, published Versions, and execution records.
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canvas = $('.review-canvas'), plane = $('.review-plane'), scroll = $('.review-scroll');
const frame = $('[data-review-frame]'), host = $('.review-frame-host'), hit = $('.review-hit-layer');
const rail = $('.review-history'), cards = $('[data-history-items]'), composer = $('[data-comment-form]');
const feedback = $('#review-comment'), send = $('.composer-send'), loadState = $('[data-load-state]');
const figmaChip = $('[data-comment-figma-chip]'), figmaLabel = $('[data-comment-figma-label]');
const annotationComposer = $('[data-annotation-form]'), annotationFeedback = $('#annotation-comment');
const annotationSend = annotationComposer.querySelector('.composer-send');
const annotationFigmaChip = $('[data-annotation-figma-chip]');
const shape = $('[data-selection-rect]'), arrow = $('[data-selection-arrow]');
const viewport = { width: 370, height: 722 };
let viewScroll = { x: 0, y: 0 };
let grid = readGrid(), origin = { x: 0, y: 0 }, rootRadius = {}, geometry, mode = 'test', tool = 'area';
let active = null, requests = [], activity = null, historyWorkspaceId = null, anchor = null, drag = null, figmaUrl = null;
let toastTimer, hoverPending = false, annotationFigmaUrl = null;
let viewedSnapshot = null, attachedFiles = [], submitting = false, addingFiles = false, followsLatest = true, toolChosen = false;
const messageScroll = $('.conversation-messages');
let channel = '', bridgeReady = false, probeId = 0, selectedProbe = 0;
let refreshTimer = null, activitySequence = 0, draftSelected = false, savingVersion = false, saveError = '';
let saveConfirmed = false, saveConfirmationTimer = null;
const completionTransitions = new Set();
function showCompletion(previous, current) {
  if (!previous?.some(request => request.id === current.id && request.status === 'running') ||
      current.status !== 'completed' || completionTransitions.has(current.id)) return;
  completionTransitions.add(current.id);
  setTimeout(() => { completionTransitions.delete(current.id); renderHistory(); }, 1100);
}

function toast(message) {
  const el = $('.review-toast'); el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}
async function json(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Dialogue returned ${response.status}.`);
  return data;
}

function updateGeometry() {
  if (!active) return;
  const width = scroll.clientWidth, height = scroll.clientHeight;
  const contentWidth = Math.max(width, 220), contentHeight = Math.max(height, 300);
  // Keep the prototype at its Interact-mode position when either side rail
  // opens, so the canvas narrows without moving the preview itself.
  const canvasShift = Math.max(0, canvas.getBoundingClientRect().left - 8);
  const layoutWidth = Math.max(contentWidth + canvasShift, 220);
  plane.style.width = `${contentWidth}px`; plane.style.height = `${contentHeight}px`;
  const baseGeometry = stageGeometry(layoutWidth, contentHeight, viewport, origin);
  geometry = { ...baseGeometry, x: baseGeometry.x - canvasShift, gridX: baseGeometry.gridX - canvasShift };
  Object.assign(host.style, { width: `${viewport.width}px`, height: `${viewport.height}px`,
    left: `${geometry.x}px`, top: `${geometry.y}px`, transform: `scale(${geometry.scale})`,
    clipPath: rootClipPath(viewport, origin, rootRadius) });

  // Use the browser's *rendered* transform geometry for grid registration.
  // Safari can quantize a transformed iframe and its clip edge slightly
  // differently from our ideal floating-point calculation. Reading the final
  // boxes forces the grid phase/spacing to the exact pixels the user sees.
  const planeRect = plane.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const renderedScale = hostRect.width > 0 ? hostRect.width / viewport.width : geometry.scale;
  geometry = {
    ...geometry,
    x: hostRect.left - planeRect.left,
    y: hostRect.top - planeRect.top,
    scale: renderedScale,
    gridX: hostRect.left - planeRect.left + origin.x * renderedScale,
    gridY: hostRect.top - planeRect.top + origin.y * renderedScale
  };

  const rootWidth = origin.width > 0 ? origin.width : viewport.width;
  const prototypeCenterX = geometry.gridX + rootWidth * geometry.scale / 2;
  $('.review-tools').style.left = `${prototypeCenterX}px`;
  const overlay = $('.review-grid');
  overlay.hidden = !grid.enabled;
  overlay.style.setProperty('--grid-color', grid.color);
  overlay.style.setProperty('--grid-opacity', grid.opacity / 100);
  overlay.style.setProperty('--grid-step', `${grid.size * geometry.scale}px`);
  overlay.style.setProperty('--grid-x', `${geometry.gridX}px`);
  overlay.style.setProperty('--grid-y', `${geometry.gridY}px`);
  if (anchor) { drawAnchor(anchor); positionComposer(); }
}
function gridButton() {
  const button = $('[data-grid-toggle]'); button.setAttribute('aria-pressed', grid.enabled);
  const label = `${grid.enabled ? 'Hide' : 'Show'} ${grid.size}pt grid`;
  button.title = label; button.setAttribute('aria-label', label);
}
function clearShapes() { shape.setAttribute('hidden', ''); arrow.setAttribute('hidden', ''); }
function framePoint(event) {
  const r = host.getBoundingClientRect();
  return { x: (event.clientX - r.x) / geometry.scale, y: (event.clientY - r.y) / geometry.scale };
}
function inFrame(p) { return p.x >= 0 && p.y >= 0 && p.x <= viewport.width && p.y <= viewport.height; }
function planePoint(p) { return { x: geometry.x + p.x * geometry.scale, y: geometry.y + p.y * geometry.scale }; }
function drawAnchor(value) {
  clearShapes(); if (!geometry) return;
  if (value.type === 'arrow') {
    const a = planePoint(value.start), b = planePoint(value.end);
    for (const [name, v] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) arrow.setAttribute(name, v);
    arrow.removeAttribute('hidden');
  } else if (validRect(value.rect)) {
    const p = planePoint(value.rect);
    for (const [name, v] of Object.entries({ x: p.x, y: p.y, width: value.rect.width * geometry.scale, height: value.rect.height * geometry.scale })) shape.setAttribute(name, v);
    shape.removeAttribute('hidden');
  }
}
function positionComposer() {
  feedback.style.height = 'auto';
  feedback.style.height = `${feedback.value.includes('\n') || feedback.value.length > 42 ? Math.min(240, Math.max(40, feedback.scrollHeight)) : 40}px`;
  if (!anchor || annotationComposer.hidden || !geometry) return;
  const width = annotationComposer.offsetWidth, height = annotationComposer.offsetHeight;
  if (anchor.type === 'arrow') {
    // The gesture starts at the comment box and ends at the pointed-to target.
    const terminal = planePoint(anchor.start);
    const terminalX = terminal.x - scroll.scrollLeft, terminalY = terminal.y - scroll.scrollTop;
    const fitsRight = terminalX + width <= canvas.clientWidth - 8;
    const fitsLeft = terminalX - width >= 8;
    const x = clamp(fitsRight || !fitsLeft ? terminalX : terminalX - width, 8, Math.max(8, canvas.clientWidth - width - 8));
    const y = clamp(terminalY - 30, 8, Math.max(8, canvas.clientHeight - height - 8));
    annotationComposer.style.left = `${x}px`; annotationComposer.style.top = `${y}px`;
    annotationComposer.style.setProperty('--arrow-terminal-x', `${terminalX - x}px`);
    annotationComposer.style.setProperty('--arrow-terminal-y', `${terminalY - y}px`);
    return;
  }
  annotationComposer.style.removeProperty('--arrow-terminal-x'); annotationComposer.style.removeProperty('--arrow-terminal-y');
  const target = planePoint({ x: anchor.rect.x, y: anchor.rect.y + anchor.rect.height });
  const x = clamp(target.x - scroll.scrollLeft, 8, Math.max(8, canvas.clientWidth - width - 8));
  let y = target.y - scroll.scrollTop + 8;
  if (y + height > canvas.clientHeight - 72) y = target.y - scroll.scrollTop - height - 16;
  y = clamp(y, 40, Math.max(40, canvas.clientHeight - height - 72));
  annotationComposer.style.left = `${x}px`; annotationComposer.style.top = `${y}px`;
}
function parseFigmaLink(value) {
  if (!value || value.length > 2048 || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|[?#]|$)/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname)
      || url.username || url.password || url.port || url.hash) return null;
    const match = /^\/(design|file)\/([a-zA-Z0-9]+)(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (!match || (match[3] && /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(match[3]))) return null;
    const ids = url.searchParams.getAll('node-id');
    if (ids.length > 1 || (ids.length && !/^\d+[:-]\d+$/.test(ids[0]))) return null;
    return { url: url.href, label: decodeURIComponent(match[3] || 'Figma design') || 'Figma design' };
  } catch { return null; }
}
function clearFigmaLink() {
  figmaUrl = null;
  figmaChip.hidden = true;
  $('[data-composer-status]').hidden = false;
}
function resetSendState(button = send) {
  clearTimeout(button.hoverTimer);
  button.classList.remove('is-hovered', 'is-long-hover', 'is-clicked');
}
function updateComposerState() {
  if (composer.hidden) return;
  const busy = requests.some(r => r.status === 'running');
  composer.dataset.state = feedback.value ? 'typing' : document.activeElement === feedback ? 'focused' : 'default';
  send.disabled = submitting || addingFiles || busy || !!viewedSnapshot || !active?.terminal || !feedback.value.trim();
  feedback.disabled = submitting || !!viewedSnapshot || !active?.terminal;
  feedback.placeholder = viewedSnapshot ? 'Return to the current build to continue' : !active?.terminal ? 'This working copy is read-only' : 'Ask a question or request a change';
  $('[data-stop-request]').hidden = !busy || !active?.terminal;
  send.hidden = busy || !feedback.value.trim();
  if (send.disabled) resetSendState();
  annotationComposer.dataset.state = annotationFeedback.value ? 'typing' : document.activeElement === annotationFeedback ? 'focused' : 'default';
  annotationFeedback.disabled = submitting || busy || !!viewedSnapshot || !active?.terminal;
  annotationSend.disabled = annotationFeedback.disabled || !anchor || !annotationFeedback.value.trim();
  if (annotationSend.disabled) resetSendState(annotationSend);
  positionComposer();
}
function openComment(value) {
  if (!active?.terminal) { toast('Open a branch to send feedback to the agent.'); return; }
  if (requests.some(request => request.status === 'running')) { toast('Wait for the current agent request to finish.'); return; }
  anchor = { ...structuredClone(value), baseRevisionId: active.head?.sha,
    viewport: { ...viewport }, scroll: { ...viewScroll }, uiOrigin: { x: origin.x, y: origin.y }, coordinateSpace: 'prototype-viewport-css-px' };
  if (anchor.rect) anchor.normalizedRect = { x: anchor.rect.x / viewport.width, y: anchor.rect.y / viewport.height,
    width: anchor.rect.width / viewport.width, height: anchor.rect.height / viewport.height };
  $('[data-anchor-label]').textContent = { selection: 'Selection', area: 'Area', arrow: 'Arrow' }[anchor.type];
  annotationComposer.dataset.anchorType = anchor.type;
  annotationComposer.hidden = false; drawAnchor(anchor); positionComposer(); annotationFeedback.focus(); updateComposerState();
}
function clearAnchor() {
  anchor = null; clearShapes(); annotationComposer.hidden = true; annotationFeedback.value = '';
  annotationFigmaUrl = null; annotationFigmaChip.hidden = true; $('[data-annotation-status]').hidden = false;
  delete annotationComposer.dataset.anchorType;
  annotationComposer.style.removeProperty('--arrow-terminal-x'); annotationComposer.style.removeProperty('--arrow-terminal-y');
  updateComposerState();
}
function mayNavigate() { return true; }
function setMode(next, refresh = true) {
  if (!['test', 'comment'].includes(next) || next === 'comment' && !active) return;
  mode = next; document.body.dataset.mode = mode;
  if (mode !== 'comment') clearAnchor();
  $$('[data-mode-button]').forEach(b => b.setAttribute('aria-pressed', b.dataset.modeButton === mode));
  rail.hidden = mode !== 'comment';
  hit.hidden = mode !== 'comment' || !active?.terminal || !!viewedSnapshot;
  $('.review-tools').hidden = mode !== 'comment' || !active?.terminal || !!viewedSnapshot;
  window.dispatchEvent(new CustomEvent('dialogue:mode', { detail: mode }));
  updateGeometry(); updateComposerState();
  if (mode === 'comment' && refresh) refreshActivity().catch(error => toast(`Could not update conversation: ${error.message}`));
}
function setTool(next) {
  if (!mayNavigate()) return;
  if (tool !== next) clearAnchor();
  tool = next; hit.dataset.tool = next;
  $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === tool));
}
function sendBridge(detail) {
  if (!channel || !frame.src.startsWith('http')) return;
  frame.contentWindow?.postMessage({ scope: 'dialogue-review', channel, ...detail }, new URL(frame.src).origin);
}
function probe(point, action) {
  if (!bridgeReady) {
    if (action === 'select') toast('Element selection is unavailable in this preview. Use Area or Arrow.');
    return;
  }
  const id = ++probeId;
  if (action === 'select') selectedProbe = id;
  sendBridge({ type: 'probe', action, x: point.x, y: point.y, requestId: id });
}
function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '';
  const now = new Date();

  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return time;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) return `Yesterday ${time}`;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function scheduleRefresh() {
  if (!historyWorkspaceId || (!requests.some(request => request.status === 'running') && activity?.terminalActivity?.state !== 'working')) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    return;
  }
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    try { await refreshActivity(); } catch { /* Keep the visible status; try again while running. */ }
    scheduleRefresh();
  }, 3000);
}
function upsertRequest(request) {
  if (!request || request.workspaceId !== historyWorkspaceId || typeof request.id !== 'string') return;
  const index = requests.findIndex(item => item.id === request.id);
  const previous = requests[index];
  if (previous && previous.status !== 'running' && request.status === 'running') return;
  if (previous && JSON.stringify(previous) === JSON.stringify(request)) return;
  if (request.status === 'running') draftSelected = false;
  showCompletion(previous && [previous], request);
  if (index === -1) requests.push(request);
  else requests[index] = request;
  renderHistory();
  scheduleRefresh();
  refreshActivity().catch(error => toast(`Could not update activity: ${error.message}`));
}
async function refreshActivity() {
  const id = historyWorkspaceId;
  if (!id) return;
  const sequence = ++activitySequence;
  const saved = await json(`/api/workspaces/${id}/activity`);
  if (historyWorkspaceId !== id || sequence !== activitySequence) return;
  if (!saved.draft || !Array.isArray(saved.edits) || !Array.isArray(saved.versions) || !Array.isArray(saved.requests))
    throw new Error('Invalid activity response.');
  activity = saved;
  for (const request of saved.requests) showCompletion(requests, request);
  requests = saved.requests;
  renderHistory();
  scheduleRefresh();
}
function renderHistory() {
  const oldTop = messageScroll.scrollTop;
  const workingAvatars = new Map([...cards.querySelectorAll('.is-working[data-message-reply]')].map(card => [card.dataset.messageReply, card.querySelector('.message-dialogue-avatar')]));
  const focusPreview = cards.contains(document.activeElement) ? document.activeElement?.dataset.previewId : null;
  const atBottom = messageScroll.scrollHeight - oldTop - messageScroll.clientHeight < 48;
  const initial = !cards.children.length;
  const ordered = [...requests, ...(activity?.versions || []).map(v => ({ ...v, versionEvent: true }))].sort((a,b) => (Date.parse(a.createdAt)||0) - (Date.parse(b.createdAt)||0));
  cards.innerHTML = ordered.map(request => {
    if (request.versionEvent) {
      const link = /^[a-f0-9]{40}$/.test(request.sha || '') ? `<button type="button" class="message-view-build" data-preview-id="${request.sha}" data-preview-label="${esc(request.label)}">View build<span aria-hidden="true"><img src="assets/conversation-build-arrow.svg" alt=""></span></button>` : '';
      return `<article class="conversation-message is-dialogue is-version-event"><header><img class="message-dialogue-avatar" src="assets/conversation-dialogue.svg" alt=""><div><strong>Dialogue</strong> <time datetime="${esc(request.createdAt)}">${esc(formatTime(request.createdAt))}</time><div>${link}</div></div></header><div class="message-body">Saved ${esc(request.label)} to the repository.</div></article>`;
    }
    const name = request.actor?.name || 'Member';
    const label = { selection: 'Selection', area: 'Area', arrow: 'Arrow' }[request.anchor?.type] || 'Prompt';
    const initials = name.trim().split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();
    const files = (request.attachments || []).map((f,i) => `<a class="message-file" href="/api/workspaces/${historyWorkspaceId}/requests/${request.id}/attachments/${i}" download>${esc(f.name)}</a>`).join('');
    const figma = request.figmaUrl ? `<a class="message-file" href="${esc(request.figmaUrl)}" target="_blank" rel="noopener noreferrer"><img src="assets/conversation-figma.svg" alt="">${esc(parseFigmaLink(request.figmaUrl)?.label || 'Figma design')}</a>` : '';
    const user = `<article class="conversation-message is-user" data-message-user="${esc(request.id)}"><header><span class="message-avatar" aria-hidden="true">${request.actor?.avatarUrl ? `<img class="message-user-photo" src="${esc(request.actor.avatarUrl)}" alt="">` : esc(initials)}</span><div><strong>${esc(name)}</strong> <time datetime="${esc(request.createdAt)}">${esc(formatTime(request.createdAt))}</time><div><span class="message-kind">${label}</span></div></div></header><div class="message-body">${esc(request.displayFeedback || request.feedback)}</div>${figma}${files}</article>`;
    const busy = request.status === 'running';
    const snapshot = request.status === 'completed' && /^[a-f0-9]{40}$/.test(request.snapshotSha || '') ? request.snapshotSha : null;
    const reply = busy ? request.workingDetail || 'Working on your request…' : request.status === 'failed' ? request.error || 'The request failed.' : request.reply || request.summary || 'The agent finished without a reply.';
    const build = snapshot ? `<button type="button" class="message-view-build" data-preview-id="${snapshot}">View build<span aria-hidden="true"><img src="assets/conversation-build-arrow.svg" alt=""></span></button>` : '';
    const avatar = busy
      ? '<picture class="message-dialogue-avatar message-working-avatar" aria-hidden="true"><source media="(prefers-reduced-motion: reduce)" srcset="assets/history-wait-static.svg"><img src="assets/history-wait.svg" alt=""></picture>'
      : '<img class="message-dialogue-avatar" src="assets/conversation-dialogue.svg" alt="">';
    const answer = `<article class="conversation-message is-dialogue ${busy ? 'is-working' : ''}" data-message-reply="${esc(request.id)}" aria-busy="${busy}"><header>${avatar}<div><strong>Dialogue</strong> <time datetime="${esc(request.finishedAt || request.createdAt)}">${esc(formatTime(request.finishedAt || request.createdAt))}</time><div>${build}</div></div></header><div class="message-body ${request.status === 'failed' ? 'activity-error' : ''}">${busy ? `<span role="status">${esc(reply)}</span>` : replyMarkdown(reply)}</div>${request.replyTruncated ? '<p class="message-limit">Reply exceeded the display limit; ask for a shorter response or continue the discussion.</p>' : ''}</article>`;
    return user + answer;
  }).join('');
  // Progress updates must not restart the existing SVG animation.
  for (const card of cards.querySelectorAll('.is-working[data-message-reply]')) {
    const avatar = workingAvatars.get(card.dataset.messageReply);
    if (avatar) card.querySelector('.message-dialogue-avatar').replaceWith(avatar);
  }
  if (!ordered.length) cards.innerHTML = '<p class="conversation-empty">Ask a question, request a change, or select part of the prototype to start a conversation.</p>';
  if (initial || followsLatest && atBottom) messageScroll.scrollTop = messageScroll.scrollHeight;
  else messageScroll.scrollTop = oldTop;
  $('[data-jump-latest]').hidden = followsLatest;
  const canSave = !!active?.terminal && !viewedSnapshot && !!activity?.draft?.canSave && !requests.some(r => r.status === 'running') && !savingVersion && !saveConfirmed;
  const save = $('[data-save-version]'); save.disabled = !canSave;
  save.querySelector('span').textContent = savingVersion ? 'Saving…' : saveConfirmed ? 'Saved a version' : 'Save a version';
  save.title = saveError || (viewedSnapshot ? 'Return to the current build to save a version' : canSave ? 'Publish the current draft as a version' : 'No new changes to save');
  updateComposerState();
  if (focusPreview) cards.querySelector(`[data-preview-id="${focusPreview}"]`)?.focus({ preventScroll: true });
}
async function saveVersion(retry = false) {
  if (savingVersion || saveConfirmed || !active?.terminal || !activity?.draft?.canSave || !historyWorkspaceId
    || requests.some(request => request.status === 'running') || activity.terminalActivity?.state === 'working') return;
  savingVersion = true;
  saveError = '';
  renderHistory();
  window.DialogueConnect?.busy(true);
  try {
    const response = await fetch(`/api/workspaces/${historyWorkspaceId}/versions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409 && payload.setup) {
      window.DialogueConnect?.show(payload.setup, {
        failedBefore: retry, onRetry: () => saveVersion(true),
        after: 'Once the key is added, press the button below. Dialogue checks the connection and publishes this Draft.'
      });
      return;
    }
    if (response.status !== 201 || !payload.version?.label || !/^[a-f0-9]{40}$/.test(payload.version?.sha || ''))
      throw new Error(payload.error || 'Could not publish this Draft.');
    window.DialogueConnect?.close();
    toast(`${payload.version.label} saved to GitHub.`);
    saveConfirmed = true;
    clearTimeout(saveConfirmationTimer);
    saveConfirmationTimer = setTimeout(() => {
      saveConfirmed = false;
      draftSelected = false;
      renderHistory();
    }, 2000);
    await refreshActivity().catch(error => toast(`Version saved, but activity could not update: ${error.message}`));
  } catch (error) {
    saveError = error.message || 'Could not publish this Draft.';
    toast(saveError);
  } finally {
    savingVersion = false;
    window.DialogueConnect?.busy(false);
    renderHistory();
  }
}
async function restartPrototype() {
  if (!active || !mayNavigate()) return;
  await window.DialogueWorkspace?.reload();
}

addEventListener('dialogue:workspace', async event => {
  active = event.detail;
  const params = new URLSearchParams(location.search);
  const nextWorkspaceId = params.get('source') || active.id;
  if (nextWorkspaceId !== historyWorkspaceId) {
    activity = null; requests = []; draftSelected = false; saveError = ''; saveConfirmed = false;
    clearTimeout(saveConfirmationTimer);
    clearTimeout(refreshTimer); refreshTimer = null;
    completionTransitions.clear();
  }
  historyWorkspaceId = nextWorkspaceId;
  if (params.get('source') && active.kind !== 'branch') {
    viewedSnapshot = { sha: active.ref, workspace: active };
    $('[data-viewing-build-label]').textContent = `Viewing build ${active.ref.slice(0,7)}`;
    $('[data-viewing-build]').hidden = false;
  }
  origin = { x: 0, y: 0 }; rootRadius = {};
  setMode(params.get('mode') === 'test' ? 'test' : 'comment', false);
  fetch('/api/agent', { cache: 'no-store' }).then(r => r.json()).then(r => { const id = r.model?.split('/').at(-1) || 'AI model'; const label = id.replace(/^gpt-([0-9.]+)-(.+)$/, (_,version,name) => `ChatGPT ${version} ${name.split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ')}`); $('[data-conversation-model]').textContent = label; $('[data-conversation-model]').title = r.model || label; }).catch(() => {});
  updateGeometry();
  try { await refreshActivity(); } catch (error) { toast(`Could not load activity: ${error.message}`); }
});
addEventListener('dialogue:request', event => upsertRequest(event.detail));
addEventListener('dialogue:activity', event => {
  if (historyWorkspaceId !== active?.id || !activity || !Object.hasOwn(event.detail || {}, 'terminalActivity')) return;
  ++activitySequence;
  activity.terminalActivity = event.detail.terminalActivity;
  renderHistory();
  scheduleRefresh();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshActivity().catch(() => {});
});
if (window.DialogueWorkspace?.current) {
  window.dispatchEvent(new CustomEvent('dialogue:workspace', { detail: window.DialogueWorkspace.current }));
}
addEventListener('dialogue:change', event => {
  if (!active) return;
  active.head = event.detail.head;
  active.dirty = event.detail.dirty;
  refreshActivity().catch(error => toast(`Could not update activity: ${error.message}`));
});
addEventListener('dialogue:channel', event => {
  channel = event.detail;
  bridgeReady = false;
  $('[data-tool="selection"]').disabled = true;
  if (tool === 'selection') setTool('area');
});
frame.addEventListener('load', () => {
  updateGeometry();
  if (frame.src.startsWith('http')) sendBridge({ type: 'measure' });
});
addEventListener('message', event => {
  const m = event.data;
  if (event.source !== frame.contentWindow || !frame.src.startsWith('http')
    || event.origin !== new URL(frame.src).origin || m?.scope !== 'dialogue-review' || m.channel !== channel) return;
  if (m.type === 'layout' && validRect(m.origin)) {
    bridgeReady = true;
    $('[data-tool="selection"]').disabled = !!viewedSnapshot || !active?.terminal;
    if (!toolChosen && !viewedSnapshot && active?.terminal) setTool('selection');
    viewScroll = { x: clamp(m.scroll?.x, 0, 100000), y: clamp(m.scroll?.y, 0, 100000) };
    origin = { x: clamp(m.origin.x, -viewport.width, viewport.width), y: clamp(m.origin.y, -viewport.height, viewport.height),
      width: clamp(m.origin.width, 0, viewport.width * 4), height: clamp(m.origin.height, 0, viewport.height * 4) };
    rootRadius = m.radius && typeof m.radius === 'object' ? m.radius : {};
    updateGeometry();
  } else if (m.type === 'selection' && mode === 'comment' && tool === 'selection' && !anchor) {
    const selection = safeSelection(m.selection);
    if (!selection) return;
    if (m.action === 'select' && m.requestId === selectedProbe) openComment(selection);
    else if (m.action === 'hover') drawAnchor(selection);
  } else if (m.type === 'restart-shortcut' && mode === 'test' && !$('.review-share-dialog').open) restartPrototype();
});
$$('[data-mode-button]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.modeButton)));
$$('button[data-tool]').forEach(b => b.addEventListener('click', () => { toolChosen = true; setTool(b.dataset.tool); }));
$('[data-grid-toggle]').addEventListener('click', () => { grid = writeGrid({ ...grid, enabled: !grid.enabled }); gridButton(); updateGeometry(); });
addEventListener('storage', () => { grid = readGrid(); gridButton(); updateGeometry(); });
$('[data-reload]').addEventListener('click', restartPrototype);
$('[data-close-comment]').addEventListener('click', () => clearAnchor());
$('[data-save-version]').addEventListener('click', () => saveVersion());
feedback.addEventListener('focus', updateComposerState);
feedback.addEventListener('blur', updateComposerState);
feedback.addEventListener('input', () => { updateComposerState(); positionComposer(); });
feedback.addEventListener('paste', event => {
  if (figmaUrl) return;
  const pasted = event.clipboardData?.getData('text/plain');
  if (!pasted) return;
  for (const match of pasted.matchAll(/https:\/\/(?:www\.)?figma\.com\/[^\s<>"']+/gi)) {
    const candidate = match[0].replace(/[.,!?;:)\]}]+$/, '');
    const parsed = parseFigmaLink(candidate);
    if (!parsed) continue;
    event.preventDefault();
    feedback.setRangeText(pasted.slice(0, match.index) + pasted.slice(match.index + candidate.length),
      feedback.selectionStart, feedback.selectionEnd, 'end');
    figmaUrl = parsed.url;
    figmaLabel.textContent = parsed.label;
    figmaChip.hidden = false;
    $('[data-composer-status]').hidden = true;
    updateComposerState();
    positionComposer();
    break;
  }
});
$('[data-comment-figma-remove]').addEventListener('click', () => {
  clearFigmaLink();
  feedback.focus();
  updateComposerState();
});
for (const [form, input, button] of [[composer, feedback, send], [annotationComposer, annotationFeedback, annotationSend]]) {
  button.addEventListener('pointerenter', () => {
    if (button.disabled) return;
    resetSendState(button); button.classList.add('is-hovered');
    button.hoverTimer = setTimeout(() => { if (!button.disabled && button.matches(':hover')) button.classList.add('is-long-hover'); }, 300);
  });
  button.addEventListener('pointerleave', () => resetSendState(button));
  button.addEventListener('pointerdown', () => { if (!button.disabled) { clearTimeout(button.hoverTimer); button.classList.add('is-clicked'); } });
  button.addEventListener('pointerup', () => button.classList.remove('is-clicked'));
  button.addEventListener('pointercancel', () => button.classList.remove('is-clicked'));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!button.disabled) form.requestSubmit(); }
  });
  form.addEventListener('submit', event => submitMessage(event, form, input, button));
}
async function submitMessage(event, form, input, button) {
  event.preventDefault();
  if (!input.value.trim() || button.disabled || !active?.terminal || viewedSnapshot) return;
  const annotated = form === annotationComposer;
  const design = annotated ? annotationFigmaUrl : figmaUrl;
  const body = { feedback: input.value, ...(annotated && anchor ? { anchor } : {}), ...(design ? { figmaUrl: design } : {}), attachments: annotated ? [] : attachedFiles };
  submitting = true; followsLatest = true;
  updateComposerState();
  try {
    const response = await fetch(`/api/workspaces/${active.id}/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The request could not be sent.');
    upsertRequest(data.request);
    if (annotated) clearAnchor();
    else { feedback.value = ''; clearFigmaLink(); attachedFiles = []; renderFiles(); }
    messageScroll.scrollTop = messageScroll.scrollHeight;
  } catch (error) { toast(error.message); }
  finally { submitting = false; updateComposerState(); }
}
annotationFeedback.addEventListener('focus', updateComposerState);
annotationFeedback.addEventListener('blur', updateComposerState);
annotationFeedback.addEventListener('input', updateComposerState);
annotationFeedback.addEventListener('paste', event => {
  if (annotationFigmaUrl) return;
  const pasted = event.clipboardData?.getData('text/plain');
  if (!pasted) return;
  for (const match of pasted.matchAll(/https:\/\/(?:www\.)?figma\.com\/[^\s<>"']+/gi)) {
    const candidate = match[0].replace(/[.,!?;:)\]}]+$/, ''), parsed = parseFigmaLink(candidate);
    if (!parsed) continue;
    event.preventDefault();
    annotationFeedback.setRangeText(pasted.slice(0, match.index) + pasted.slice(match.index + candidate.length), annotationFeedback.selectionStart, annotationFeedback.selectionEnd, 'end');
    annotationFigmaUrl = parsed.url; $('[data-annotation-figma-label]').textContent = parsed.label;
    annotationFigmaChip.hidden = false; $('[data-annotation-status]').hidden = true; updateComposerState(); break;
  }
});
$('[data-annotation-figma-remove]').addEventListener('click', () => {
  annotationFigmaUrl = null; annotationFigmaChip.hidden = true; $('[data-annotation-status]').hidden = false;
  annotationFeedback.focus(); updateComposerState();
});
hit.addEventListener('pointermove', event => {
  if (!geometry || anchor || viewedSnapshot || !active?.terminal) return;
  const p = framePoint(event);
  if (drag) {
    drag.end = tool === 'arrow'
      ? p
      : { x: clamp(p.x, 0, viewport.width), y: clamp(p.y, 0, viewport.height) };
    drawAnchor(tool === 'arrow' ? { type: tool, start: drag.start, end: drag.end } : { type: tool, rect: rectFromPoints(drag.start, drag.end) });
  } else if (tool === 'selection' && inFrame(p) && !hoverPending) {
    hoverPending = true; requestAnimationFrame(() => { hoverPending = false; probe(p, 'hover'); });
  } else if (!inFrame(p)) clearShapes();
});
hit.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !geometry || anchor || viewedSnapshot || !active?.terminal) return;
  const p = framePoint(event);
  if (tool === 'selection') {
    if (inFrame(p)) probe(p, 'select');
    return;
  }
  if (tool === 'area' && !inFrame(p)) return;
  // Arrow starts anywhere on the review canvas, including beyond the
  // prototype viewport. Coordinates remain relative to that viewport so
  // they continue to follow the prototype when the canvas recentres.
  drag = { start: p, end: p }; hit.setPointerCapture(event.pointerId);
});
hit.addEventListener('pointerup', event => {
  if (!drag) return;
  const saved = drag; drag = null; hit.releasePointerCapture(event.pointerId);
  const r = rectFromPoints(saved.start, saved.end);
  if (Math.hypot(r.width, r.height) < 5) { clearShapes(); return; }
  openComment(tool === 'arrow' ? { type: tool, start: saved.start, end: saved.end } : { type: tool, rect: r });
});
hit.addEventListener('pointercancel', () => { drag = null; clearShapes(); });
hit.addEventListener('pointerleave', () => { if (!drag && !anchor) clearShapes(); });
async function openCommit(sha, label = sha.slice(0,7)) {
  if (!active?.project?.slug || !/^[a-f0-9]{40}$/.test(sha)) return;
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(active.project.slug)}/workspaces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: sha })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.workspace) throw new Error(data.error || 'Could not open that commit.');
    viewedSnapshot = { sha, workspace: data.workspace };
    await window.DialogueWorkspace.view(data.workspace);
    $('[data-viewing-build-label]').textContent = `Viewing build ${label}`;
    $('[data-viewing-build]').hidden = false;
    clearAnchor(); setMode('comment', false); renderHistory();
  } catch (error) { toast(error.message); }
}
cards.addEventListener('click', event => {
  const link = event.target.closest('[data-preview-id]');
  if (link) openCommit(link.dataset.previewId, link.dataset.previewLabel);
});
$('[data-return-current]').addEventListener('click', async () => {
  try {
    if (active.kind !== 'branch') { location.href = `workspace.html?id=${encodeURIComponent(historyWorkspaceId)}&mode=comment`; return; }
    await window.DialogueWorkspace.returnToCurrent(); viewedSnapshot = null;
    $('[data-viewing-build]').hidden = true; setMode('comment', false); renderHistory();
  } catch (error) { toast(error.message); }
});
scroll.addEventListener('scroll', positionComposer);
new ResizeObserver(updateGeometry).observe(canvas);
addEventListener('keydown', event => {
  if ($('.review-share-dialog').open) return;
  if (event.key === 'Escape') { clearAnchor(); closeMenus(); return; }
  if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    && !event.target.closest('input,textarea,select,[contenteditable],.terminal-pane')) {
    event.preventDefault(); restartPrototype();
  }
});
const dialog = $('.review-share-dialog');
$('[data-review-share]').addEventListener('click', () => {
  $('[data-share-url]').value = location.href;
  dialog.showModal();
});
$('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
$('[data-copy-local]').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('[data-share-url]').value); $('[data-copy-local]').textContent = 'Copied!'; setTimeout(() => { $('[data-copy-local]').textContent = 'Copy'; }, 3000); }
  catch { $('[data-share-url]').select(); toast('Copy the selected local link.'); }
});
gridButton();
setTool('area');

function closeMenus() {
  $('#attachment-menu').hidden = true; $('[data-figma-input]').hidden = true;
  $('[data-add-attachment]').setAttribute('aria-expanded', 'false');
}
function renderFiles() {
  $('[data-composer-files]').innerHTML = attachedFiles.map((file, i) => `<span class="composer-file">${esc(file.name)}<button type="button" data-remove-file="${i}" aria-label="Remove ${esc(file.name)}">×</button></span>`).join('');
  positionComposer();
}
$('[data-add-attachment]').addEventListener('click', () => {
  const menu = $('#attachment-menu'); menu.hidden = !menu.hidden;
  $('[data-add-attachment]').setAttribute('aria-expanded', String(!menu.hidden));
});
$('[data-add-file]').addEventListener('click', () => { closeMenus(); $('[data-file-input]').click(); });
$('[data-file-input]').addEventListener('change', async event => {
  addingFiles = true; updateComposerState();
  try {
    const next = [...event.target.files];
    if (attachedFiles.length + next.length > 4 || next.some(f => f.size > 2 * 1024 * 1024) || [...attachedFiles.map(f => f.size), ...next.map(f => f.size)].reduce((a,b) => a+b,0) > 4 * 1024 * 1024) throw new Error('Attach up to four files, 2 MiB each and 4 MiB total.');
    for (const file of next) {
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      attachedFiles.push({ name: file.name, size: file.size, data });
    }
    renderFiles();
  } catch (error) { toast(error.message || 'Could not read the file.'); }
  finally { event.target.value = ''; addingFiles = false; updateComposerState(); }
});
$('[data-composer-files]').addEventListener('click', event => {
  const remove = event.target.closest('[data-remove-file]');
  if (remove) { attachedFiles.splice(Number(remove.dataset.removeFile), 1); renderFiles(); }
});
$('[data-add-figma]').addEventListener('click', () => { closeMenus(); $('[data-figma-input]').hidden = false; $('#figma-link').focus(); });
$('[data-close-figma]').addEventListener('click', closeMenus);
$('[data-confirm-figma]').addEventListener('click', () => {
  const parsed = parseFigmaLink($('#figma-link').value.trim());
  if (!parsed) { toast('Paste a valid Figma design link.'); return; }
  figmaUrl = parsed.url; figmaLabel.textContent = parsed.label; figmaChip.hidden = false;
  $('#figma-link').value = ''; closeMenus(); feedback.focus();
});
$('#figma-link').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('[data-confirm-figma]').click(); } });
document.addEventListener('click', event => { if (!composer.contains(event.target)) closeMenus(); });
$('[data-stop-request]').addEventListener('click', async event => {
  event.target.disabled = true;
  try {
    const response = await fetch(`/api/workspaces/${historyWorkspaceId}/requests/stop`, { method: 'POST' });
    if (!response.ok) throw new Error((await response.json()).error || 'Could not stop the request.');
    await refreshActivity();
  } catch (error) { toast(error.message); }
  finally { event.target.disabled = false; }
});
messageScroll.addEventListener('scroll', () => {
  followsLatest = messageScroll.scrollHeight - messageScroll.scrollTop - messageScroll.clientHeight < 48;
  $('[data-jump-latest]').hidden = followsLatest;
});
$('[data-jump-latest]').addEventListener('click', () => { followsLatest = true; messageScroll.scrollTop = messageScroll.scrollHeight; $('[data-jump-latest]').hidden = true; });
