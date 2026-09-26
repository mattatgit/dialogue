import { gridSettings } from './review-model.mjs';
const KEY = 'dialogue.review.grid.v1';
let persisted = true;
export const preferencesPersisted = () => persisted;
export function readGrid() {
  try { return gridSettings(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return gridSettings(); }
}
export function writeGrid(value) {
  const settings = gridSettings(value);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); persisted = true; }
  catch { persisted = false; }
  window.dispatchEvent(new CustomEvent('dialogue:grid', { detail: settings }));
  return settings;
}
