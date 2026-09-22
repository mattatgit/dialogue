#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

function usage() {
  console.log(`Usage: node scripts/publish-revision.js <prototype.zip> [options]\n\nOptions:\n  --base <url>       Dialogue base URL (default http://127.0.0.1:4173)\n  --project <slug>   Project slug (default landline)\n  --name <name>      Prototype name (default Landline)\n  --version <Vn>     Revision version; omitted = next numeric version\n  --help             Show this help\n`);
}

function parseArgs(argv) {
  const options = {
    base: 'http://127.0.0.1:4173',
    project: 'landline',
    name: 'Landline',
    version: ''
  };
  let zipPath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (!['base', 'project', 'name', 'version'].includes(key)) {
        throw new Error(`Unknown option: ${arg}`);
      }
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[key] = value;
      index += 1;
      continue;
    }
    if (zipPath) throw new Error('Only one ZIP package can be published at a time.');
    zipPath = arg;
  }

  if (!zipPath) throw new Error('Choose a prototype ZIP package to publish.');
  options.base = options.base.replace(/\/$/, '');
  return { zipPath, options };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!response.ok) {
    throw new Error(payload.error || `Dialogue returned HTTP ${response.status}.`);
  }
  return payload;
}

async function nextVersion(base, project, prototypeName) {
  const payload = await jsonRequest(`${base}/api/projects/${encodeURIComponent(project)}/revisions`);
  const revisions = Array.isArray(payload.revisions) ? payload.revisions : [];
  const numbers = revisions
    .filter((revision) => (revision.prototype?.name || '').toLowerCase() === prototypeName.toLowerCase())
    .map((revision) => /^v?(\d+)$/i.exec(revision.version || ''))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return `V${numbers.length ? Math.max(...numbers) + 1 : 1}`;
}

async function main() {
  const { zipPath, options } = parseArgs(process.argv.slice(2));
  const absoluteZip = path.resolve(zipPath);

  if (path.extname(absoluteZip).toLowerCase() !== '.zip') {
    throw new Error('The prototype package must be a .zip file.');
  }

  let stat;
  try {
    stat = await fs.stat(absoluteZip);
  } catch {
    throw new Error(`Could not find the ZIP package: ${absoluteZip}`);
  }
  if (!stat.isFile()) throw new Error('The selected ZIP path is not a file.');

  try {
    await jsonRequest(`${options.base}/api/health`);
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(error.message)) {
      throw new Error(`Dialogue is not running at ${options.base}. Start Dialogue first, then try again.`);
    }
    throw error;
  }

  const version = options.version || await nextVersion(options.base, options.project, options.name);
  const bytes = await fs.readFile(absoluteZip);
  const query = new URLSearchParams({
    name: options.name,
    version,
    source: 'local-api-test-client'
  });

  const payload = await jsonRequest(
    `${options.base}/api/projects/${encodeURIComponent(options.project)}/import?${query.toString()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip',
        'X-Dialogue-Client': 'local-api-test-client'
      },
      body: bytes
    }
  );

  const revision = payload.revision || {};
  console.log('');
  console.log(`Published ${revision.title || `${options.name} ${version}`} through the Dialogue API.`);
  console.log(`Revision ID: ${revision.id || 'unknown'}`);
  if (revision.viewerUrl) console.log(`Viewer: ${options.base}${revision.viewerUrl}`);
}

main().catch((error) => {
  console.error('');
  console.error(`Publish failed: ${error.message}`);
  process.exitCode = 1;
});
