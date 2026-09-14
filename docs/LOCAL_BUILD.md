# Dialogue — Lightweight Local Functional Build

## Purpose

This build exists to prove Dialogue's core product workflow before committing to production hosting, authentication, database or storage services.

No production web-service accounts are required for the local application itself.

The current dogfood project is Landline. The local runtime history on Matt's test Mac has progressed from imported V22 to API-published V23 to MCP-derived V24.

## Current architecture

The local build runs on one Mac:

```text
Browser
  ↓
Dialogue local Node server
  ├── existing Dialogue HTML/CSS/JS UI
  ├── small local JSON data store
  ├── local prototype file storage
  └── local HTTP API

local MCP stdio adapter
  ↓
reads Dialogue revision context
  ↓
publishes derived revisions through Dialogue HTTP API
```

Runtime data lives under:

```text
.dialogue-data/
  db.json
  prototypes/
  tmp/
```

`.dialogue-data/` is ignored by Git.

The JSON store is deliberate development scaffolding, not the final database decision. The application/API boundary should make it possible to replace it later with Postgres or another persistent store without changing the product workflow.

## Start

Requirements:

- Node.js 22+
- macOS `/usr/bin/unzip`
- macOS `/usr/bin/zip`
- MCP npm dependencies when using the MCP bridge

Start by double-clicking `Start Dialogue.command`, or with:

```text
npm start
```

Then visit:

`http://127.0.0.1:4173`

The server binds to localhost only by default.

## Import workflow

1. Open Projects → Landline.
2. Choose **Import**.
3. Enter the prototype name and revision.
4. Choose a ZIP package.
5. Dialogue validates the ZIP.
6. The package must contain an `index.html` entry point, either at the ZIP root or as the single `index.html` inside one wrapper directory.
7. Dialogue stores the package locally and creates a revision record.
8. The project grid switches from the static fallback cards to real imported revision records.
9. Opening the card loads the imported prototype in Dialogue's owner viewer.

The importer rejects duplicate prototype/revision combinations and obvious unsafe ZIP paths such as `../` traversal entries.

## Verified Landline compatibility

The real `LANDLINE-prototype-v22.zip` was imported through the complete Dialogue UI/server flow and ran correctly.

The package is compatible with the current rules:

- one wrapper directory: `LANDLINE-prototype-v22/`
- one prototype entry point: `LANDLINE-prototype-v22/index.html`
- referenced assets present
- no unsafe absolute or parent-directory ZIP paths
- package well under the development upload limit

Key interactions ran inside Dialogue's iframe sandbox without JavaScript errors, including Profile, Add person, Volume, PTT/VU and Copy Landline ID.

The ZIP contains normal macOS metadata (`__MACOSX`, `.DS_Store`, `._*`). Dialogue currently stores those harmless files too. Ignoring/cleaning them is future importer polish rather than a blocker.

## Current HTTP API

The local server exposes:

- `GET /api/health`
- `GET /api/projects`
- `GET /api/projects/:project/revisions`
- `GET /api/revisions/:id`
- `POST /api/projects/:project/import`

The import route accepts ZIP bytes directly. The browser Import UI and external publishing client use the same revision-ingestion path.

The external API test successfully used this surface to publish Landline V23 from the V22 package, proving that a non-UI client can create a new revision without bypassing Dialogue's application path.

See `docs/API.md`.

## Current MCP bridge

The local stdio MCP adapter in `mcp-server.mjs` exposes:

- `list_projects`
- `list_revisions`
- `get_revision`
- `list_revision_files`
- `read_revision_file`
- `publish_revision`

`publish_revision` derives from an immutable base revision, applies bounded text edits, reuses unchanged assets, packages a complete new revision and publishes it through Dialogue's existing HTTP import route.

The local MCP smoke test successfully inspected V23 and created V24. V24 ran correctly. The test change was intentionally only a non-visible HTML comment.

Development-only limitation: MCP file listing/reading currently knows the local `.dialogue-data/` storage layout directly. Before production this should become a proper Dialogue application/API operation.

See `docs/MCP.md`.

## Prototype viewer isolation

Imported prototypes run inside a sandboxed iframe in the local build.

This is useful development containment, but it is **not yet the final production security boundary** because Dialogue and prototype files are still served by the same local server.

Production should retain a separate prototype execution origin, for example:

- trusted app: `dialogue.idealogue.studio`
- untrusted prototype code: `p.idealogue.studio`

## Known limitations

- no real authentication
- no multi-user access
- no public sharing implementation
- no thumbnail generation; imported Landline revisions reuse the existing thumbnail asset
- no revision management UI beyond importing/opening revisions
- no Figma comparison/comments yet
- local JSON persistence is single-process development storage, not a production database
- ZIP extraction relies on macOS command-line tools
- production-grade ZIP bomb/symlink/content hardening is incomplete
- macOS ZIP metadata is not cleaned during import
- production separate-origin prototype hosting is not implemented
- MCP file reads currently use direct local storage knowledge
- the real ChatGPT Business → Dialogue MCP connection has not yet been configured/tested

## Next test

The local app/import/API/MCP layers are now proven through V24.

Next:

1. keep the local Dialogue app and MCP adapter unchanged where possible;
2. configure the Idealogue ChatGPT Business workspace for the supported custom MCP developer flow;
3. connect ChatGPT Business to the local/private Dialogue MCP server securely;
4. ask the real model to inspect V24;
5. make one small visible HTML/CSS/JS change;
6. publish the next immutable revision through `publish_revision`;
7. verify it appears and runs in Dialogue.

The purpose is to learn what additional context/tool schema a real model needs before any production infrastructure work begins.
