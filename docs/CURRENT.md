# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Current status

Three lightweight functional milestones are complete and merged into `develop`:

1. PR #1 — local prototype import/viewer
2. PR #2 — external HTTP/API revision publishing
3. PR #3 — local MCP / LLM bridge baseline

Verified sequence on Matt's Mac:

- real Landline V22 imported through the Dialogue UI and ran correctly
- external non-UI HTTP client published Landline V23; V23 appeared and ran correctly
- local MCP client inspected the latest Landline revision and its files, then called `publish_revision`
- `publish_revision` created **Landline V24** as a new derived immutable revision
- V24 appeared in the Landline project and ran correctly
- V24 was intentionally visually/functionally equivalent to V23 because the MCP smoke test changed only a non-visible HTML comment

The local MCP transport/revision model is therefore proven.

Matt has now created an **Idealogue ChatGPT Business workspace** while keeping his Personal workspace separate. Dialogue will be recreated as a Project in the Business workspace rather than merging the Personal workspace. GitHub remains the durable source of truth for project continuity.

The next milestone is the first **real ChatGPT-authored visible revision** using the Business workspace's custom MCP support.

## Verified local functional build

`develop` now provides:

- localhost-only Node server
- local project/prototype/revision persistence in `.dialogue-data/db.json`
- local filesystem storage for imported prototype packages
- visible Landline Import flow
- ZIP validation and one-wrapper-directory support
- duplicate revision rejection
- data-driven Landline revision cards
- dynamic owner viewer with sandboxed prototype iframe
- Restart / `R` reload support
- internal Dialogue HTTP API shared by browser import and external publishing
- `Start Dialogue.command`
- `scripts/publish-revision.js` external HTTP publishing client
- `Publish API Test.command`
- local stdio MCP adapter in `mcp-server.mjs`
- automated MCP smoke client in `scripts/test-mcp.mjs`
- one-click `Test MCP Bridge.command`

## MCP / LLM bridge

Current MCP tools:

- `list_projects()`
- `list_revisions(project_slug)`
- `get_revision(revision_id)`
- `list_revision_files(revision_id)`
- `read_revision_file(revision_id, path)`
- `publish_revision(...)`

`publish_revision` derives a new revision from an immutable base, applies bounded text-file edits, reuses unchanged assets, packages the complete derived prototype, and publishes it back through Dialogue's existing HTTP ingestion path.

Conceptually:

```text
existing Dialogue revision
   ↓ inspect/read through MCP
small HTML/CSS/JS change
   ↓
derive complete new package
   ↓
Dialogue revision ingestion API
   ↓
new immutable revision
```

The base revision is never overwritten. No destructive delete tool exists at this stage.

Development-only limitation: revision file listing/reading currently accesses `.dialogue-data/` directly because the lightweight HTTP API does not yet expose those operations. Publishing still goes through Dialogue's authoritative HTTP revision-ingestion path. Before production, file access should move behind Dialogue application/API operations.

See `docs/API.md` and `docs/MCP.md`.

## Current local requirements

No production web services are required for the local build.

- Node.js 22+
- macOS `/usr/bin/unzip`
- macOS `/usr/bin/zip`
- npm packages required by the MCP development adapter

Normal Dialogue start: `Start Dialogue.command`.

## Architecture direction

The current local architecture remains product-validation scaffolding:

- existing HTML/CSS/JS Dialogue UI
- small Node HTTP/API server
- local JSON persistence
- local prototype filesystem storage
- sandboxed iframe viewer
- local MCP adapter
- no real auth or production hosting yet

Do not productionize infrastructure yet unless the real LLM test exposes a requirement that forces it.

The current lean production candidate remains a small self-hosted deployment (likely VPS + Docker/Coolify), Postgres when needed, persistent prototype storage, automated off-server backups and a separate prototype origin for untrusted prototype code.

## LLM/API direction

Dialogue owns project/revision state. ChatGPT or another LLM should connect to Dialogue through an adapter/tool layer rather than Dialogue initially making provider-specific model calls itself.

Human import, local HTTP publishing and LLM publishing should converge on the same additive revision-ingestion model.

Preferred LLM editing flow:

1. list projects/revisions
2. select a base revision
3. inspect its file tree
4. read only the text files needed for the requested change
5. publish a **new** derived revision with bounded text edits
6. review the new revision in Dialogue

## ChatGPT Business / first real LLM test path

Matt has created an Idealogue ChatGPT Business workspace specifically so the first real Dialogue integration can use ChatGPT's custom MCP support with write/modify actions.

The Personal workspace will remain separate. The Dialogue Project itself is not being migrated; instead, a new Dialogue Project will be created in the Business workspace and will reconstruct project state from this repository through the existing `/context` workflow.

Preferred next test path:

- keep Dialogue and its local MCP bridge on Matt's Mac
- configure ChatGPT Business developer mode / custom MCP connection using the supported secure local/private MCP connection path
- do not expose Dialogue's localhost web app directly to the public internet
- ask ChatGPT to inspect the latest Landline revision through the MCP tools
- ask it to make one small visible change and publish a new immutable revision through `publish_revision`

The OpenAI API billing/key route remains a valid fallback for provider-agnostic testing, but it is no longer the preferred path now that the Business workspace is available.

## Next milestone

1. recreate the Dialogue Project in the Idealogue Business workspace with the minimal repository/context instructions
2. confirm GitHub access is available from that workspace
3. enable/configure the supported ChatGPT Business custom MCP developer workflow
4. connect ChatGPT Business to the local Dialogue MCP bridge securely
5. use the real model to inspect the latest Landline revision (currently V24 on Matt's test Mac)
6. ask it to make one small visible change
7. have it publish a new immutable revision through `publish_revision`
8. verify the resulting revision appears and runs in Dialogue
9. use the result to refine tool schemas/context before any production infrastructure work

The key product question is now whether an actual ChatGPT model can get enough context through Dialogue's tools to make a useful targeted change and publish a safe additive revision.

## Product direction

The intended long-term loop remains:

`Figma design + live prototype → anchored feedback → structured revision request → connected LLM → new prototype revision → compare again`

Revision context may later include Figma node IDs, prototype/revision IDs, DOM references, coordinates, viewport details, screenshot/render crops and surrounding project context.

## UI status

Figma remains the source of truth for designed UI.

The current Import UI is temporary functional UI suitable for product validation. Settings remains intentionally incomplete while the LLM connection model is being proven.

The API/MCP launchers are development tooling, not product UI.

## Repository / continuity workflow

Repository: `mattatgit/dialogue`

- `main` — stable baseline; eventually production
- `develop` — current integration branch and standard `/context` source
- `feature/*` — focused implementation work

PR #3 (`feature/mcp-llm-bridge`) has been merged into `develop` after successful V24 verification.

GitHub is the source of truth for Dialogue implementation files and durable project context. Runtime imported prototypes/data remain outside Git.