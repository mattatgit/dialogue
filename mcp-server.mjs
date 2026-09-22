#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(ROOT, '.dialogue-data');
const DIALOGUE_BASE = process.env.DIALOGUE_BASE_URL || 'http://127.0.0.1:4173';
const ZIP_BIN = process.env.DIALOGUE_ZIP || '/usr/bin/zip';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_EDITS = 25;
const REVISION_MANIFEST_NAME = '.dialogue-revision.json';

const TEXT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.svg',
  '.txt',
  '.md',
  '.xml'
]);

function toolJson(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  };
}

async function dialogueFetch(pathname, options = {}) {
  const url = new URL(pathname, `${DIALOGUE_BASE.replace(/\/$/, '')}/`);
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { text };
    }
  }
  if (!response.ok) {
    const message = body?.error || body?.text || `Dialogue API returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body || {};
}

function publicRevision(revision) {
  return {
    id: revision.id,
    version: revision.version,
    title: revision.title,
    createdAt: revision.createdAt,
    importedAt: revision.importedAt,
    entryPoint: revision.entryPoint,
    source: revision.source,
    fileCount: revision.fileCount,
    prototype: revision.prototype,
    project: revision.project,
    viewerUrl: revision.viewerUrl
  };
}

async function getRevisionRecord(revisionId) {
  const body = await dialogueFetch(`/api/revisions/${encodeURIComponent(revisionId)}`);
  if (!body.revision) throw new Error('Dialogue did not return a revision record.');
  return body.revision;
}

function safeRevisionBaseDir(revision) {
  if (!revision.storageKey) throw new Error('This revision has no local storage key.');
  const baseDir = path.resolve(DATA_ROOT, revision.storageKey);
  const prefix = `${DATA_ROOT}${path.sep}`;
  if (baseDir !== DATA_ROOT && !baseDir.startsWith(prefix)) {
    throw new Error('Revision storage path is outside Dialogue local data.');
  }
  return baseDir;
}

function normaliseRelativePath(relativePath) {
  const value = String(relativePath || '').replace(/\\/g, '/').trim();
  if (!value || value.startsWith('/') || /^[A-Za-z]:\//.test(value) || value.includes('\0')) {
    throw new Error('A safe relative prototype file path is required.');
  }
  const segments = value.split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '..')) {
    throw new Error('Prototype file path may not leave the revision directory.');
  }
  const safePath = segments.join('/');
  if (safePath === REVISION_MANIFEST_NAME) {
    throw new Error('Dialogue revision metadata is reserved and may not be read or edited through the prototype-file tools.');
  }
  return safePath;
}

function resolveRevisionFile(baseDir, relativePath) {
  const safePath = normaliseRelativePath(relativePath);
  const absolute = path.resolve(baseDir, ...safePath.split('/'));
  const prefix = `${baseDir}${path.sep}`;
  if (absolute !== baseDir && !absolute.startsWith(prefix)) {
    throw new Error('Prototype file path is outside the revision directory.');
  }
  return { safePath, absolute };
}

function isEditableTextPath(relativePath) {
  return TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

async function walkRevisionFiles(baseDir, current = baseDir, results = []) {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === '__MACOSX' ||
      entry.name === '.DS_Store' ||
      entry.name === REVISION_MANIFEST_NAME ||
      entry.name.startsWith('._')
    ) continue;
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkRevisionFiles(baseDir, absolute, results);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fsp.stat(absolute);
    const relativePath = path.relative(baseDir, absolute).split(path.sep).join('/');
    results.push({
      path: relativePath,
      bytes: stat.size,
      editableText: isEditableTextPath(relativePath) && stat.size <= MAX_TEXT_BYTES
    });
  }
  return results;
}

async function readRevisionText(baseDir, relativePath) {
  const { safePath, absolute } = resolveRevisionFile(baseDir, relativePath);
  if (!isEditableTextPath(safePath)) {
    throw new Error(`${safePath} is not an editable text file in this development bridge.`);
  }
  const stat = await fsp.lstat(absolute).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`${safePath} is not a regular file.`);
  if (stat.size > MAX_TEXT_BYTES) {
    throw new Error(`${safePath} is larger than the ${MAX_TEXT_BYTES} byte MCP text-file limit.`);
  }
  return { path: safePath, content: await fsp.readFile(absolute, 'utf8'), bytes: stat.size };
}

function numericVersion(value) {
  const match = /^v?(\d+)$/i.exec(String(value || '').trim());
  return match ? Number(match[1]) : null;
}

function normaliseRequestedVersion(value) {
  if (!value) return null;
  const number = numericVersion(value);
  if (number === null) throw new Error('Revision version must be numeric, for example V24.');
  return `V${number}`;
}

async function nextRevisionVersion(projectSlug, prototypeId) {
  const body = await dialogueFetch(`/api/projects/${encodeURIComponent(projectSlug)}/revisions`);
  const numbers = (body.revisions || [])
    .filter((revision) => revision.prototype?.id === prototypeId)
    .map((revision) => numericVersion(revision.version))
    .filter((value) => value !== null);
  return `V${numbers.length ? Math.max(...numbers) + 1 : 1}`;
}

async function applyReplacement(workDir, edit) {
  const { safePath, absolute } = resolveRevisionFile(workDir, edit.path);
  if (!isEditableTextPath(safePath)) throw new Error(`${safePath} is not an editable text file.`);
  if (!edit.search) throw new Error(`Replacement search text for ${safePath} may not be empty.`);
  const current = await fsp.readFile(absolute, 'utf8').catch(() => null);
  if (current === null) throw new Error(`${safePath} does not exist in the base revision.`);
  const occurrences = current.split(edit.search).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Replacement in ${safePath} expected exactly one match, found ${occurrences}.`);
  }
  const updated = current.replace(edit.search, edit.replacement);
  if (Buffer.byteLength(updated, 'utf8') > MAX_TEXT_BYTES) {
    throw new Error(`${safePath} would exceed the MCP text-file size limit after editing.`);
  }
  await fsp.writeFile(absolute, updated, 'utf8');
  return safePath;
}

