// Pure helpers shared by the UI and dependency-free regression tests.
export const GRID_DEFAULTS = Object.freeze({ enabled: false, size: 8, color: '#BAE6FF', opacity: 50 });
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
export function gridSettings(value = {}) {
  return {
    enabled: value.enabled === true,
    size: Math.round(clamp(value.size != null && Number.isFinite(Number(value.size)) ? value.size : 8, 2, 64)),
    color: /^#[0-9a-f]{6}$/i.test(value.color || '') ? value.color.toUpperCase() : GRID_DEFAULTS.color,
    opacity: Math.round(clamp(value.opacity != null && Number.isFinite(Number(value.opacity)) ? value.opacity : 50, 0, 100))
  };
}
export function chronological(items) {
  return [...items].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}
export function stageGeometry(width, height, viewport, origin = { x: 0, y: 0 }) {
  const scale = Math.min(1, Math.max(0.25, (width - 48) / viewport.width), Math.max(0.25, (height - 128) / viewport.height));
  const rootWidth = origin.width > 0 ? origin.width : viewport.width;
  const rootHeight = origin.height > 0 ? origin.height : viewport.height;
  const x = Math.max(24 - origin.x * scale, (width - rootWidth * scale) / 2 - origin.x * scale);
  const y = Math.max(40 - origin.y * scale, (height - rootHeight * scale) / 2 - 36 - origin.y * scale);
  return { x, y, scale, gridX: x + origin.x * scale, gridY: y + origin.y * scale };
}
export function rootClipPath(viewport, origin, radius = {}) {
  if (!validRect(origin) || origin.width <= 0 || origin.height <= 0) return 'none';
  const left = clamp(origin.x, 0, viewport.width);
  const top = clamp(origin.y, 0, viewport.height);
  const right = clamp(viewport.width - (origin.x + origin.width), 0, viewport.width);
  const bottom = clamp(viewport.height - (origin.y + origin.height), 0, viewport.height);
  const maxRadius = Math.max(0, Math.min(origin.width, origin.height) / 2);
  const corner = key => clamp(Number.isFinite(Number(radius?.[key])) ? Number(radius[key]) : 0, 0, maxRadius);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${corner('topLeft')}px ${corner('topRight')}px ${corner('bottomRight')}px ${corner('bottomLeft')}px)`;
}
export function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
export function validRect(rect) {
  return !!rect && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k]) && Math.abs(rect[k]) < 100000)
    && rect.width >= 0 && rect.height >= 0;
}
export function safeSelection(value) {
  if (!value || !validRect(value.rect)) return null;
  return {
    type: 'selection', rect: value.rect,
    selector: String(value.selector || '').slice(0, 1000),
    tag: String(value.tag || '').slice(0, 40),
    text: String(value.text || '').slice(0, 240),
    scroll: { x: clamp(value.scroll?.x, 0, 100000), y: clamp(value.scroll?.y, 0, 100000) }
  };
}
export function nextVersionLabel(revisions = []) {
  const latest = chronological(revisions.filter(r => r && (r.savedVersion || r.version)))
    .find(r => /^V\d+(?:\.\d+)?$/.test(String(r.savedVersion || r.version || '')));
  const label = String(latest?.savedVersion || latest?.version || '');
  let match = label.match(/^V(\d+)\.(\d+)$/);
  if (match) return `V${match[1]}.${Number(match[2]) + 1}`;
  match = label.match(/^V(\d+)$/);
  if (match) return `V${Number(match[1]) + 1}`;
  return 'V1';
}
export function reloadTarget(revisions, activeId) {
  const latest = chronological(revisions)[0];
  return latest && latest.id !== activeId ? latest : null;
}
