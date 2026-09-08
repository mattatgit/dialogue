# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Current date/status

Current implementation work is on:

`feature/local-prototype-import`

with **draft PR #1** targeting `develop`.

Dialogue is moving from a static Figma-derived interaction prototype to a deliberately lightweight local functional build. The goal is to prove the product workflow before setting up production services.

## Current functional build

The active feature branch adds a local Node server around the existing static UI without migrating the UI to a framework.

Current functional additions:

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

The original static prototype remains usable when its HTML files are opened directly. In static mode the old Landline V19/V18 mock cards remain as a fallback.

## Landline dogfood target

Landline's current **web prototype is V22**.

The real `LANDLINE-prototype-v22.zip` has now been supplied and checked against Dialogue's local import/viewer assumptions. V22 should remain the first real dogfood prototype used to validate the import → revision → viewer workflow.

Do not assume V19 is the current Landline prototype merely because the original Dialogue mock UI contains a V19 owner page.

## Verification completed so far

The local server/import pipeline was first exercised with generated development ZIPs, including:

- health/API server response
- generated V22-style ZIP import
- revision metadata returned by the API
- imported prototype file serving
- duplicate revision rejection
- ZIP `../` path traversal rejection
- one-wrapper-directory package support
- Node syntax checks for the new server/browser scripts

The **real Landline V22 ZIP** has now also been inspected and tested:

- package size is well below the 100 MB development upload limit
- its ZIP paths pass the current unsafe-path validation
- it contains one valid prototype `index.html`, inside a single wrapper folder (`LANDLINE-prototype-v22/index.html`)
- all HTML `src` / `href` references resolve to files present in the package
- the wrapper-folder structure is compatible with Dialogue's current entry-point and relative-asset serving model
- the prototype was exercised with the same sandbox flags used by Dialogue's viewer (`allow-scripts allow-forms allow-modals allow-popups allow-downloads`)
- no JavaScript runtime errors or missing image assets were observed in that sandbox test
- Profile open/edit/avatar/apply flow worked
- Add person flow worked, including adding a Landline ID into an empty dial slot
- Volume keyboard interaction worked
- PTT/VU animation logic ran inside the sandbox
- Copy Landline ID reached the `Copied` state and closed the sheet as intended

The supplied V22 ZIP contains normal macOS packaging metadata (`__MACOSX`, `.DS_Store` and AppleDouble `._*` files). The importer currently retains these files. They do not block the prototype, but cleanup/ignoring of this metadata is a small importer polish item for later.

Still to verify before merging PR #1:

- run the feature branch on Matt's Mac using the actual local Dialogue server and import the supplied V22 ZIP through the visible Import modal
- do a visual pass of the temporary Import UI against the existing Dialogue design
- confirm the real V22 package looks and behaves correctly in the complete Dialogue owner-view shell, not only in the equivalent sandbox compatibility test

## Local build requirements

No web-service accounts are required.

Current local requirements:

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

The package-level compatibility portion of step 1 is now complete; the remaining step-1 work is the real local Dialogue UI/server pass on Matt's Mac.

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

When a new chat starts, `/context` should load `CONTEXT.md`, this file, the durable docs and relevant active-branch source rather than relying on chat memory.

## Next step

Run `feature/local-prototype-import` on Matt's Mac and import the supplied **Landline V22** ZIP through the real Dialogue Import modal.

If the full local UI/server pass is good, fix any visual compatibility issues, then complete/merge PR #1. The following milestone is a small local API publishing test client, followed later by the first real LLM connection.