async function applyWrite(workDir, edit) {
  const { safePath, absolute } = resolveRevisionFile(workDir, edit.path);
  if (!isEditableTextPath(safePath)) throw new Error(`${safePath} is not an editable text file.`);
  if (Buffer.byteLength(edit.content, 'utf8') > MAX_TEXT_BYTES) {
    throw new Error(`${safePath} exceeds the MCP text-file size limit.`);
  }
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, edit.content, 'utf8');
  return safePath;
}

async function publishDerivedRevision({ baseRevisionId, version, replacements = [], writes = [], summary }) {
  if (!replacements.length && !writes.length) {
    throw new Error('publish_revision requires at least one replacement or file write.');
  }
  if (replacements.length + writes.length > MAX_TOOL_EDITS) {
    throw new Error(`publish_revision accepts at most ${MAX_TOOL_EDITS} file edits per call.`);
  }

  const baseRevision = await getRevisionRecord(baseRevisionId);
  if (!baseRevision.project?.slug || !baseRevision.prototype?.id || !baseRevision.prototype?.name) {
    throw new Error('Base revision is missing project/prototype context.');
  }

  const baseDir = safeRevisionBaseDir(baseRevision);
  const baseStat = await fsp.stat(baseDir).catch(() => null);
  if (!baseStat?.isDirectory()) throw new Error('Base revision files are not available on this Mac.');

  const requestedVersion = normaliseRequestedVersion(version);
  const newVersion = requestedVersion || await nextRevisionVersion(baseRevision.project.slug, baseRevision.prototype.id);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-mcp-'));
  const workDir = path.join(tempRoot, 'prototype');
  const zipPath = path.join(tempRoot, 'prototype.zip');
  const changed = [];

  try {
    await fsp.cp(baseDir, workDir, { recursive: true, force: true, errorOnExist: false });

    for (const edit of replacements) changed.push(await applyReplacement(workDir, edit));
    for (const edit of writes) changed.push(await applyWrite(workDir, edit));

    try {
      await execFileAsync(
        ZIP_BIN,
        [
          '-qr',
          zipPath,
          '.',
          '-x',
          '__MACOSX/*',
          '*/__MACOSX/*',
          '.DS_Store',
          '*/.DS_Store',
          '._*',
          '*/._*',
          REVISION_MANIFEST_NAME,
          `*/${REVISION_MANIFEST_NAME}`
        ],
        { cwd: workDir, maxBuffer: 8 * 1024 * 1024 }
      );
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`Could not find zip at ${ZIP_BIN}.`);
      throw new Error('Could not package the derived prototype revision.');
    }

    const zipBytes = await fsp.readFile(zipPath);
    const query = new URLSearchParams({ name: baseRevision.prototype.name, version: newVersion });
    const body = await dialogueFetch(
      `/api/projects/${encodeURIComponent(baseRevision.project.slug)}/import?${query.toString()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: zipBytes
      }
    );

    return {
      revision: publicRevision(body.revision),
      derivedFromRevisionId: baseRevision.id,
      changedFiles: [...new Set(changed)],
      summary: summary || null,
      publishedVia: 'dialogue-local-mcp-bridge'
    };
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function createServer() {
  const server = new McpServer({
    name: 'dialogue-local',
    version: '0.1.0'
  });

  server.registerTool(
    'list_projects',
    {
      title: 'List Dialogue projects',
      description: 'List the projects currently available in the local Dialogue build.',
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => {
      const body = await dialogueFetch('/api/projects');
      return toolJson({ projects: body.projects || [] });
    }
  );

  server.registerTool(
    'list_revisions',
    {
      title: 'List prototype revisions',
      description: 'List Dialogue prototype revisions in a project, newest first.',
      inputSchema: z.object({
        project_slug: z.string().min(1).describe('Dialogue project slug, for example landline')
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ project_slug }) => {
      const body = await dialogueFetch(`/api/projects/${encodeURIComponent(project_slug)}/revisions`);
      return toolJson({
        project: body.project,
        revisions: (body.revisions || []).map(publicRevision)
      });
    }
  );

  server.registerTool(
    'get_revision',
    {
      title: 'Get revision context',
      description: 'Get metadata for one Dialogue prototype revision, including its entry point and viewer URL.',
      inputSchema: z.object({
        revision_id: z.string().min(1).describe('Dialogue revision ID')
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ revision_id }) => toolJson({ revision: publicRevision(await getRevisionRecord(revision_id)) })
  );

  server.registerTool(
    'list_revision_files',
    {
      title: 'List revision files',
      description: 'List files in a locally stored Dialogue revision. Text files that can be read or edited are marked editableText.',
      inputSchema: z.object({
        revision_id: z.string().min(1).describe('Dialogue revision ID')
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ revision_id }) => {
      const revision = await getRevisionRecord(revision_id);
      const baseDir = safeRevisionBaseDir(revision);
      const files = await walkRevisionFiles(baseDir);
      files.sort((a, b) => a.path.localeCompare(b.path));
      return toolJson({ revision: publicRevision(revision), files });
    }
  );

  server.registerTool(
    'read_revision_file',
    {
      title: 'Read revision text file',
      description: 'Read one editable text file from a Dialogue revision. Use list_revision_files first to discover paths.',
      inputSchema: z.object({
        revision_id: z.string().min(1).describe('Dialogue revision ID'),
        path: z.string().min(1).max(500).describe('Relative file path returned by list_revision_files')
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ revision_id, path: relativePath }) => {
      const revision = await getRevisionRecord(revision_id);
      const file = await readRevisionText(safeRevisionBaseDir(revision), relativePath);
      return toolJson({ revision: publicRevision(revision), file });
    }
  );

  server.registerTool(
    'publish_revision',
    {
      title: 'Publish derived Dialogue revision',
      description: 'Create a new immutable Dialogue revision derived from an existing local revision. Unchanged assets are reused. Apply small exact text replacements where possible; use full-file writes only when necessary. This never overwrites the base revision and does not delete files.',
      inputSchema: z.object({
        base_revision_id: z.string().min(1).describe('Revision to clone as the immutable base'),
        version: z.string().optional().describe('Optional numeric version such as V24; omit to use the next available version'),
        summary: z.string().max(1000).optional().describe('Short description of the change'),
        replacements: z.array(z.object({
          path: z.string().min(1).max(500),
          search: z.string().min(1).max(50000),
          replacement: z.string().max(MAX_TEXT_BYTES)
        })).max(MAX_TOOL_EDITS).optional().describe('Exact single-occurrence text replacements in existing text files'),
        writes: z.array(z.object({
          path: z.string().min(1).max(500),
          content: z.string().max(MAX_TEXT_BYTES)
        })).max(MAX_TOOL_EDITS).optional().describe('Complete contents for text files to create or replace')
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ base_revision_id, version, replacements, writes, summary }) => toolJson(
      await publishDerivedRevision({
        baseRevisionId: base_revision_id,
        version,
        replacements: replacements || [],
        writes: writes || [],
        summary
      })
    )
  );

  return server;
}

void serveStdio(createServer);
console.error(`Dialogue MCP bridge ready (Dialogue API: ${DIALOGUE_BASE}).`);
