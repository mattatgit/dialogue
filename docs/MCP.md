# Dialogue — MCP / LLM Bridge

## Purpose

This document records the first MCP adapter used to prove the real LLM → Dialogue revision workflow before Dialogue is moved to a production stack.

The architectural rule remains:

```text
LLM client
   ↓
MCP adapter
   ↓
Dialogue application/API + revision model
```

Dialogue should remain model-provider agnostic. The current bridge is development scaffolding for learning what context and revision operations an LLM actually needs.

## Active branch

`feature/mcp-llm-bridge`

This branch follows the successful local API publishing milestone, where an external Node client published Landline V23 through Dialogue's HTTP API and V23 appeared and ran correctly.

## Local MCP server

`mcp-server.mjs` is a stdio MCP server built with the stable MCP TypeScript SDK v2.

Current tools:

- `list_projects()` — read-only
- `list_revisions(project_slug)` — read-only
- `get_revision(revision_id)` — read-only
- `list_revision_files(revision_id)` — read-only
- `read_revision_file(revision_id, path)` — read-only text-file access
- `publish_revision(...)` — additive write action

`publish_revision` never overwrites its base revision. It derives a new revision from an existing local revision, reuses unchanged assets, applies bounded text edits, packages the result, and sends the complete package back through Dialogue's existing HTTP import/revision pipeline.

The tool currently supports:

- exact single-occurrence text replacements in existing files
- full text-file writes where necessary
- automatic next numeric revision selection
- optional explicit numeric version
- no file deletion
- no binary-file editing
- at most 25 edits per publish call
- maximum 2 MB per editable text file

These constraints are intentionally conservative for the first LLM test.

## Development-only storage access

The MCP adapter currently reads revision file trees directly from `.dialogue-data/` because the lightweight Dialogue HTTP API does not yet expose file-list/read endpoints.

This is acceptable only for the local product-validation build.

Publishing still returns through Dialogue's normal import API, so the authoritative revision creation path remains shared with the browser Import UI and the already-proven API test client.

Before production, local filesystem reads should become proper Dialogue application/API operations. The eventual MCP adapter should not need privileged knowledge of storage layout.

## Local smoke test

`Test MCP Bridge.command` is the designer-friendly local test.

Prerequisites:

- `Start Dialogue.command` is already running
- Landline has at least one imported revision (currently V23 on Matt's test Mac)
- internet access is available the first time so npm can install the MCP SDK packages

First run installs the pinned development packages without generating a package lock:

- `@modelcontextprotocol/server` 2.0.0
- `@modelcontextprotocol/client` 2.0.0
- `zod` 4.6.2

The smoke test then:

1. connects to Dialogue's MCP server over stdio
2. verifies tool discovery
3. reads the Landline project and latest revision
4. lists its files
5. reads its entry-point HTML
6. calls `publish_revision`
7. creates the next numeric revision with only a non-visual HTML comment added
8. opens the Landline project for visual verification

If V23 is currently newest, the first successful run should create V24.

## Why derived revisions instead of sending a whole ZIP from the LLM

The earlier API milestone proved that a complete ZIP can be published through Dialogue. That is suitable for human import and generic external clients, but it is awkward for an LLM because a prototype package can contain many unchanged images, fonts and other binary assets.

The MCP bridge therefore uses a base-revision model:

```text
Landline V23
   ↓ clone locally
small HTML/CSS/JS edit
   ↓
package complete derived revision
   ↓
Dialogue import API
   ↓
Landline V24
```

This is closer to the real product behavior we want: the model changes only what is necessary, while Dialogue still stores an immutable complete revision that can run independently.

## Remote ChatGPT connection

ChatGPT cannot connect directly to a localhost MCP server. OpenAI's current supported path for a local/private MCP server is Secure MCP Tunnel, which makes a local MCP server reachable to supported OpenAI products without exposing the server publicly.

The official OpenAI tunnel client can launch a local stdio MCP command, which matches Dialogue's current `mcp-server.mjs` design.

Important current ChatGPT availability constraint, verified September 2026:

- full MCP including write/modify actions is currently available to ChatGPT Business and Enterprise/Edu workspaces
- ChatGPT Pro can build/use custom MCP apps in developer mode, but custom MCP access is currently limited to read/fetch permissions rather than full write actions

This means the local MCP smoke test can proceed regardless of ChatGPT plan. Before the first real ChatGPT → Dialogue write test, confirm which ChatGPT plan/workspace will be used. If full write MCP is not available there, another MCP-capable client or an API-hosted test can be used to prove the provider-agnostic workflow without changing Dialogue's architecture.

## Security stance

The first MCP bridge is deliberately local and narrow:

- Dialogue remains bound to localhost
- MCP server uses stdio, not a public listening port
- no destructive/delete tool exists
- `publish_revision` creates a new revision rather than mutating one
- editable paths are restricted to the selected revision directory
- only known text extensions can be read/edited by the bridge
- exact replacements must match once, reducing accidental broad edits

Remote access should use the supported secure tunnel path rather than opening Dialogue's local server directly to the internet.

## Next milestone

1. run `Test MCP Bridge.command` on Matt's Mac
2. verify the MCP-created revision appears and runs correctly
3. merge the MCP bridge baseline if successful
4. confirm the ChatGPT plan/workspace available for testing write actions
5. configure Secure MCP Tunnel or the appropriate MCP client connection
6. ask a real LLM to inspect the latest Landline revision, make one small visible code change, and publish a new Dialogue revision
7. inspect what context/tool changes are needed before doing any production infrastructure work
