# Dialogue — Local API and LLM Publishing Direction

## Purpose

Dialogue should expose a stable, LLM-agnostic application API. The browser UI, local test clients and future MCP/LLM adapters should all use the same underlying project/prototype/revision model rather than separate publishing implementations.

This document records the current local API surface and the next publishing milestone.

## Current local API

The lightweight local server currently exposes:

- `GET /api/health`
- `GET /api/projects`
- `GET /api/projects/:project/revisions`
- `GET /api/revisions/:id`
- `POST /api/projects/:project/import`

The import route accepts a complete prototype ZIP package as the request body and optional query parameters such as prototype name and revision version.

The browser Import UI already uses this route. This is important because future API/LLM publishing should converge on the same ingestion path rather than bypassing it.

## Local API publishing test client

Active implementation branch:

`feature/local-api-publishing`

The branch adds:

- `scripts/publish-revision.js` — a small Node client that talks to Dialogue only through HTTP
- `Publish API Test.command` — a one-click macOS wrapper that asks for a ZIP package and publishes it through the API
- automatic next numeric revision selection when a version is not supplied

The expected first test is:

1. keep `Start Dialogue.command` running
2. double-click `Publish API Test.command`
3. choose the existing Landline V22 ZIP
4. the client reads the current Landline revisions through the API
5. because V22 already exists, it chooses V23
6. it posts the ZIP through the Dialogue import API
7. Dialogue creates a new V23 revision
8. the Landline project page opens so the new revision can be verified

Using the V22 package again is intentional for this milestone: the goal is to prove that a non-UI client can publish a complete new Dialogue revision through the API. The contents do not need to differ yet.

## Command-line client contract

The test client can also be called directly:

```text
node scripts/publish-revision.js <prototype.zip>
```

Optional flags:

- `--base <url>` — Dialogue server, default `http://127.0.0.1:4173`
- `--project <slug>` — default `landline`
- `--name <name>` — default `Landline`
- `--version <Vn>` — explicit version; otherwise the next numeric version is inferred

This is development tooling, not intended designer-facing product UI.

## Why this milestone comes before MCP

Before exposing Dialogue to a remote LLM, we want to prove that the API itself can support the publishing operation independently of the browser Import UI.

If this works, the next adapter only needs to translate an LLM tool call into the same application operation rather than inventing a second storage/revision path.

## Planned first LLM-facing tools

The likely minimal tool layer is:

- `list_projects()`
- `get_prototype()` / revision context
- `get_revision()`
- `publish_prototype()`
- `publish_revision()`

The exact schemas are not fixed yet. They should be shaped by the local API publishing test and the first real LLM connection.

## Connection model

Initial direction:

```text
ChatGPT / other LLM
        ↓
MCP or equivalent adapter
        ↓
Dialogue API
        ↓
Dialogue project/prototype/revision state
```

Dialogue should not initially depend on making outbound OpenAI/Anthropic model calls itself. The LLM is a replaceable client of Dialogue.

## Development security

The current server remains localhost-only. No remote LLM can reach it yet.

When the local API contract is proven, a temporary HTTPS development endpoint/tunnel can be introduced for the first external LLM test. Authentication for that test can start with a narrow development token before any final OAuth/connection system is designed.

Production should still use a separate origin for untrusted prototype code.

## Next decision after API test

If API → Dialogue revision publishing works correctly, proceed to a minimal MCP/tool adapter and temporary remote development access.

If the API publishing test exposes awkwardness in how packages, revisions or project context are represented, adjust the application API first. Do not lock the production stack or MCP schema until this loop is understood.
