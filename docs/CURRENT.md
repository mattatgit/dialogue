# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Current status

The first lightweight functional milestone is complete on `feature/local-prototype-import`, with PR #1 targeting `develop`.

Dialogue has moved beyond a static interaction prototype: the local build now supports importing, storing, listing and running a real prototype revision while preserving the existing Dialogue UI.

## Verified local functional build

The local build currently provides:

- localhost-only Node server
- local project/prototype/revision persistence in `.dialogue-data/db.json`
- local filesystem storage for imported prototype packages
- Landline project Import modal
- ZIP upload/import endpoint
- ZIP path/entry-point validation
- one-wrapper-directory package support
- duplicate revision rejection
- data-driven Landline revision cards
- dynamic owner viewer at `prototype.html?revision=...`
- imported prototypes rendered in a sandboxed iframe
- Restart / `R` reload support
- small internal Dialogue API used by the Import UI
- `Start Dialogue.command` launcher that checks Node, starts Dialogue and opens the browser automatically

The real `LANDLINE-prototype-v22.zip` has been imported and run successfully through the complete local Dialogue UI/server flow on Matt's Mac.

The end-to-end local pass is therefore considered successful: Dialogue starts locally, the visible Import flow works, Landline V22 imports as a real revision, appears in the project and runs in the Dialogue owner-view shell.

Earlier package/sandbox checks also verified the V22 Profile, Add person, Volume, PTT/VU and Copy Landline ID interactions without JavaScript errors or missing referenced assets.

The supplied V22 ZIP includes harmless macOS metadata (`__MACOSX`, `.DS_Store`, `._*`). Ignoring that metadata remains optional importer polish rather than a blocker.

## Current local requirements

No web-service accounts are required.

- Node.js 22+
- macOS `/usr/bin/unzip`

Start with `Start Dialogue.command`, which opens `http://127.0.0.1:4173` automatically while the local server window remains open.

See `docs/LOCAL_BUILD.md` for the development build details.

## Architecture direction

The current local architecture is intentionally lightweight product-validation scaffolding:

- existing HTML/CSS/JS Dialogue UI
- small Node HTTP/API server
- local JSON persistence
- local prototype filesystem storage
- sandboxed iframe viewer
- no auth or hosted services yet

The JSON/filesystem implementation sits behind an API boundary and is not a commitment to the eventual production persistence model.

The current lean production candidate remains:

- GitHub for Dialogue source
- one small VPS
- Docker/Coolify or equivalent low-ops deployment
- Dialogue application/API
- Postgres when a production database is needed
- persistent filesystem prototype storage initially
- automated off-server backups
- separate prototype origin for untrusted prototype HTML/CSS/JS

Do not build production infrastructure yet unless a new requirement forces the decision. The next priority is proving the LLM publishing loop.

## LLM/API direction

Dialogue should own project/revision state and expose an LLM-agnostic API/tool layer. ChatGPT or another model connects to Dialogue; Dialogue should not initially be built around one provider's outbound model API.

The intended first LLM-facing concepts are:

- `list_projects()`
- `get_prototype()` / revision context
- `get_revision()`
- `publish_prototype()`
- `publish_revision()`

Later tools can expose structured review/revision requests and Figma context.

Human ZIP import and future LLM publishing should share the same revision-ingestion pipeline.

## Next milestone

The human import/revision/viewer loop is now proven. Proceed in this order:

1. merge the local prototype-import milestone into `develop`
2. build a small local API publishing test client
3. prove API → Dialogue revision publishing (for example, create Landline V23 through the API and see it appear/run in Dialogue)
4. expose a temporary development endpoint when needed
5. add a minimal MCP/tool layer
6. connect a real LLM and prove one complete LLM → Dialogue revision cycle
7. only then finalize production hosting/auth/database/storage

The key product test is not simply whether an LLM can call Dialogue, but whether it can read enough project/revision context and publish a complete new revision through the same ingestion model without destructive overwrite.

## Product direction

The current manual workflow is itself a prototype of Dialogue:

`Figma → build → screenshot/explanation → LLM change → new build → review`

The intended long-term loop remains:

`Figma design + live prototype → anchored feedback → structured revision request → connected LLM → new prototype revision → compare again`

Revision context may later include Figma node IDs, prototype/revision IDs, DOM references, coordinates, viewport details, screenshot/render crops and surrounding project context.

## UI status

Figma remains the source of truth for designed UI.

The current **Import prototype** modal is temporary functional UI built from existing Dialogue patterns. It is adequate for product validation but should not be treated as a final Figma-approved component.

Settings remains intentionally incomplete while the LLM connection model is being proven.

## Repository / continuity workflow

Repository: `mattatgit/dialogue`

- `main` — stable baseline; eventually production
- `develop` — integration branch and standard `/context` source
- `feature/*` — focused implementation branches

GitHub is the source of truth for Dialogue implementation files and durable project context. Imported runtime prototypes/data are not application source and stay outside Git.

When a new chat starts, `/context` should load `CONTEXT.md`, this file, the durable docs and any active branch named here rather than relying on chat memory.
