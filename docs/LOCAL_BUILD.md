# Dialogue — Lightweight Local Functional Build

## Purpose

This build exists to prove Dialogue's core product workflow before committing to production hosting, authentication, database or storage services.

No web-service accounts are required for this stage.

The immediate dogfood target is the **Landline V22** web prototype.

## Current architecture

The local build runs entirely on one Mac:

```text
Browser
  ↓
Dialogue local Node server
  ├── existing Dialogue HTML/CSS/JS UI
  ├── small local JSON data store
  ├── local prototype file storage
  └── local HTTP API
```

Runtime data lives under:

```text
.dialogue-data/
  db.json
  prototypes/
  tmp/
```

`.dialogue-data/` is ignored by Git.

The JSON store is deliberate development scaffolding, not the final database decision. The application/API boundary should make it possible to replace it later with SQLite or Postgres without changing the product workflow.

## Start

Requirements:

- Node.js 22+
- macOS `/usr/bin/unzip`

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

## Real Landline V22 compatibility

The supplied `LANDLINE-prototype-v22.zip` has been checked against this importer/viewer design.

It is compatible with the current package rules:

- one wrapper directory: `LANDLINE-prototype-v22/`
- one prototype entry point: `LANDLINE-prototype-v22/index.html`
- all referenced HTML assets are present
- no unsafe absolute or parent-directory ZIP paths
- package size is well under the development upload limit

The V22 prototype has also been exercised with the same iframe sandbox flags used by Dialogue. Its key interactions ran without JavaScript errors or missing image assets, including Profile, Add person, Volume, PTT/VU and Copy Landline ID.

The ZIP contains macOS metadata (`__MACOSX`, `.DS_Store`, `._*`). Dialogue currently stores those harmless files too. Ignoring/cleaning them is a future importer polish item rather than a blocker.

## Current API

The local server exposes the first internal Dialogue API surface:

- `GET /api/health`
- `GET /api/projects`
- `GET /api/projects/:project/revisions`
- `GET /api/revisions/:id`
- `POST /api/projects/:project/import`

The import route accepts the ZIP bytes directly. The browser Import UI uses the same API that a future test client or LLM adapter can call.

This is intentional: human import and future LLM publishing should converge on one revision-ingestion pipeline rather than becoming separate implementations.

## Prototype viewer isolation

Imported prototypes run inside a sandboxed iframe in the local build.

This is useful development containment, but it is **not yet the final production security boundary** because Dialogue and prototype files are still served by the same local server.

Production should retain the previously agreed separate prototype origin, for example:

- trusted app: `dialogue.idealogue.studio`
- untrusted prototype code: `p.idealogue.studio`

## Known limitations

- no real authentication
- no multi-user access
- no public sharing
- no thumbnail generation; imported Landline revisions currently reuse the existing Landline thumbnail asset
- no revision management UI beyond importing and opening revisions
- no Figma comparison/comments yet
- no external LLM/MCP connection yet
- local JSON persistence is single-process development storage, not a production database
- the ZIP extractor currently relies on macOS `/usr/bin/unzip`
- production-grade ZIP bomb/symlink/content hardening is not complete
- macOS ZIP metadata is not cleaned during import yet
- the isolated production prototype origin is not yet implemented

## Next test

Run the feature branch on Matt's Mac and import the supplied real Landline V22 ZIP through Dialogue's visible **Import prototype** modal.

Verify the full end-to-end local experience:

- V22 appears in the Landline grid
- opening V22 shows the actual prototype inside the Dialogue owner-view shell
- Landline interactions feel correct in that complete viewer
- Restart reloads the imported prototype
- existing Dialogue UI remains visually intact
- temporary Import UI is acceptable for product testing

Once this works, the next technical milestone is to exercise the same publishing path from a small API test client before exposing Dialogue to an external LLM.
