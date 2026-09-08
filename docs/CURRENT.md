# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Current date/status

Current implementation work is on:

`feature/local-prototype-import`

with **draft PR #1** targeting `develop`.

Dialogue is moving from a static Figma-derived interaction prototype to a deliberately lightweight local functional build. The goal is to prove the product workflow before setting up production services.

## Current functional build

The active feature branch adds a local Node server around the existing static UI without migrating the UI to a framework.

Current functional additions on that branch:

- localhost-only Dialogue server
- local persistent project/prototype/revision data in `.dialogue-data/db.json`
- local filesystem storage for imported prototype packages
- Landline project Import modal
- ZIP upload/import endpoint
- ZIP entry/path validation
- `index.html` entry-point detection, including one wrapper folder
- duplicate revision rejection
- data-driven Landline revision tiles after the first real import
- dynamic prototype owner page at `prototype.html?revision=...`
- imported prototypes rendered in a sandboxed iframe
- Restart reloads the imported prototype
- small local Dialogue API shared by the UI/import pipeline
- macOS launcher file: `Start Dialogue.command`

The original static prototype remains the stable `develop` baseline until the feature is verified and merged. When its HTML files are opened directly, the old Landline V19/V18 mock cards remain as a fallback.

## Landline dogfood target

Landline's current **web prototype is V22**.

V22 should be treated as the first real prototype package used to test Dialogue's import/revision/viewer workflow. Do not assume V19 is the current Landline prototype merely because the original Dialogue mock UI contains a V19 owner page.

## Verification completed so far

The local server/import pipeline on the feature branch has been exercised with generated development ZIPs:

- health/API server responds
- an `index.html` ZIP imports as Landline V22
- imported revision metadata is returned by the API
- prototype files are served back successfully
- duplicate V22 import returns a conflict rather than overwriting the revision
- ZIP `../` path traversal is rejected
- a ZIP with one wrapper directory and one nested `index.html` imports successfully
- server and new browser scripts pass Node syntax checks

Not yet verified:

- the real Landline V22 package
- a full browser visual pass of the new Import modal against the existing Dialogue UI
- the real Landline V22 interaction behaviour inside the sandboxed iframe

## Local build requirements

No web-service accounts are required.

Current local requirements on the feature branch:

- Node.js 22+
- macOS `/usr/bin/unzip`

Start with `Start Dialogue.command` or `npm start`, then open `http://127.0.0.1:4173`.

See `docs/LOCAL_BUILD.md`.

## Architecture direction

### Current development architecture

For this product-validation stage:

- existing HTML/CSS/JS Dialogue UI
- small Node HTTP/API server
- local JSON persistence
- local prototype filesystem storage
- sandboxed iframe viewer
- no auth or hosted services yet

The local JSON/filesystem implementation is development scaffolding behind an API boundary, not a commitment to that persistence model for production.

### Current production preference

After reviewing the actual expected scale with Idealogue's lead developer, the earlier Vercel + Supabase + R2 proposal is no longer the default recommendation. It remains a valid managed option, but is likely more infrastructure than this internal/small-client tool needs.

The current lean production candidate is:

- GitHub for Dialogue source
- one small VPS
- Docker/Coolify or equivalent low-ops deployment
- Dialogue application/API
- Postgres when a production database is needed
- persistent filesystem storage for prototype packages initially
- automated off-server backups
- separate prototype origin for untrusted prototype HTML/CSS/JS

Do not build production infrastructure until the local import/revision/LLM workflow has been proven unless a new requirement forces the decision earlier.

## LLM/API direction

Dialogue owns the project/revision state and exposes its own LLM-agnostic API/tool layer.

Potential eventual LLM tools remain conceptually:

- `list_projects()`
- `get_prototype()` / revision context
- `publish_prototype()`
- `publish_revision()` / update prototype by creating a revision
- later: get/respond to structured review requests

The local Import UI is intentionally the first client of the same ingestion concept that future LLM publishing will use.

Planned sequence:

1. prove human ZIP import with real Landline V22
2. exercise the same publishing path from a small local API test client
3. expose a development endpoint temporarily when ready
4. connect an actual LLM/MCP client
5. test LLM → Dialogue revision publishing
6. only then choose/finalize production hosting/auth/storage

## Product direction

The current manual workflow remains a prototype of Dialogue itself:

`Figma → build → screenshot/explanation → LLM change → new build → review`

The intended Dialogue loop remains:

`Figma design + live prototype → anchored feedback → structured revision request → connected LLM → new prototype revision → compare again`

Revision context may later include Figma node IDs, prototype/revision IDs, DOM references, coordinates, viewport details, screenshot/render crops and surrounding project context.

## UI status

Figma remains the source of truth for designed UI.

The new **Import prototype** modal on the feature branch is temporary functional UI built from existing Dialogue modal/form patterns so the workflow can be tested before Matt designs the final import/create experience. It should not be treated as a final Figma-approved component.

Settings remains intentionally incomplete while the LLM connection model is still being proven.

## Repository / continuity workflow

Repository: `mattatgit/dialogue`

- `main` — stable baseline; eventually production
- `develop` — integration branch
- `feature/*` — focused implementation branches

GitHub is the source of truth for application files and durable project context. Imported runtime prototypes are not source files and belong outside Git.

When a new chat starts, `/context` should load `CONTEXT.md`, this file, the durable docs and relevant current/active-branch source rather than relying on chat memory.

## Next step

Use the real **Landline V22** web-prototype ZIP with `feature/local-prototype-import`.

If it imports and runs correctly, inspect the UI/interaction result and fix compatibility issues before merging PR #1 or adding more product features. The following milestone is a local API publishing test client, followed later by the first real LLM connection.
