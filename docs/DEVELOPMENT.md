# Dialogue — Development Workflow

## Current state

`develop` now contains the working lightweight local functional build plus durable project documentation.

Completed milestones:

- local real-prototype import/viewer
- external HTTP/API revision publishing
- local MCP read/edit/publish bridge

The current product-development goal is the first **real ChatGPT-authored visible revision** through the Idealogue ChatGPT Business workspace and Dialogue's existing MCP tool layer.

The immediate goal is still not a production framework/database/hosting migration. Production infrastructure remains deferred until the real LLM revision loop has been dogfooded.

## Branch strategy

- `main` — stable/tested baseline; eventually production
- `develop` — integration branch and normal `/context` source
- `feature/*` — focused implementation changes

New work should normally branch from `develop`, be tested, then return through a pull request.

## Designer-first working model

The intended collaboration remains:

- Matt designs and reviews in Figma/browser
- ChatGPT discusses product/UX/architecture and writes/updates code
- GitHub is the durable source of truth
- `.md` project docs are updated with meaningful implementation/architecture/UI decisions
- `/context` reconstructs state from the repo rather than chat memory
- project/chat containers are conveniences, not the authoritative project record

Codex is not required for this workflow.

## Lightweight local build

The current build uses a small Node server around the existing Dialogue UI.

Requirements:

- Node.js 22+
- macOS `/usr/bin/unzip`
- macOS `/usr/bin/zip` for derived revision packaging
- npm internet access when MCP dependencies need to be installed

Start by double-clicking `Start Dialogue.command` or run:

```text
npm start
```

Open:

`http://127.0.0.1:4173`

Runtime data is written to `.dialogue-data/` and must not be committed.

See `docs/LOCAL_BUILD.md`.

## Verified local functional sequence

The following sequence has been completed on Matt's Mac:

1. imported real Landline V22 through the visible Dialogue Import UI;
2. opened V22 in the dynamic owner viewer and verified its interactions;
3. published V23 through the standalone HTTP/API test client;
4. discovered/read Dialogue state through the local MCP adapter;
5. derived V24 from V23 and published it through `publish_revision`;
6. verified V24 appeared and ran correctly.

V24 intentionally differed only by a non-visible HTML comment. The point of that milestone was to prove transport/context/revision publishing before asking a real model to make a visible change.

## Current MCP development workflow

Relevant files:

- `mcp-server.mjs` — local stdio MCP server
- `scripts/test-mcp.mjs` — automated smoke client
- `Test MCP Bridge.command` — local one-click smoke test
- `docs/MCP.md` — tool contract, constraints and connection direction

Current tool set:

- `list_projects`
- `list_revisions`
- `get_revision`
- `list_revision_files`
- `read_revision_file`
- `publish_revision`

Do not add destructive delete tools at this stage. New model-authored changes should derive from an immutable base revision and create a new revision.

## ChatGPT Business test workflow

Matt has created an Idealogue ChatGPT Business workspace while keeping his Personal workspace separate.

The next test should use the Business workspace's custom MCP support rather than introducing separate OpenAI API billing/key management unless a fallback is needed.

Before configuring the remote/client connection, re-check current OpenAI developer-mode/MCP documentation because the feature is in beta and UI/permissions may change.

Keep Dialogue's local web app bound to localhost. Use the supported secure local/private MCP connection path rather than exposing the Dialogue app itself directly to the public internet.

## Repository hygiene

Do not commit:

- `.dialogue-data/`
- `.env` files
- API keys or access tokens
- service credentials
- user passwords/auth credentials
- generated `node_modules/`
- runtime logs

## Visual baseline

Figma and the existing static prototype remain the visual baseline.

Functional work should preserve existing UI behaviour unless the task explicitly changes it. Temporary functional UI that has not been designed in Figma must be documented as temporary rather than silently becoming the new design source of truth.

The current Import prototype modal is temporary functional UI.

## Regression checklist for current local build

When touching import/API/MCP/revision behavior, preserve:

- localhost server startup
- static Dialogue pages
- real ZIP import
- unsafe traversal rejection
- duplicate revision rejection
- wrapper-directory ZIP support
- data-driven revision cards
- dynamic owner viewer
- prototype interaction inside the sandbox
- Restart / `R`
- runtime files remaining outside Git
- immutable prior revisions
- MCP read access restricted to the selected revision tree/text files
- `publish_revision` creating a new revision rather than mutating the base

## Near-term build sequence

1. recreate the Dialogue Project in the Idealogue Business workspace using repository-backed context instructions
2. configure ChatGPT Business developer mode/custom MCP connection
3. connect securely to the existing local Dialogue MCP server
4. ask a real model to inspect V24, make one small visible change and publish the next revision
5. verify the result in Dialogue
6. refine tool/context schemas based on what the real model needed or got wrong
7. dogfood the LLM → Dialogue revision loop
8. only then finalize production hosting/database/storage/auth choices

## Production deployment direction

Production architecture is deliberately deferred while the core workflow is still being proven.

The current lean candidate is a small self-hosted VPS with Docker/Coolify (or equivalent), Postgres when needed, persistent prototype files, off-server backups and a separate prototype execution origin. The earlier Vercel/Supabase/R2 architecture remains an available managed alternative, not the current default.

Production must preserve a separate browser origin for untrusted imported/generated prototype code.
