import { chronological, stageGeometry, rootClipPath, rectFromPoints, validRect, safeSelection, clamp } from './review-model.mjs';
import { readGrid, writeGrid } from './review-preferences.mjs';

// Branch activity combines the live Draft, private edit snapshots, published Versions, and execution records.
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canvas = $('.review-canvas'), plane = $('.review-plane'), scroll = $('.review-scroll');
const frame = $('[data-review-frame]'), host = $('.review-frame-host'), hit = $('.review-hit-layer');
const rail = $('.review-history'), cards = $('[data-history-items]'), composer = $('[data-comment-form]');
const feedback = $('#review-comment'), send = $('.composer-send'), loadState = $('[data-load-state]');
const figmaChip = $('[data-comment-figma-chip]'), figmaLabel = $('[data-comment-figma-label]');
const shape = $('[data-selection-rect]'), arrow = $('[data-selection-arrow]');
const viewport = { width: 370, height: 722 };
let viewScroll = { x: 0, y: 0 };
let grid = readGrid(), origin = { x: 0, y: 0 }, rootRadius = {}, geometry, mode = 'test', tool = 'area';
let active = null, requests = [], activity = null, historyWorkspaceId = null, anchor = null, drag = null, figmaUrl = null;
let sendHoverTimer, toastTimer, hoverPending = false;
let channel = '', bridgeReady = false, probeId = 0, selectedProbe = 0;
let refreshTimer = null, activitySequence = 0, draftSelected = false, savingVersion = false, saveError = '';
let saveConfirmed = false, saveConfirmationTimer = null;

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
  // Comment mode opens the activity rail by moving only the canvas's left edge.
  // Calculate the prototype against the original full canvas width, then offset
  // it back by the animated left-edge shift. This keeps the prototype fixed in
  // the browser while the white canvas smoothly becomes narrower behind it.
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
  if (!anchor || composer.hidden || !geometry) return;
  const width = composer.offsetWidth, height = composer.offsetHeight;
  if (anchor.type === 'arrow') {
    // Arrow gestures begin where the comment belongs and end at the target.
    // Keep that start point canvas-wide (it may sit outside the prototype).
    const terminal = planePoint(anchor.start);
    const terminalX = terminal.x - scroll.scrollLeft;
    const terminalY = terminal.y - scroll.scrollTop;
    const fitsRight = terminalX + width <= canvas.clientWidth - 8;
    const fitsLeft = terminalX - width >= 8;
    let x = fitsRight || !fitsLeft ? terminalX : terminalX - width;
    x = clamp(x, 8, Math.max(8, canvas.clientWidth - width - 8));
    const y = clamp(terminalY - 30, 8, Math.max(8, canvas.clientHeight - height - 8));
    composer.style.left = `${x}px`; composer.style.top = `${y}px`;
    composer.style.setProperty('--arrow-terminal-x', `${terminalX - x}px`);
    composer.style.setProperty('--arrow-terminal-y', `${terminalY - y}px`);
    return;
  }
  composer.style.removeProperty('--arrow-terminal-x');
  composer.style.removeProperty('--arrow-terminal-y');
  const target = planePoint({ x: anchor.rect.x, y: anchor.rect.y + anchor.rect.height });
  const x = clamp(target.x - scroll.scrollLeft, 8, Math.max(8, canvas.clientWidth - width - 8));
  let y = target.y - scroll.scrollTop + 8;
  if (y + height > canvas.clientHeight - 72) y = target.y - scroll.scrollTop - height - 16;
  y = clamp(y, 40, Math.max(40, canvas.clientHeight - height - 72));
  composer.style.left = `${x}px`; composer.style.top = `${y}px`;
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
function resetSendState() {
  clearTimeout(sendHoverTimer);
  send.classList.remove('is-hovered', 'is-long-hover', 'is-clicked');
}
function updateComposerState() {
  if (composer.hidden) return;
  const hasText = feedback.value.length > 0;
  composer.dataset.state = hasText ? 'typing' : document.activeElement === feedback ? 'focused' : 'default';
  send.disabled = !feedback.value.trim();
  if (send.disabled) resetSendState();
}
function openComment(value) {
  if (!active?.terminal) { toast('Open a branch to send feedback to the agent.'); return; }
  if (requests.some(request => request.status === 'running')) { toast('Wait for the current agent request to finish.'); return; }
  anchor = { ...structuredClone(value), baseRevisionId: active.head?.sha,
    viewport: { ...viewport }, scroll: { ...viewScroll }, uiOrigin: { x: origin.x, y: origin.y }, coordinateSpace: 'prototype-viewport-css-px' };
  if (anchor.rect) anchor.normalizedRect = { x: anchor.rect.x / viewport.width, y: anchor.rect.y / viewport.height,
    width: anchor.rect.width / viewport.width, height: anchor.rect.height / viewport.height };
  $('[data-anchor-label]').textContent = { selection: 'Selection', area: 'Area', arrow: 'Arrow' }[anchor.type];
  composer.dataset.anchorType = anchor.type;
  composer.dataset.state = 'default';
  composer.hidden = false; drawAnchor(anchor); positionComposer(); feedback.focus(); updateComposerState();
}
function closeComment() {
  // Commenting is intentionally low-friction: closing, changing tools/modes or
  // navigating away discards an unsent draft without a browser confirmation.
  composer.hidden = true; feedback.value = ''; clearFigmaLink(); send.disabled = true; resetSendState(); composer.dataset.state = 'default'; delete composer.dataset.anchorType;
  composer.style.removeProperty('--arrow-terminal-x'); composer.style.removeProperty('--arrow-terminal-y');
  anchor = null; clearShapes(); return true;
}
function mayNavigate() { return composer.hidden || closeComment(); }
function setMode(next) {
  if (mode === next || (next === 'comment' && !active)) return;
  if (next === 'test' && !mayNavigate()) return;
  mode = next; document.body.dataset.mode = mode;
  $$('[data-mode-button]').forEach(b => b.setAttribute('aria-pressed', b.dataset.modeButton === mode));
  rail.hidden = mode !== 'comment';
  hit.hidden = mode !== 'comment' || !active?.terminal;
  $('.review-tools').hidden = mode !== 'comment' || !active?.terminal;
  updateGeometry();
  if (mode === 'comment') refreshActivity().catch(error => toast(`Could not update activity: ${error.message}`));
}
function setTool(next) {
  if (!mayNavigate()) return;
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
  if (now.valueOf() - d.valueOf() < 60000) return 'Just now';
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
  requests = saved.requests;
  renderHistory();
  scheduleRefresh();
}
function renderHistory() {
  const oldTop = rail.scrollTop;
  const focused = cards.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.dataset.cardFocus;
  const focusPreview = focused?.dataset.previewId;
  const draft = activity?.draft;
  if (!draft) { cards.replaceChildren(); return; }
  const readonly = !active?.terminal;
  const working = requests.some(request => request.status === 'running') || activity.terminalActivity?.state === 'working';
  const canSelectDraft = readonly || draft.canSave || saveConfirmed;
  const actions = draftSelected && !readonly && canSelectDraft
    ? `<div class="card-actions"><button class="review-button" type="button" data-card-cancel data-card-focus="cancel">Cancel</button><button class="review-button primary save-version-button ${saveConfirmed ? 'is-saved' : ''}" type="button" data-card-save data-card-focus="save" ${!draft.canSave || working || savingVersion || saveConfirmed ? 'disabled' : ''}>${saveConfirmed ? 'Saved version' : savingVersion ? 'Saving…' : 'Save a version'}</button></div>` : '';
  const draftDetail = draft.pending ? 'A previous save is ready to retry.'
    : draft.canSave ? 'Changes are ready to save.' : 'Current working prototype.';
  const draftTitle = readonly ? 'Changes on the source branch' : `Changes on ${active?.ref || 'this branch'}`;
  const draftCard = `<article class="activity-card is-active is-draft ${actions ? 'has-actions' : ''}" data-draft-card data-card-focus="draft" tabindex="${canSelectDraft ? '0' : '-1'}" aria-expanded="${draftSelected && !readonly}" aria-current="${readonly ? 'false' : 'true'}" ${canSelectDraft ? `title="${readonly ? 'Open current branch Draft' : 'Select current Draft'}"` : 'data-inert'}>
    <div class="activity-meta"><span class="revision-badge badge-draft">Draft</span></div>
    <div class="activity-content"><p class="activity-request">${esc(draftTitle)}</p><p class="activity-summary">${esc(draftDetail)}</p>${readonly ? '<small>Open the source branch to continue editing.</small>' : ''}${saveError ? `<p class="activity-error" role="alert">${esc(saveError)}</p>` : ''}</div>${actions}</article>`;
  const requestById = new Map(requests.map(request => [request.id, request]));
  const editedRequests = new Set(activity.edits.map(edit => edit.requestId));
  const entries = [
    ...activity.edits.map(edit => ({ type: 'edit', value: edit, createdAt: edit.createdAt })),
    ...activity.versions.map(version => ({ type: 'version', value: version, createdAt: version.createdAt })),
    ...requests.filter(request => !editedRequests.has(request.id) || request.status === 'running')
      .map(request => ({ type: 'request', value: request, createdAt: request.finishedAt || request.startedAt || request.createdAt })),
    ...(activity.terminalActivity ? [{ type: 'terminal', value: activity.terminalActivity, createdAt: activity.terminalActivity.updatedAt }] : [])
  ];
  const summaryFor = (request, fallback) => {
    const text = request?.summary?.trim();
    return text && !/^[^.!?]{1,48}:$/.test(text) ? text : fallback;
  };
  const live = text => `<p class="activity-live" role="status"><img src="assets/dialogue-wait.svg" alt="" aria-hidden="true"><span>${esc(text)}</span></p>`;
  cards.innerHTML = draftCard + chronological(entries).map(({ type, value }) => {
    if (type === 'edit') {
      const edit = value, sha = /^[a-f0-9]{40}$/.test(edit.sha || '') ? edit.sha : '';
      const request = requestById.get(edit.requestId);
      return `<article class="activity-card" ${sha ? `data-preview-id="${sha}" tabindex="0" title="Open this Edited snapshot as a read-only preview"` : ''}>
        <div class="activity-meta"><span class="revision-badge badge-edited">Edited</span><time datetime="${esc(edit.createdAt)}">${esc(formatTime(edit.createdAt))}</time></div>
        <div class="activity-content"><p class="activity-request">${esc(edit.feedback)}</p><p class="activity-summary">${esc(summaryFor(request, 'Changes from this comment are ready to review.'))}</p></div></article>`;
    }
    if (type === 'version') {
      const version = value, sha = /^[a-f0-9]{40}$/.test(version.sha || '') ? version.sha : '';
      return `<article class="activity-card is-version" ${sha ? `data-preview-id="${sha}" tabindex="0" title="Open ${esc(version.label)} as a read-only preview"` : ''}>
        <div class="activity-meta"><span class="revision-badge badge-version">${esc(version.label)}</span><time datetime="${esc(version.createdAt)}">${esc(formatTime(version.createdAt))}</time></div>
        <div class="activity-content"><p class="activity-request">Published version</p><p class="activity-summary">Saved to the repository.</p></div></article>`;
    }
    if (type === 'terminal') {
      const turn = value, busy = turn.state === 'working';
      return `<article class="activity-card is-compact ${busy ? 'is-working' : ''}" aria-busy="${busy}">
        <div class="activity-meta"><span class="revision-badge">${busy ? 'Working' : 'Activity'}</span><time datetime="${esc(turn.updatedAt)}">${esc(formatTime(turn.updatedAt))}</time></div>
        <div class="activity-content"><p class="activity-request">Agent terminal</p>${busy ? live(turn.text) : `<p class="activity-summary">${esc(turn.text)}</p>`}</div></article>`;
    }
    const request = value, busy = request.status === 'running';
    const timestamp = request.finishedAt || request.startedAt || request.createdAt;
    const summary = request.status === 'failed' ? request.error || 'The request failed.'
      : summaryFor(request, 'The agent finished without changing files.');
    return `<article class="activity-card ${busy ? 'is-compact is-working' : ''}" data-card-id="${esc(request.id)}" aria-busy="${busy}">
      <div class="activity-meta"><span class="revision-badge">${busy ? 'Working' : request.status === 'failed' ? 'Failed' : 'Completed'}</span><time datetime="${esc(timestamp)}">${esc(formatTime(timestamp))}</time></div>
      <div class="activity-content"><p class="activity-request" title="${esc(request.feedback)}">${esc(request.feedback)}</p>${busy ? live('Working on your comment…')
      : `<p class="${request.status === 'failed' ? 'activity-error' : 'activity-summary'}">${esc(summary)}</p>${request.figmaUrl ? '<small>Figma design attached</small>' : ''}`}</div></article>`;
  }).join('');
  const last = cards.lastElementChild;
  $('.history-spacer').style.height = `${Math.max(0, rail.clientHeight - (last?.offsetHeight || 0) - 8)}px`;
  rail.scrollTop = oldTop;
  const nextFocus = focusKey ? [...cards.querySelectorAll('[data-card-focus]')].find(element => element.dataset.cardFocus === focusKey)
    : focusPreview ? [...cards.querySelectorAll('[data-preview-id]')].find(element => element.dataset.previewId === focusPreview) : null;
  (nextFocus?.disabled ? cards.querySelector('[data-draft-card]') : nextFocus)?.focus({ preventScroll: true });
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
    if (activity?.draft) window.DialogueWorkspace?.updateStatus({ sha: activity.draft.head }, activity.draft.dirty, activity.draft.ahead);
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
  const nextWorkspaceId = new URLSearchParams(location.search).get('source') || active.id;
  if (nextWorkspaceId !== historyWorkspaceId) {
    activity = null; requests = []; draftSelected = false; saveError = ''; saveConfirmed = false;
    clearTimeout(saveConfirmationTimer);
    clearTimeout(refreshTimer); refreshTimer = null;
  }
  historyWorkspaceId = nextWorkspaceId;
  origin = { x: 0, y: 0 }; rootRadius = {};
  $('[data-mode-button="comment"]').lastChild.textContent = active.terminal ? 'Comment' : 'Activity';
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
    $('[data-tool="selection"]').disabled = false;
    viewScroll = { x: clamp(m.scroll?.x, 0, 100000), y: clamp(m.scroll?.y, 0, 100000) };
    origin = { x: clamp(m.origin.x, -viewport.width, viewport.width), y: clamp(m.origin.y, -viewport.height, viewport.height),
      width: clamp(m.origin.width, 0, viewport.width * 4), height: clamp(m.origin.height, 0, viewport.height * 4) };
    rootRadius = m.radius && typeof m.radius === 'object' ? m.radius : {};
    updateGeometry();
  } else if (m.type === 'selection' && mode === 'comment' && tool === 'selection' && composer.hidden) {
    const selection = safeSelection(m.selection);
    if (!selection) return;
    if (m.action === 'select' && m.requestId === selectedProbe) openComment(selection);
    else if (m.action === 'hover') drawAnchor(selection);
  } else if (m.type === 'restart-shortcut' && mode === 'test' && !$('.review-share-dialog').open) restartPrototype();
});
$$('[data-mode-button]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.modeButton)));
$$('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('[data-grid-toggle]').addEventListener('click', () => { grid = writeGrid({ ...grid, enabled: !grid.enabled }); gridButton(); updateGeometry(); });
addEventListener('storage', () => { grid = readGrid(); gridButton(); updateGeometry(); });
$('[data-reload]').addEventListener('click', restartPrototype);
$('[data-close-comment]').addEventListener('click', () => closeComment());
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
send.addEventListener('pointerenter', () => {
  if (send.disabled) return;
  resetSendState(); send.classList.add('is-hovered');
  sendHoverTimer = setTimeout(() => {
    if (!send.disabled && send.matches(':hover')) send.classList.add('is-long-hover');
  }, 300);
});
send.addEventListener('pointerleave', resetSendState);
send.addEventListener('pointerdown', () => {
  if (send.disabled) return;
  clearTimeout(sendHoverTimer); send.classList.add('is-clicked');
});
send.addEventListener('pointerup', () => send.classList.remove('is-clicked'));
send.addEventListener('pointercancel', () => send.classList.remove('is-clicked'));
feedback.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!send.disabled) composer.requestSubmit(); }
});
composer.addEventListener('submit', async event => {
  event.preventDefault();
  if (!anchor || !feedback.value.trim() || send.disabled || !active?.terminal) return;
  send.disabled = true;
  try {
    const response = await fetch(`/api/workspaces/${active.id}/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: feedback.value, anchor, ...(figmaUrl ? { figmaUrl } : {}) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The request could not be sent.');
    upsertRequest(data.request);
    closeComment(); rail.scrollTop = 0;
  } catch (error) { toast(error.message); updateComposerState(); }
});
hit.addEventListener('pointermove', event => {
  if (!geometry || !composer.hidden) return;
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
  if (event.button !== 0 || !geometry || !composer.hidden) return;
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
hit.addEventListener('pointerleave', () => { if (!drag && composer.hidden) clearShapes(); });
async function openCommit(sha) {
  if (!active?.project?.slug || !/^[a-f0-9]{40}$/.test(sha)) return;
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(active.project.slug)}/workspaces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: sha })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.workspace) throw new Error(data.error || 'Could not open that commit.');
    const url = new URL(data.workspace.viewerUrl, location.href);
    url.searchParams.set('source', historyWorkspaceId);
    location.href = url.href;
  } catch (error) { toast(error.message); }
}
function activateCard(target) {
  if (target.closest('[data-inert]')) return;
  if (target.closest('[data-card-cancel]')) {
    draftSelected = false; saveError = ''; renderHistory(); return;
  }
  if (target.closest('[data-card-save]')) { saveVersion(); return; }
  const draftCard = target.closest('[data-draft-card]');
  if (draftCard) {
    if (!active?.terminal) location.href = `workspace.html?id=${encodeURIComponent(historyWorkspaceId)}`;
    else {
      draftSelected = true;
      renderHistory();
      cards.querySelector('[data-draft-card]')?.focus({ preventScroll: true });
    }
    return;
  }
  const card = target.closest('[data-preview-id]');
  if (card) openCommit(card.dataset.previewId);
}
cards.addEventListener('click', event => activateCard(event.target));
cards.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key) || event.target.closest('button,summary')) return;
  const card = event.target.closest('[data-draft-card],[data-preview-id]');
  if (card) { event.preventDefault(); activateCard(card); }
});
scroll.addEventListener('scroll', positionComposer);
new ResizeObserver(updateGeometry).observe(canvas);
addEventListener('keydown', event => {
  if ($('.review-share-dialog').open) return;
  if (event.key === 'Escape' && !composer.hidden) { closeComment(); return; }
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
