# Dialogue

Dialogue is Idealogue's private catalogue, review and publishing tool for AI-assisted interface prototypes.

The repository currently contains two layers of work:

1. the Figma-derived static interaction prototype, which remains the visual/interaction baseline; and
2. a lightweight local functional build that is proving the real project → prototype → revision → LLM workflow before production infrastructure is chosen.

## Current functional state

Four lightweight milestones are now proven:

1. real prototype import/viewing;
2. external HTTP/API revision publishing;
3. local MCP read/edit/publish flow;
4. a real ChatGPT Business connection through Secure MCP Tunnel, including a visible model-authored revision.

Verified with Landline on Matt's Mac:

- Landline V22 imported through the Dialogue UI and ran correctly;
- an external API client published V23;
- the local MCP bridge inspected V23 and published V24 as a new immutable derived revision;
- ChatGPT connected to Dialogue through the `Dialogue` Dev app, inspected V24 and published V25;
- V25 changed only the requested main heading to “Landline Test V25”, appeared in Dialogue and ran correctly.

The end-to-end path is therefore proven: ChatGPT → Secure MCP Tunnel → local Dialogue MCP server → immutable Dialogue revision.

The current engineering focus is making that setup repeatable for Matt and Saori, then refining Dialogue's context/tool model through further dogfooding.

## Run the lightweight local build

Requirements:

- macOS for the current development importer/tooling
- Node.js 22 or newer
- standard macOS `/usr/bin/unzip`
- standard macOS `/usr/bin/zip` for derived MCP revisions
- npm internet access when the MCP packages need to be installed

Start Dialogue by double-clicking `Start Dialogue.command`, or run:

```text
npm start
```

Then open:

`http://127.0.0.1:4173`

Local application data and imported prototype files are stored in `.dialogue-data/`. That folder is deliberately excluded from Git.

See `docs/LOCAL_BUILD.md` for current local-build details and limitations.

## LLM / MCP development path

Dialogue owns project/prototype/revision state and exposes a provider-agnostic tool layer. The current local MCP adapter is `mcp-server.mjs`.

Current tools include:

- `list_projects`
- `list_revisions`
- `get_revision`
- `list_revision_files`
- `read_revision_file`
- `publish_revision`

`publish_revision` creates a new revision from an immutable base, applies bounded text edits, reuses unchanged assets, packages the complete result and sends it through Dialogue's existing revision-ingestion API.

Matt's Idealogue ChatGPT Business workspace has now completed the first real custom-MCP write test: ChatGPT discovered Landline, inspected the latest revision and published V25 as a new immutable revision.

Two macOS launchers are now included for the repeatable tunnel workflow:

- `Setup Dialogue for ChatGPT.command` — one-time local setup/profile creation with the Runtime API key stored in macOS Keychain;
- `Start Dialogue with ChatGPT.command` — starts Dialogue and the tunnel together and waits for control-plane readiness.

See `docs/MCP.md` and `docs/API.md`.

## Static design prototype

The existing HTML files can still be opened directly in a browser without the local server. In that mode, Dialogue behaves as the original static interaction prototype and uses its mock Landline V19/V18 content.

Current static prototype UI/interaction coverage includes:

- mock sign-in
- Projects and project detail views
- New Project and Profile modals
- image upload previews
- modal motion/backdrop closing
- prototype owner view
- Share modal with copy interaction
- Restart interaction and `R` shortcut
- Settings skeleton
- HTML/CSS-only public Share shell

Inter Tight is the primary UI typeface. Figma-exported SVG/PNG assets are stored in `assets/`.

## Project documentation

- `CONTEXT.md` — `Load project context` loading instructions
- `docs/CURRENT.md` — concise active state and next step
- `docs/PRODUCT.md` — product purpose and planned capabilities
- `docs/ARCHITECTURE.md` — current development and production architecture direction
- `docs/DESIGN.md` — Figma source and UI conventions
- `docs/DEVELOPMENT.md` — branches and development workflow
- `docs/LOCAL_BUILD.md` — lightweight local functional build
- `docs/API.md` — local application/API publishing contract
- `docs/MCP.md` — MCP tool layer and LLM connection direction

## Branches

- `main` — stable/tested baseline and the normal starting point for new work
- `feature/*` — short-lived focused branches created from `main` and merged back through pull requests
- `develop` — temporary historical integration branch being retired after the current baseline promotion

After the current baseline promotion is merged, new work should normally branch from `main`, be tested/reviewed in a pull request, and merge back to `main`.

## Important

GitHub is the source of truth for the Dialogue application source and durable project documentation. Imported user prototypes are runtime artifacts and should not be committed to this repository.

Do not commit credentials, API keys, database secrets, environment files, `.dialogue-data/`, generated `node_modules/` or runtime logs.
