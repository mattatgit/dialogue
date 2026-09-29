// Runs INSIDE the existing opaque sandbox. Reports metadata only; never edits files,
// starts an LLM, reads form values, or gains access to the parent application DOM.
(() => {
  'use strict';
  const script = document.currentScript;
  const channel = script?.dataset.reviewChannel;
  if (!/^[a-f0-9]{32}$/.test(channel || '') || window.parent === window) return;
  const parentOrigin = new URL(script.src).origin;
  const send = (type, detail = {}) => window.parent.postMessage({ scope: 'dialogue-review', channel, type, ...detail }, parentOrigin);
  const rect = el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const cornerRadius = el => {
    const style = getComputedStyle(el);
    const px = value => {
      const parts = String(value || '').trim().split(/\s+/);
      if (!parts.length || parts.some(part => !/^-?\d+(?:\.\d+)?px$/.test(part))) return 0;
      return Math.max(0, Math.min(...parts.map(part => Number.parseFloat(part))));
    };
    return {
      topLeft: px(style.borderTopLeftRadius),
      topRight: px(style.borderTopRightRadius),
      bottomRight: px(style.borderBottomRightRadius),
      bottomLeft: px(style.borderBottomLeftRadius)
    };
  };
  const usable = el => el instanceof Element && !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName)
    && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  function root() {
    // Explicit annotation wins. Known prototype/device roots come before generic
    // app/page wrappers so a full-viewport stage/backdrop is not mistaken for the
    // reviewable prototype UI. Landline uses .stage > .landline, with the stage
    // intentionally carrying the dark presentation background.
    // Otherwise use a visible app root, then the sole meaningful body child.
    // Multiple-root documents use their viewport origin.
    for (const selector of ['[data-dialogue-root]', '.landline-device', '.landline', '#app', '#root', '.app', 'main']) {
      const named = document.querySelector(selector); if (usable(named)) return named;
    }
    const children = [...(document.body?.children || [])].filter(usable);
    return children.length === 1 ? children[0] : null;
  }
  function layout() {
    const el = root();
    send('layout', {
      origin: el ? rect(el) : { x: 0, y: 0, width: innerWidth, height: innerHeight },
      radius: el ? cornerRadius(el) : { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY }
    });
  }
  function selectorFor(el) {
    const parts = [];
    for (let n = el; n && n !== document.documentElement && parts.length < 10; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.localName;
      if (n.parentElement) {
        const siblings = [...n.parentElement.children].filter(s => s.localName === n.localName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(n) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(' > ').slice(0, 1000);
  }
  addEventListener('message', event => {
    const m = event.data;
    if (event.source !== parent || event.origin !== parentOrigin || m?.scope !== 'dialogue-review' || m.channel !== channel) return;
    if (m.type === 'measure') { layout(); return; }
    if (m.type !== 'probe' || !Number.isFinite(m.x) || !Number.isFinite(m.y) || !['hover', 'select'].includes(m.action)) return;
    if (m.x < 0 || m.y < 0 || m.x >= innerWidth || m.y >= innerHeight) return;
    const el = document.elementFromPoint(m.x, m.y);
    if (!usable(el)) return;
    // No input values, HTML source, cookies, or storage are included in a selection.
    send('selection', { action: m.action, requestId: m.requestId, selection: {
      rect: rect(el), selector: selectorFor(el), tag: el.localName,
      text: ['INPUT', 'TEXTAREA'].includes(el.tagName) ? '' : (el.textContent || '').trim().slice(0, 240),
      scroll: { x: scrollX, y: scrollY }
    }});
  });
  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; layout(); }); } };
  addEventListener('load', layout);
  addEventListener('resize', schedule);
  addEventListener('scroll', schedule, true);
  addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'r' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    event.preventDefault(); send('restart-shortcut');
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    layout(); const el = root(); if (el) new ResizeObserver(schedule).observe(el);
  });
})();
