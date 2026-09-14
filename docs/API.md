# Dialogue — Local API and LLM Publishing Direction

## Purpose

Dialogue exposes a stable, LLM-agnostic application API. The browser UI, local test clients and MCP/LLM adapters should all converge on the same project/prototype/revision model rather than creating separate publishing implementations.

This document records the current lightweight local API surface, the verified publishing milestone, and how the MCP layer currently sits on top of it.

## Current local API

The lightweight local server currently exposes:

- `GET /api/health`
- `GET /api/projects`
- `GET /api/projects/:project/revisions`
- `GET /api/revisions/:id`
- `POST /api/projects/:project/import`

The import route accepts a complete prototype ZIP package as the request body and optional query parameters such as prototype name and revision version.

The browser Import UI uses this route. External publishing also returns through this same ingestion path so human import and machine publishing share the authoritative revision-creation behavior.

## Verified external API publishing milestone

The API publishing client is now merged into `develop`:

- `scripts/publish-revision.js` — small Node client that talks to Dialogue only through HTTP
- `Publish API Test.command` — one-click macOS wrapper for choosing a ZIP and publishing it through the API
- automatic next numeric revision selection when a version is not supplied

Verified on Matt's Mac:

1. Dialogue already contained imported Landline V22;
2. the external client read current revisions through the API;
3. it selected V23;
4. it posted the V22 package through the Dialogue import route;
5. Dialogue created Landline V23;
6. V23 appeared in the Landline project and ran correctly.

Using the V22 package again was intentional: that milestone proved external revision transport/ingestion, not code generation.

## Command-line client contract

The development client can be called directly:

```text
node scripts/publish-revision.js <prototype.zip>
```

Optional flags:

- `--base <url>` — Dialogue server, default `http://127.0.0.1:4173`
- `--project <slug>` — default `landline`
- `--name <name>` — default `Landline`
- `--version <Vn>` — explicit version; otherwise the next numeric version is inferred

This is development tooling, not intended designer-facing product UI.

## MCP layer built after the API proof

The API milestone was completed before MCP so the LLM adapter would not invent a second storage/revision path.

The local MCP adapter now exposes:

- `list_projects()`
- `list_revisions(project_slug)`
- `get_revision(revision_id)`
- `list_revision_files(revision_id)`
- `read_revision_file(revision_id, path)`
- `publish_revision(...)`

The local MCP smoke test successfully used these operations to inspect Landline V23 and publish V24 as a new immutable derived revision.

`publish_revision` clones/derives from the selected base revision, modifies only bounded text files, reuses unchanged assets, then sends a complete derived package back through `POST /api/projects/:project/import`.

This means the authoritative write path remains the Dialogue HTTP ingestion API even when the caller is MCP.

See `docs/MCP.md`.

## Current development-only gap

Revision file listing/reading is not yet exposed through the HTTP API. The MCP adapter currently reads those files directly from local `.dialogue-data/` storage.

That is acceptable for the local proof-of-concept but should not survive into production. The eventual Dialogue application/API should expose proper revision-file read/list operations so the MCP adapter does not need privileged knowledge of storage layout.

## Connection model

Current architecture:

```text
ChatGPT / other LLM
        ↓
MCP or equivalent adapter
        ↓
Dialogue application/API + revision model
```

Dialogue should not be designed around making provider-specific outbound model calls as its core architecture. The LLM remains a replaceable client of Dialogue.

For the next test, Matt has created an Idealogue ChatGPT Business workspace so ChatGPT's custom MCP support can be used directly.

## Development security

The Dialogue local web server remains localhost-only.

The current MCP server uses stdio and should be connected through the supported secure local/private MCP mechanism for ChatGPT Business rather than by exposing Dialogue's localhost application directly to the public internet.

No destructive delete tool exists. `publish_revision` creates a new immutable revision rather than mutating its base.

Production should use a separate browser origin for untrusted prototype code.

## Next API evolution after the real LLM test

Do not expand the API spec pre-emptively.

First connect a real ChatGPT Business model to the existing MCP surface, ask it to inspect V24 and publish one small visible derived revision, then use observed friction to decide which API/tool additions are actually needed.

Likely candidates include proper HTTP revision-file read/list operations and richer structured revision context, but they should be driven by the real model test rather than guessed in advance.
