# Dialogue — Architecture

This document records the current architecture direction. It distinguishes the **lightweight development architecture being built now** from the likely **production architecture later**.

The production decision is intentionally deferred until the core Dialogue workflow has been proven.

## Architectural principles that remain stable

Regardless of hosting/provider choices:

- Dialogue owns project, prototype and revision state.
- Prototypes and prototype revisions are separate concepts.
- Updates create new revisions rather than destructively overwriting prior work.
- Prototype publishing should converge on one validated ingestion pipeline whether the caller is a human UI or an LLM.
- GitHub is the source of truth for the Dialogue application, not for runtime user prototype packages.
- untrusted imported/generated prototype code must not share the trusted authenticated Dialogue browser origin in production.
- the Dialogue LLM/API contract should remain provider-agnostic.

## Current lightweight development architecture

The current milestone runs locally on one Mac and requires no hosted services:

```text
Browser
  ↓
Dialogue local Node server
  ├── current HTML/CSS/JS UI
  ├── local JSON data store
  ├── local prototype package files
  └── Dialogue HTTP API
```

This deliberately avoids an early framework/database/hosting migration while the product behaviour is still being discovered.

### Local persistence

Development metadata currently lives in `.dialogue-data/db.json`.

Imported prototype packages are extracted under `.dialogue-data/prototypes/`.

This is development scaffolding only. Application code should continue to interact through a storage/data boundary so JSON/local-files can later be replaced without changing the product workflow.

### Local importer

The current importer:

1. accepts a ZIP package
2. validates obvious unsafe paths
3. requires an `index.html` entry point
4. stores the complete extracted package under a new revision ID
5. persists revision metadata
6. exposes the revision through the Dialogue API/viewer

The local importer currently uses macOS `/usr/bin/unzip`. Production-grade archive hardening is intentionally deferred but must include stronger limits/checks before accepting arbitrary untrusted uploads.

## Prototype/revision data model direction

Core concepts remain:

- users
- projects
- prototypes
- prototype revisions
- share links
- LLM connections
- Figma design references
- comments/review annotations
- revision requests

The local JSON build currently implements only projects, prototypes and revisions.

A prototype is the stable object. Each imported or LLM-produced update becomes a revision with its own immutable package and metadata.

## Prototype publishing

Publishing should be atomic at the revision level:

- validate a complete package
- create/store the new revision
- only expose it as a successful revision once the package is valid
- leave earlier revisions untouched

A revision should eventually be able to reference the feedback/revision request that caused it:

`design comment → revision request → LLM work → resulting prototype revision`

The same underlying publishing operation should be used by:

- manual Import UI
- local/test API clients
- MCP/LLM adapters
- later automated revision agents if added

## Prototype isolation

### Local development

The lightweight build runs imported prototypes in a sandboxed iframe. Dialogue and prototype files are currently served by the same localhost server, so this is useful containment but not the final browser-origin security boundary.

### Production requirement

Generated/imported prototype JavaScript must execute on a separate origin from authenticated Dialogue, for example:

- trusted app: `dialogue.idealogue.studio`
- prototype runtime: `p.idealogue.studio`

The viewer should continue using sandboxing as appropriate. This separation prevents prototype code from gaining access to Dialogue's trusted session/origin state.

## Public Share shell

The existing product direction remains to keep the public Share shell HTML/CSS-only where practical, while the prototype framed inside it may contain JavaScript.

Public sharing is not part of the current lightweight local milestone.

## LLM integration

Dialogue should expose its own HTTP API/tool layer. ChatGPT or another LLM connects to Dialogue; Dialogue should not be designed around controlling a user's ChatGPT account.

Initial tool concepts remain:

- `list_projects()`
- `get_prototype()` / get revision metadata and context
- `publish_prototype()`
- `publish_revision()`

Later:

- read Figma/design references
- read review comments/revision requests
- acknowledge/claim a revision request
- publish a revision linked to its request

MCP should be treated as an adapter on top of Dialogue's own API rather than the core data architecture. This keeps the system usable by other LLM providers/protocols later.

## Development path to an LLM connection

The current sequence is intentionally incremental:

1. real Landline V22 ZIP imports through Dialogue's human UI
2. the same revision-ingestion path is exercised by a local API test client
3. when ready, the local API is temporarily exposed through a secure development HTTPS tunnel
4. an LLM/MCP client is connected
5. LLM-created revision publishing is tested end-to-end

A temporary development token/auth layer should be added before exposing write endpoints to the internet. The final OAuth/connection UX can wait until the workflow is proven.

## Design/prototype review context

Dialogue should eventually act as a context broker between the designer, Figma, the rendered prototype and the connected LLM.

A review annotation may include:

- Figma file/node IDs
- project ID
- prototype ID
- prototype revision ID
- DOM selector or stable element reference
- coordinates
- viewport width/height
- screenshot/render crop
- comment text
- surrounding revision/project metadata

The side-by-side comparison surface is therefore both a visual viewer and a structured context-capture surface.

## Intended closed loop

Long term:

1. Dialogue displays a Figma design beside a live prototype revision.
2. The designer comments on a specific design/prototype element.
3. Dialogue captures the comment plus structured context.
4. Dialogue makes that revision request available through its LLM-facing layer.
5. The LLM reads additional project/revision context as needed.
6. The LLM publishes a complete new revision.
7. Dialogue validates/stores the revision atomically.
8. The new revision appears for comparison.
9. earlier revisions remain available for history/rollback.

## Current production direction

The original managed proposal — Vercel + Supabase + Cloudflare R2 — remains technically valid, but after reviewing the expected real scale with Idealogue's lead developer it is no longer the default recommendation for this version.

Dialogue is expected primarily to serve Matt, Saori and a small number of clients. There is no requirement to future-proof this web application for thousands of users.

The current lean candidate is therefore:

```text
GitHub
  ↓
small VPS
  ↓
Docker / Coolify (or equivalent)
  ├── Dialogue app/API
  ├── Postgres
  └── persistent prototype filesystem

nightly/off-server backups
```

Important production details:

- production and testing data should still be separated sufficiently to avoid accidental destructive testing
- prototype runtime should use a separate origin
- Postgres is preferred once production persistence/multi-user access is needed
- local filesystem storage is proportionate to expected usage; storage calls should remain abstract enough to move to S3/R2 later if needed
- automated off-server backups are mandatory if the database/files live on one VPS
- Coolify is optional; the lead developer may prefer plain Docker Compose or another low-ops deployment method

The final production choice should be revisited after the local import → revision → LLM loop has been dogfooded.
