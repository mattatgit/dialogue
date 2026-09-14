# Dialogue — Development Workflow

## Current state

`develop` contains the stable static Dialogue interaction prototype plus durable project documentation.

Active functional work is currently on:

`feature/local-prototype-import`

The immediate goal is not a production framework migration. It is to make the existing UI genuinely useful enough to import, store and run real Landline prototype revisions locally.

## Branch strategy

- `main` — stable/tested baseline; eventually production
- `develop` — integration branch
- `feature/*` — focused implementation changes

New work should normally branch from `develop`, be tested, then return through a pull request.

## Designer-first working model

The intended collaboration remains:

- Matt designs and reviews in Figma/browser
- ChatGPT discusses product/UX/architecture and writes/updates code
- GitHub is the durable source of truth
- `.md` project docs are updated with meaningful implementation/architecture/UI decisions
- `/context` reconstructs state from the repo rather than chat memory

Codex is not required for this workflow.

## Lightweight local build

The current functional branch adds a zero-npm-dependency Node server around the existing UI.

Requirements:

- Node.js 22+
- macOS `/usr/bin/unzip`

Start by double-clicking `Start Dialogue.command` or run:

```text
npm start
```

Open:

`http://127.0.0.1:4173`

No hosted services or service accounts are required.

Runtime data is written to `.dialogue-data/` and must not be committed.

See `docs/LOCAL_BUILD.md`.

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

The current Import prototype modal is such temporary UI.

## Test checklist for local prototype import

Before merging the current feature into `develop`:

- server starts on localhost
- static Dialogue pages still load
- static files remain usable without the local server where practical
- real Landline V22 ZIP imports
- unsafe traversal paths are rejected
- duplicate revision import is rejected
- one wrapper-directory ZIP works
- imported revision appears in the Landline grid
- dynamic owner viewer loads the actual imported prototype
- prototype scripts/interactions work inside the sandbox
- Restart reloads the imported prototype
- Dialogue layout/hover/modal behaviour remains visually consistent
- runtime files remain outside Git
- `docs/CURRENT.md` reflects the tested result and remaining issues

## Near-term build sequence

1. prove real Landline V22 import/viewing
2. resolve any prototype compatibility/sandbox issues
3. make the local data/API model slightly more general if the real workflow requires it
4. exercise revision publishing from a small API test client
5. add development authentication/token protection before internet exposure
6. temporarily expose the development API and test an actual LLM/MCP connection
7. dogfood the LLM → Dialogue revision loop
8. only then finalize production hosting/database/storage/auth choices

## Production deployment direction

Production architecture is deliberately deferred while the core workflow is unproven.

The current lean candidate is a small self-hosted VPS with Docker/Coolify, Postgres, persistent prototype files and off-server backups. The earlier Vercel/Supabase/R2 architecture remains an available managed alternative, not the current default.

Production must preserve a separate browser origin for untrusted imported/generated prototype code.
