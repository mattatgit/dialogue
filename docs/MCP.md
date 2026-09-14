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

## Status

The MCP bridge baseline was completed and merged into `develop` via PR #3.

The preceding local API publishing milestone created Landline V23. The MCP smoke test then successfully inspected the latest Landline revision and published **Landline V24** as a new derived immutable revision. V24 appeared in Dialogue and ran correctly.

The V24 test intentionally changed only a non-visible HTML comment, so the prototype remained visually/functionally equivalent. This proves the tool transport, revision reading and additive publishing path independently of model-authored visual changes.

## Local MCP server

`mcp-server.mjs` is a stdio MCP server built with the MCP TypeScript SDK.

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

These constraints are intentionally conservative for the first real LLM test.

## Development-only storage access

The MCP adapter currently reads revision file trees directly from `.dialogue-data/` because the lightweight Dialogue HTTP API does not yet expose file-list/read endpoints.

This is acceptable only for the local product-validation build.

Publishing still returns through Dialogue's normal import API, so the authoritative revision creation path remains shared with the browser Import UI and the already-proven API test client.

Before production, local filesystem reads should become proper Dialogue application/API operations. The eventual MCP adapter should not need privileged knowledge of storage layout.

## Verified local smoke test

`Test MCP Bridge.command` is the designer-friendly local test.

The verified test sequence was:

1. connect to Dialogue's MCP server over stdio
2. discover the Dialogue MCP tools
3. read the Landline project and latest revision
4. list its files
5. read its entry-point HTML
6. call `publish_revision`
7. create the next numeric revision with only a non-visual HTML comment added
8. open the Landline project and verify the new revision

Result: V23 was used as the base and V24 was created successfully. V24 appeared in the project and ran correctly.

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

## ChatGPT Plus and remote MCP

Matt's current ChatGPT subscription is **Plus**.

OpenAI product documentation checked in September 2026 says full custom MCP support with write/modify actions is currently available to ChatGPT Business and Enterprise/Edu workspaces. Plus is therefore not an appropriate path for the first direct ChatGPT UI → Dialogue `publish_revision` test.

This does not block the product-validation milestone. Dialogue's architecture is intentionally provider/client agnostic.

The recommended next step is a small **local LLM harness** that:

```text
OpenAI API model
   ↓ tool/function decisions
local test harness
   ↓ maps to Dialogue MCP tools
Dialogue MCP adapter
   ↓
Dialogue application/API + revisions
```

This preserves the exact MCP tool surface we already proved while avoiding any public tunnel and avoiding a ChatGPT plan upgrade simply for product validation.

OpenAI API usage is billed separately from ChatGPT Plus. The test therefore requires an API account with billing enabled and an API key. The credential must never be committed to Git; use local secret handling such as macOS Keychain or another local-only mechanism.

A direct ChatGPT custom-MCP test can still be performed later with a supported Business/Enterprise/Edu workspace when validating the final ChatGPT product experience becomes useful.

## Security stance

The first MCP bridge is deliberately local and narrow:

- Dialogue remains bound to localhost
- MCP server uses stdio, not a public listening port
- no destructive/delete tool exists
- `publish_revision` creates a new revision rather than mutating one
- editable paths are restricted to the selected revision directory
- only known text extensions can be read/edited by the bridge
- exact replacements must match once, reducing accidental broad edits
- API credentials for the next model test must stay outside Git

There is no need to expose Dialogue's localhost server directly to the public internet for the API-based model test.

## Next milestone

1. build a local OpenAI-API test harness that discovers/uses the existing Dialogue MCP tools
2. provide a designer-friendly launcher and secure local API-key setup
3. keep Dialogue and MCP local
4. ask the real model to inspect the latest Landline revision (currently V24 on Matt's test Mac)
5. ask it to make one small visible code change
6. publish a new immutable Dialogue revision through `publish_revision`
7. verify the new revision appears and runs correctly
8. inspect what additional context/tool schema is needed before any production infrastructure work
