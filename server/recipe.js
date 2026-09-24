// The preview recipe: `.dialogue/preview.json` in a project's repository says
// how Dialogue serves a live preview of it. Written by the agent during
// preview setup, versioned with the code, read per ref. Node builtins only.
const path = require('node:path');

const RECIPE_PATH = '.dialogue/preview.json';
const KINDS = new Set(['static', 'server']);
const RELOADS = new Set(['dialogue', 'self']);

function optionalCommand(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`"${name}" must be a non-empty shell command or omitted.`);
  return value;
}

// Parse and normalise recipe text. Never throws: { ok, recipe } or { ok, error }
// so the setup pipeline can hand the message back to the agent verbatim.
function parseRecipe(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `${RECIPE_PATH} is not valid JSON: ${error.message}` };
  }
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The recipe must be a JSON object.');
    if (raw.version !== 1) throw new Error('"version" must be 1.');
    if (!KINDS.has(raw.kind)) throw new Error('"kind" must be "static" or "server".');

    const rootInput = raw.root ?? '.';
    if (typeof rootInput !== 'string' || path.isAbsolute(rootInput)) throw new Error('"root" must be a path relative to the repository.');
    const root = path.posix.normalize(rootInput.replace(/\\/g, '/')).replace(/\/+$/, '') || '.';
    if (root === '..' || root.startsWith('../')) throw new Error('"root" must stay inside the repository.');

    const entry = raw.entry ?? '/';
    if (typeof entry !== 'string' || !entry.startsWith('/')) throw new Error('"entry" must be a URL path starting with "/".');

    const reload = raw.reload ?? 'dialogue';
    if (!RELOADS.has(reload)) throw new Error('"reload" must be "dialogue" or "self".');

    const readyTimeoutSeconds = raw.readyTimeoutSeconds ?? 120;
    if (!Number.isInteger(readyTimeoutSeconds) || readyTimeoutSeconds < 1 || readyTimeoutSeconds > 1800) {
      throw new Error('"readyTimeoutSeconds" must be a whole number between 1 and 1800.');
    }

    const install = optionalCommand(raw.install, 'install');
    const start = optionalCommand(raw.start, 'start');
    if (raw.kind === 'server' && !start) throw new Error('A "server" recipe needs a "start" command that listens on $PORT.');

    return { ok: true, recipe: { version: 1, kind: raw.kind, root, install, start, entry, reload, readyTimeoutSeconds } };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// A recipe for the common simple case, tried before asking the agent: plain
// HTML with no package.json anywhere (a package.json usually means a build
// step or dev server the agent should work out). Prefers the conventional
// prototypes/app, then the shallowest index.html. `paths`: tracked files.
function guessStaticRecipe(paths) {
  if (paths.some((p) => p === 'package.json' || p.endsWith('/package.json'))) return null;
  const dirs = paths
    .filter((p) => p === 'index.html' || p.endsWith('/index.html'))
    .map((p) => p.slice(0, -'index.html'.length).replace(/\/$/, ''));
  if (!dirs.length) return null;
  const depth = (dir) => (dir ? dir.split('/').length : 0);
  const root = dirs.includes('prototypes/app') ? 'prototypes/app' : dirs.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0];
  return `${JSON.stringify({ version: 1, kind: 'static', root: root || '.', entry: '/', reload: 'dialogue' }, null, 2)}\n`;
}

module.exports = { RECIPE_PATH, guessStaticRecipe, parseRecipe };
