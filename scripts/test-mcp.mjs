#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PATH = path.join(ROOT, 'mcp-server.mjs');

function numericVersion(value) {
  const match = /^v?(\d+)$/i.exec(String(value || '').trim());
  return match ? Number(match[1]) : -1;
}

function textBlock(result) {
  const block = result.content?.find((item) => item.type === 'text');
  if (!block || typeof block.text !== 'string') throw new Error('MCP tool did not return a text result.');
  if (result.isError) throw new Error(block.text);
  return block.text;
}

async function callJson(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse(textBlock(result));
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER_PATH],
  cwd: ROOT
});

const client = new Client(
  { name: 'dialogue-local-mcp-test', version: '0.1.0' },
  { versionNegotiation: { mode: 'auto' } }
);

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const toolNames = tools.map((tool) => tool.name);
  const required = [
    'list_projects',
    'list_revisions',
    'get_revision',
    'list_revision_files',
    'read_revision_file',
    'publish_revision'
  ];
  const missing = required.filter((name) => !toolNames.includes(name));
  if (missing.length) throw new Error(`MCP tool discovery is missing: ${missing.join(', ')}`);

  console.log(`MCP connected. Tools: ${required.join(', ')}`);

  const projects = await callJson(client, 'list_projects');
  const landline = projects.projects?.find((project) => project.slug === 'landline');
  if (!landline) throw new Error('Landline project was not returned by list_projects.');
  console.log('Read test passed: Landline project found.');

  const revisionList = await callJson(client, 'list_revisions', { project_slug: 'landline' });
  const revisions = revisionList.revisions || [];
  if (!revisions.length) throw new Error('No Landline revisions are available. Import V22 first.');

  const base = [...revisions].sort((a, b) => numericVersion(b.version) - numericVersion(a.version))[0];
  console.log(`Using ${base.version} as the MCP test base revision.`);

  const revisionContext = await callJson(client, 'get_revision', { revision_id: base.id });
  const entryPoint = revisionContext.revision?.entryPoint;
  if (!entryPoint) throw new Error('Base revision has no entry point.');

  const fileList = await callJson(client, 'list_revision_files', { revision_id: base.id });
  if (!fileList.files?.some((file) => file.path === entryPoint && file.editableText)) {
    throw new Error(`Entry point ${entryPoint} is not available as editable text.`);
  }

  const fileResult = await callJson(client, 'read_revision_file', {
    revision_id: base.id,
    path: entryPoint
  });
  const html = fileResult.file?.content;
  if (typeof html !== 'string') throw new Error('Could not read the prototype entry point.');
  console.log(`File read test passed: ${entryPoint}`);

  const marker = `<!-- Dialogue MCP bridge test from ${base.version}; no visual change. -->`;
  let replacements = [];
  let writes = [];

  if (html.includes('</body>')) {
    replacements = [{ path: entryPoint, search: '</body>', replacement: `${marker}\n</body>` }];
  } else if (html.includes('</html>')) {
    replacements = [{ path: entryPoint, search: '</html>', replacement: `${marker}\n</html>` }];
  } else {
    writes = [{ path: entryPoint, content: `${html}\n${marker}\n` }];
  }

  const published = await callJson(client, 'publish_revision', {
    base_revision_id: base.id,
    summary: 'Local MCP bridge transport test; adds an HTML comment only.',
    replacements,
    writes
  });

  const revision = published.revision;
  if (!revision?.id || !revision?.version) throw new Error('publish_revision did not return the new revision.');

  console.log('');
  console.log(`Success: Dialogue MCP published ${revision.title || revision.version}.`);
  console.log(`Viewer: http://127.0.0.1:4173${revision.viewerUrl}`);
  console.log('The only prototype change is a non-visual HTML comment.');
} finally {
  await client.close().catch(() => {});
}
