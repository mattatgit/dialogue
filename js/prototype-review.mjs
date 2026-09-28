import { chronological, stageGeometry, rootClipPath, rectFromPoints, validRect, safeSelection, nextVersionLabel, clamp } from './review-model.mjs';
import { readGrid, writeGrid } from './review-preferences.mjs';
import { MockReviewAdapter } from './review-adapter.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canvas = $('.review-canvas'), plane = $('.review-plane'), scroll = $('.review-scroll');
const frame = $('[data-review-frame]'), host = $('.review-frame-host'), hit = $('.review-hit-layer');
const rail = $('.review-history'), cards = $('[data-history-items]'), composer = $('[data-comment-form]');
const feedback = $('#review-comment'), send = $('.composer-send'), loadState = $('[data-load-state]');
const shape = $('[data-selection-rect]'), arrow = $('[data-selection-arrow]');
const viewport = { width: 370, height: 722 };
let viewScroll = { x: 0, y: 0 };
let grid = readGrid(), origin = { x: 0, y: 0 }, rootRadius = {}, geometry, mode = 'test', tool = 'selection';
let realRevisions = [], active = null, selectedId = null, adapter = null, anchor = null, drag = null;
let channel = '', bridgeReady = false, loadSequence = 0, probeId = 0, selectedProbe = 0;
let saveConfirmation = null, seenSimulationResults = new Set();
let loadTimer, pollTimer, toastTimer, sendHoverTimer, saveTimer, hoverPending = false, unavailableWarning = false;

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
const allRevisions = () => chronological([...realRevisions, ...(adapter?.listRevisions() || []).filter(r => realRevisions.some(source => source.id === r.sourceRevisionId))]);
const revisionById = id => allRevisions().find(r => r.id === id);
const sourceId = revision => revision.sourceRevisionId || revision.id;

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
  if (adapter?.isBusy) { toast('Wait for the simulation to finish, or cancel it in the activity card.'); return; }
  anchor = { ...structuredClone(value), baseRevisionId: active.id, sourceRevisionId: sourceId(active),
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
  composer.hidden = true; feedback.value = ''; send.disabled = true; resetSendState(); composer.dataset.state = 'default'; delete composer.dataset.anchorType;
  composer.style.removeProperty('--arrow-terminal-x'); composer.style.removeProperty('--arrow-terminal-y');
  anchor = null; clearShapes(); return true;
}
function mayNavigate() { return composer.hidden || closeComment(); }
function setMode(next) {
  if (mode === next) return;
  if (next === 'test' && !mayNavigate()) return;
  mode = next; document.body.dataset.mode = mode;
  $$('[data-mode-button]').forEach(b => b.setAttribute('aria-pressed', b.dataset.modeButton === mode));
  rail.hidden = mode !== 'comment'; hit.hidden = mode !== 'comment' || !active;
  $('.review-tools').hidden = mode !== 'comment' || !active;
  updateGeometry(); if (mode === 'comment') requestAnimationFrame(alignActive);
}
function setTool(next) {
  if (!mayNavigate()) return;
  tool = next; hit.dataset.tool = next;
  $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === tool));
}
function sendBridge(detail) {
  if (channel) frame.contentWindow?.postMessage({ scope: 'dialogue-review', channel, ...detail }, '*');
}
function probe(point, action) {
  if (!bridgeReady) {
    if (action === 'select') toast('Element selection is unavailable in this page. Use Area or Arrow instead.');
    return;
  }
  const id = ++probeId; if (action === 'select') selectedProbe = id;
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
function historyState() {
  const requests = adapter?.listRequests() || [];
  const completed = chronological(requests.filter(r => r.result).map(r => ({ ...r.result, createdAt: r.result.createdAt || r.createdAt })));
  const latest = completed[0];
  return { requests, draftId: latest && !latest.savedVersion ? latest.id : null };
}
function timelineLabel(revision, draftId) {
  if (!revision) return '';
  if (!revision.simulated) return revision.version || 'Version';
  if (saveConfirmation?.id === revision.id) return 'Draft';
  if (revision.savedVersion) return revision.savedVersion;
  return revision.id === draftId ? 'Draft' : 'Edited';
}
function badgeClass(revision, draftId) {
  const label = timelineLabel(revision, draftId);
  if (label === 'Draft') return 'badge-draft';
  if (label === 'Edited') return 'badge-edited';
  return revision ? 'badge-version' : '';
}
function updateReviewTitle(revision, draftId) {
  if (!revision) return;
  const title = revision.simulated
    ? `${revision.prototype?.name || 'Prototype'} ${timelineLabel(revision, draftId)} (simulated preview)`
    : (revision.title || `${revision.prototype?.name || 'Prototype'} ${revision.version}`);
  $('[data-review-title]').textContent = title;
  document.title = `Dialogue - ${title}`;
}
function renderHistory() {
  const oldTop = rail.scrollTop;
  const { requests, draftId } = historyState();
  const entries = allRevisions().map(revision => ({ revision,
    request: requests.find(r => r.result?.id === revision.id), createdAt: revision.savedAt || revision.createdAt, id: revision.id }));
  for (const request of requests.filter(r => !r.result)) entries.push({ request, id: request.id, createdAt: request.createdAt });
  cards.innerHTML = chronological(entries).map(({ revision, request, id }) => {
    const current = revision?.id === active?.id;
    const status = request?.status, working = ['queued', 'working'].includes(status);
    const isDraft = !!revision && (revision.id === draftId || saveConfirmation?.id === revision.id);
    const showActions = isDraft && current && selectedId === id;
    const confirming = showActions && saveConfirmation?.id === id;
    const label = revision ? timelineLabel(revision, draftId)
      : (status === 'working' ? 'Working' : status === 'queued' ? 'Queued' : status === 'cancelled' ? 'Cancelled' : 'Failed');
    const timestamp = confirming ? request?.createdAt : (revision?.savedAt || request?.createdAt || revision?.createdAt);
    const actionButtons = showActions ? `<div class="card-actions"><button class="review-button" data-card-cancel>Cancel</button><button class="review-button primary save-version-button ${confirming ? 'is-saved' : ''}" data-card-save="${esc(id)}" ${confirming ? 'disabled' : ''}>${confirming ? 'Saved version' : 'Save version'}</button></div>` : '';
    const content = `<p>${esc(request?.feedback || (revision?.source === 'manual-zip-import' ? 'Imported prototype' : 'Published prototype revision'))}</p>
      ${request ? `<h3>Activity</h3><ul>${request.events.map(e => `<li>${esc(typeof e === 'string' ? e : e.message)}</li>`).join('')}</ul>` : ''}
      ${request?.result ? '<h3>Changes</h3><p>Unchanged base preview. No LLM call or file edits were made.</p>' : ''}
      ${working ? `<p class="activity-status working">${status === 'queued' ? 'Waiting for simulation' : 'Simulation in progress'}</p><button class="review-button retry-button" data-request-cancel="${esc(request.id)}">Cancel</button>` : ''}
      ${['failed', 'cancelled'].includes(status) ? `<p class="activity-error">${esc(request.error)}</p><button class="review-button retry-button" data-request-retry="${esc(request.id)}">Retry</button>` : ''}
      ${request ? `<small>Simulated connection${request.anchor?.type ? ' / ' + esc(request.anchor.type) : ''}</small>` : '<small>No linked feedback for this existing revision.</small>'}`;
    return `<article class="activity-card ${current ? 'is-active' : ''} ${showActions ? 'has-actions' : ''}" data-card-id="${esc(id)}" ${current ? 'aria-current="true"' : ''} aria-busy="${working}" tabindex="0" aria-label="${esc(revision ? label + ' activity' : label + ' request')}">
      <div class="activity-meta"><span class="revision-badge ${badgeClass(revision, draftId)}">${esc(label)}</span><time datetime="${esc(timestamp)}">${esc(formatTime(timestamp))}</time></div>
      <div class="activity-content">${content}</div>${actionButtons}</article>`;
  }).join('');
  const last = cards.lastElementChild;
  $('.history-spacer').style.height = `${Math.max(0, rail.clientHeight - (last?.offsetHeight || 0) - 8)}px`;
  rail.scrollTop = oldTop;
  updateReviewTitle(active, draftId);
}
function alignActive() {
  if (rail.hidden || !active) return;
  renderHistory();
  const card = [...cards.children].find(el => el.dataset.cardId === active.id);
  if (card) rail.scrollTo({ top: card.offsetTop, behavior: 'auto' });
}
async function loadRevision(revision, { replace = false } = {}) {
  if (!revision || !mayNavigate()) return;
  const sequence = ++loadSequence;
  selectedId = null; active = revision; viewScroll = { x: 0, y: 0 }; origin = { x: 0, y: 0 }; rootRadius = {}; bridgeReady = false; unavailableWarning = false;
  channel = [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
  updateReviewTitle(revision, historyState().draftId);
  const projectLink = $('[data-project-link]'); projectLink.textContent = revision.project?.name || 'Project';
  projectLink.href = `project-landline.html?project=${encodeURIComponent(revision.project?.slug || 'landline')}`;
  const url = new URL(location.href); url.searchParams.set('revision', sourceId(revision));
  if (revision.simulated) url.searchParams.set('preview', revision.id); else url.searchParams.delete('preview');
  history[replace ? 'replaceState' : 'pushState']({ revisionId: revision.id }, '', url);
  const path = String(revision.entryPoint || 'index.html').split('/').map(encodeURIComponent).join('/');
  frame.src = `/prototype-files/${encodeURIComponent(sourceId(revision))}/${path}?reviewChannel=${channel}`;
  host.hidden = false; loadState.hidden = false; loadState.textContent = 'Loading prototype...'; loadState.classList.remove('error');
  updateGeometry(); renderHistory(); requestAnimationFrame(alignActive);
  $('[data-reload]').disabled = false; $('[data-review-share]').disabled = false;
  hit.hidden = mode !== 'comment'; $('.review-tools').hidden = mode !== 'comment';
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => { if (sequence === loadSequence) { loadState.hidden = true; if (!bridgeReady) toast('Element inspection is unavailable. Check the preview, or use Area and Arrow.'); } }, 5000);
}
async function restartPrototype() {
  if (!active || !mayNavigate()) return;
  await loadRevision(active, { replace: true });
  toast('Prototype restarted');
}
async function refreshRevisions() {
  if (!active || !adapter) return;
  const body = await json(`/api/projects/${encodeURIComponent(active.project.slug)}/revisions`);
  const revisions = body.revisions.filter(r => r.prototype?.id === active.prototype?.id);
  if (JSON.stringify(realRevisions) === JSON.stringify(revisions)) return;
  const previous = new Set(realRevisions.map(r => r.id));
  const added = revisions.some(r => !previous.has(r.id));
  realRevisions = revisions; renderHistory();
  if (added) toast('A new saved version is available in Activity.');
}

addEventListener('message', event => {
  const m = event.data;
  if (event.source !== frame.contentWindow || m?.scope !== 'dialogue-review' || m.channel !== channel) return;
  // Sandboxed documents have opaque ("null") origins. Source + per-load channel
  // binds messages to this iframe, but all supplied values remain untrusted data.
  if (m.type === 'layout' && validRect(m.origin)) {
    bridgeReady = true; loadState.hidden = true; clearTimeout(loadTimer);
    viewScroll = { x: clamp(m.scroll?.x, 0, 100000), y: clamp(m.scroll?.y, 0, 100000) };
    origin = { x: clamp(m.origin.x, -viewport.width, viewport.width), y: clamp(m.origin.y, -viewport.height, viewport.height),
      width: clamp(m.origin.width, 0, viewport.width * 4), height: clamp(m.origin.height, 0, viewport.height * 4) };
    rootRadius = m.radius && typeof m.radius === 'object' ? m.radius : {};
    updateGeometry();
  } else if (m.type === 'selection' && mode === 'comment' && tool === 'selection' && composer.hidden) {
    const selection = safeSelection(m.selection); if (!selection) return;
    if (m.action === 'select' && m.requestId === selectedProbe) openComment(selection);
    else if (m.action === 'hover') drawAnchor(selection);
  } else if (m.type === 'restart-shortcut' && mode === 'test' && $('.review-share-dialog').open === false) restartPrototype();
});
frame.addEventListener('load', () => { bridgeReady = false; sendBridge({ type: 'measure' }); });
$$('[data-mode-button]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.modeButton)));
$$('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('[data-grid-toggle]').addEventListener('click', () => { grid = writeGrid({ ...grid, enabled: !grid.enabled }); gridButton(); updateGeometry(); });
addEventListener('storage', () => { grid = readGrid(); gridButton(); updateGeometry(); });
$('[data-reload]').addEventListener('click', restartPrototype);
$('[data-close-comment]').addEventListener('click', () => closeComment());
feedback.addEventListener('focus', updateComposerState);
feedback.addEventListener('blur', updateComposerState);
feedback.addEventListener('input', () => { updateComposerState(); positionComposer(); });
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
  event.preventDefault(); if (!anchor || !feedback.value.trim() || send.disabled) return;
  try {
    send.disabled = true;
    await adapter.createRequest({ base: active, feedback: feedback.value, anchor, scenario: $('[data-simulation-scenario]').value });
    closeComment(); rail.scrollTop = 0;
    if (adapter.storageAvailable === false) toast('Browser storage is unavailable. Simulation history is session-only.');
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
cards.addEventListener('click', event => {
  const save = event.target.closest('[data-card-save]'), cancel = event.target.closest('[data-card-cancel]');
  const stop = event.target.closest('[data-request-cancel]'), retry = event.target.closest('[data-request-retry]');
  if (cancel) { selectedId = null; renderHistory(); return; }
  if (save) {
    const id = save.dataset.cardSave, { draftId } = historyState();
    if (id !== draftId || active?.id !== id || saveConfirmation) return;
    const version = nextVersionLabel([...realRevisions, ...(adapter?.listRevisions() || []).filter(r => r.savedVersion)]);
    saveConfirmation = { id, version }; selectedId = id;
    adapter.saveVersion(id, version); renderHistory();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const stillViewing = active?.id === id;
      saveConfirmation = null; selectedId = null;
      if (stillViewing) active = revisionById(id) || active;
      renderHistory();
    }, 2000);
    return;
  }
  if (stop) { adapter.cancel(stop.dataset.requestCancel); return; }
  if (retry) { adapter.retry(retry.dataset.requestRetry); return; }
  const card = event.target.closest('[data-card-id]'), revision = card && revisionById(card.dataset.cardId);
  if (!revision) return;
  const { draftId } = historyState();
  if (revision.id === draftId && active?.id === draftId) {
    selectedId = revision.id; renderHistory(); return;
  }
  if (revision.id !== active?.id) loadRevision(revision);
});
cards.addEventListener('keydown', event => {
  if (!event.target.matches('.activity-card') || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault(); event.target.click();
  if (selectedId) [...cards.children].find(c => c.dataset.cardId === selectedId)?.querySelector('[data-card-save]')?.focus();
});
scroll.addEventListener('scroll', positionComposer);
new ResizeObserver(updateGeometry).observe(canvas);
addEventListener('keydown', event => {
  if ($('.review-share-dialog').open) return;
  if (event.key === 'Escape') { if (!composer.hidden) closeComment(); else { selectedId = null; renderHistory(); } return; }
  if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.target.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); restartPrototype(); }
});
addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search), id = params.get('preview') || params.get('revision');
  const revision = revisionById(id); if (revision) loadRevision(revision, { replace: true });
});
const dialog = $('.review-share-dialog');
$('[data-review-share]').addEventListener('click', () => {
  const url = new URL('prototype.html', location.href); url.searchParams.set('revision', sourceId(active));
  $('[data-share-url]').value = url.href; dialog.showModal();
});
$('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
$('[data-copy-local]').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('[data-share-url]').value); $('[data-copy-local]').textContent = 'Copied!'; setTimeout(() => { $('[data-copy-local]').textContent = 'Copy'; }, 3000); }
  catch { $('[data-share-url]').select(); toast('Copy the selected local link.'); }
});
addEventListener('pagehide', event => {
  // Cached pages resume with their listeners intact; a discarded page cancels its mock.
  if (!event.persisted) { clearInterval(pollTimer); adapter?.dispose(); }
});
gridButton(); setTool('selection');
try {
  const id = new URLSearchParams(location.search).get('revision');
  if (!id) throw new Error('Open a revision from your project to review it.');
  const { revision } = await json(`/api/revisions/${encodeURIComponent(id)}`);
  if (!revision?.project || !revision?.prototype) throw new Error('This revision has incomplete metadata.');
  const body = await json(`/api/projects/${encodeURIComponent(revision.project.slug)}/revisions`);
  realRevisions = body.revisions.filter(r => r.prototype?.id === revision.prototype.id);
  adapter = new MockReviewAdapter(revision.prototype.id);
  seenSimulationResults = new Set(adapter.listRevisions().map(r => r.id));
  adapter.subscribe(() => {
    const revisions = adapter.listRevisions();
    const fresh = chronological(revisions.filter(r => !seenSimulationResults.has(r.id)))[0];
    revisions.forEach(r => seenSimulationResults.add(r.id));
    renderHistory();
    if (fresh) {
      const request = adapter.listRequests().find(r => r.result?.id === fresh.id);
      if (request?.base?.id === active?.id) loadRevision(fresh, { replace: true });
    }
  });
  const preview = new URLSearchParams(location.search).get('preview');
  await loadRevision(revisionById(preview) || revision, { replace: true });
  pollTimer = setInterval(() => refreshRevisions().catch(() => {
    if (!unavailableWarning) { unavailableWarning = true; toast('Dialogue is offline. The current preview is kept; revision checks will retry.'); }
  }), 5000);
} catch (error) { loadState.hidden = false; loadState.textContent = error.message; loadState.classList.add('error'); }
