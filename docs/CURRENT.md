# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Current status

The first lightweight functional milestone has been merged into `develop` via PR #1.

The active implementation branch is now:

`feature/local-api-publishing`

Dialogue can already import, store, list and run a real Landline prototype revision locally. The next milestone is proving that a non-UI client can publish a new revision through the same Dialogue API.

## Verified local functional build

The merged local build provides:

- localhost-only Node server
- local project/prototype/revision persistence in `.dialogue-data/db.json`
- local filesystem storage for imported prototype packages
- visible Landline Import flow
- ZIP validation and one-wrapper-directory support
- duplicate revision rejection
- data-driven Landline revision cards
- dynamic owner viewer with sandboxed prototype iframe
- Restart / `R` reload support
- internal Dialogue HTTP API used by the browser Import UI
- `Start Dialogue.command` launcher that starts Dialogue and opens the browser

The real `LANDLINE-prototype-v22.zip` has been imported and run successfully through the complete Dialogue UI/server flow on Matt's Mac.

## Active API publishing work

`feature/local-api-publishing` adds a development client that uses Dialogue only through HTTP:

- `scripts/publish-revision.js`
- `Publish API Test.command`

The command is intentionally one-click/designer-friendly: with Dialogue already running, it opens a macOS file chooser for a prototype ZIP, determines the next Landline revision through the API, publishes the ZIP through the same import endpoint used by the UI, then opens the Landline project.

If V22 is currently the newest numeric Landline revision, the first API test should create V23.

Using the V22 ZIP again for this test is intentional. The goal is to prove the publishing transport/revision pipeline before asking an LLM to generate genuinely different code.

The Node client has been syntax-checked and exercised against a mock Dialogue HTTP server; it correctly discovered V22, selected V23, uploaded the ZIP body and handled the returned revision/viewer metadata.

See `docs/API.md` on the active feature branch for the current contract and LLM direction.

## Current local requirements

No new web-service accounts are required.

- Node.js 22+
- macOS `/usr/bin/unzip`

Normal Dialogue start: `Start Dialogue.command`.

API publishing test: keep Dialogue running, then double-click `Publish API Test.command` and choose the prototype ZIP.

## Architecture direction

The current local architecture remains product-validation scaffolding:

- existing HTML/CSS/JS Dialogue UI
- small Node HTTP/API server
- local JSON persistence
- local prototype filesystem storage
- sandboxed iframe viewer
- no real auth or hosted services yet

The local persistence layer is not a commitment to the eventual production stack.

The current lean production candidate remains one small self-hosted deployment (likely VPS + Docker/Coolify), Postgres when needed, persistent prototype storage, off-server backups and a separate prototype origin. Do not build that infrastructure yet unless a requirement forces it.

## LLM/API direction

Dialogue owns project/revision state. ChatGPT or another LLM should connect to Dialogue through an adapter/tool layer rather than Dialogue initially making provider-specific model calls itself.

Likely first tools:

- `list_projects()`
- `get_prototype()` / revision context
- `get_revision()`
- `publish_prototype()`
- `publish_revision()`

Human import, local API publishing and future LLM publishing should all converge on the same revision-ingestion pipeline.

## Next milestone

1. fetch/switch to `feature/local-api-publishing` on Matt's Mac
2. keep `Start Dialogue.command` running
3. double-click `Publish API Test.command`
4. choose the existing Landline V22 ZIP
5. verify Dialogue creates V23 through the API and shows it in the Landline project
6. open V23 and confirm it runs
7. if successful, merge this API milestone
8. then add a minimal MCP/tool adapter and temporary HTTPS development access for the first real LLM → Dialogue revision test

The key product question is whether an external client can read enough Dialogue context and publish a complete additive revision without a separate storage path or destructive overwrite.

## Product direction

The intended long-term loop remains:

`Figma design + live prototype → anchored feedback → structured revision request → connected LLM → new prototype revision → compare again`

Revision context may later include Figma node IDs, prototype/revision IDs, DOM references, coordinates, viewport details, screenshot/render crops and surrounding project context.

## UI status

Figma remains the source of truth for designed UI.

The current Import UI is temporary functional UI suitable for product validation. Settings remains intentionally incomplete while the LLM connection model is being proven.

## Repository / continuity workflow

Repository: `mattatgit/dialogue`

- `main` — stable baseline; eventually production
- `develop` — integration branch and standard `/context` source
- `feature/local-api-publishing` — current active API milestone
- other `feature/*` branches — focused implementation work

GitHub is the source of truth for Dialogue implementation files and durable project context. Runtime imported prototypes/data remain outside Git.
