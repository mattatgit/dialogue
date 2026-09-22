# Dialogue — Development Workflow

## Current state

The lightweight local build has now completed its first real end-to-end ChatGPT-authored revision.

Completed milestones:

- local real-prototype import/viewer
- external HTTP/API revision publishing
- local MCP read/edit/publish bridge
- Secure MCP Tunnel connection from ChatGPT Business to the local Dialogue MCP server
- real model-authored visible revision: Landline V25

The current product-development goal is to make the working connection repeatable for Matt and Saori, then dogfood more meaningful revision requests and refine Dialogue's tool/context model from observed friction.

The immediate goal is still not a production framework/database/hosting migration. Production infrastructure remains deferred until the revision loop and multi-person development setup have been exercised further.

## Branch strategy

- `main` — stable/tested baseline and normal starting point for new work
- `feature/*` — short-lived focused implementation branches created from `main`
- `develop` — temporary historical integration branch; retire it after the current baseline promotion

After the current promotion is complete, new work should normally branch from `main`, be tested/reviewed in a pull request, then merge back to `main`.

## Designer-first working model

The intended collaboration remains:

- Matt designs and reviews in Figma/browser
- ChatGPT discusses product/UX/architecture and writes/updates code
- GitHub is the durable source of truth
- `.md` project docs are updated with meaningful implementation/architecture/UI decisions
- `Load project context` reconstructs state from the repo rather than chat memory
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
6. connected ChatGPT Business to Dialogue through Secure MCP Tunnel;
7. had ChatGPT inspect V24 and publish V25 with the requested visible heading change;
8. verified V25 appeared in Dialogue, ran correctly, and left V24 untouched.

V24 intentionally differed only by a non-visible HTML comment. V25 is the first real ChatGPT-authored visible revision and proves the end-to-end write path.

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

## ChatGPT Business workflow

Matt's Idealogue ChatGPT Business workspace has now successfully connected to the local Dialogue MCP server through OpenAI Secure MCP Tunnel.

The working setup uses:

- a distinct Secure MCP Tunnel
- a restricted Runtime API key with Tunnels Read + Use
- a local `dialogue` tunnel-client profile
- direct Node launch of `mcp-server.mjs`
- a draft/Dev Dialogue app in ChatGPT

The repository includes `Setup Dialogue for ChatGPT.command` and `Start Dialogue with ChatGPT.command` to remove manual YAML editing and repeated environment setup. The setup command stores the Runtime API key in macOS Keychain.

Keep Dialogue's local web app bound to localhost. Do not expose the Dialogue app itself directly to the public internet.

Saori should use her own tunnel/profile/runtime key rather than sharing Matt's active tunnel ID.

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

1. validate the new setup/start launchers on Matt's Mac from a clean startup;
2. establish a supported tunnel-client installation route for Saori's Intel iMac or move her setup to supported hardware;
3. give Saori a distinct tunnel/profile/runtime key and verify a read-only Dialogue connection;
4. dogfood additional real ChatGPT → Dialogue revision requests beyond the single-heading V25 test;
5. refine tool/context schemas based on what the real model needed or got wrong;
6. improve revision-management/thumbnails/review ergonomics where the dogfood loop exposes friction;
7. only then finalize production hosting/database/storage/auth choices.

## Production deployment direction

Production architecture is deliberately deferred while the core workflow is still being proven.

The current lean candidate is a small self-hosted VPS with Docker/Coolify (or equivalent), Postgres when needed, persistent prototype files, off-server backups and a separate prototype execution origin. The earlier Vercel/Supabase/R2 architecture remains an available managed alternative, not the current default.

Production must preserve a separate browser origin for untrusted imported/generated prototype code.
