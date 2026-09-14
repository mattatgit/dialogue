# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Current status

The lightweight local import/viewer milestone was merged into `develop` via PR #1.

The local API publishing milestone was then proven on Matt's Mac and merged into `develop` via PR #2. A non-UI HTTP client successfully published **Landline V23** through Dialogue's existing revision-ingestion API; V23 appeared in the Landline project and ran correctly in the owner viewer.

The active implementation branch is now:

`feature/mcp-llm-bridge`

The current goal is to prove the tool/adapter layer required for a real LLM to inspect a Dialogue revision, make a small code change and publish a new immutable revision before any production-stack work begins.

## Verified local functional build

The merged local build currently provides:

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
- `Start Dialogue.command` launcher that starts Dialogue and opens the browser
- `scripts/publish-revision.js` external HTTP publishing client
- `Publish API Test.command` one-click API test launcher

The real `LANDLINE-prototype-v22.zip` was successfully imported through the UI. The API test then used the same package to publish V23, proving that an external non-UI client can create a new Dialogue revision without bypassing the normal ingestion path.

## Active MCP / LLM bridge work

`feature/mcp-llm-bridge` adds the first development MCP adapter.

Current implementation:

- `mcp-server.mjs` — local stdio MCP server
- `scripts/test-mcp.mjs` — automated MCP client smoke test
- `Test MCP Bridge.command` — designer-friendly one-click local test
- `docs/MCP.md` — current MCP/LLM design and constraints

Current MCP tools:

- `list_projects()`
- `list_revisions(project_slug)`
- `get_revision(revision_id)`
- `list_revision_files(revision_id)`
- `read_revision_file(revision_id, path)`
- `publish_revision(...)`

The key new behavior is **derived revision publishing**. Rather than requiring an LLM to resend every unchanged image/font/binary asset, `publish_revision` clones an immutable base revision locally, applies bounded text-file changes, packages the complete derived prototype, then publishes that package back through Dialogue's existing HTTP import API.

Conceptually:

```text
Landline V23
   ↓ derive from immutable base
small HTML/CSS/JS change
   ↓
complete package
   ↓
Dialogue revision ingestion API
   ↓
Landline V24
```

The base revision is never overwritten. The first smoke test deliberately adds only a non-visual HTML comment so the transport/tool behavior can be verified independently of visual code generation.

Development-only limitation: file listing/reading currently accesses `.dialogue-data/` directly because the lightweight HTTP API does not yet expose revision-file read endpoints. Publishing still goes through Dialogue's normal API. Before production this storage knowledge should move behind Dialogue application/API operations.

See `docs/MCP.md` and `docs/API.md`.

## Current local requirements

No production web services are required.

- Node.js 22+
- macOS `/usr/bin/unzip`
- macOS `/usr/bin/zip`
- npm internet access on the first MCP test run to install pinned development MCP packages

Normal Dialogue start: `Start Dialogue.command`.

MCP smoke test: keep Dialogue running, then double-click `Test MCP Bridge.command`. On its first run it installs the local MCP development packages automatically and then runs the test.

If V23 is currently the highest numeric Landline revision on the Mac, a successful first MCP smoke test should create **V24**. V24 should look identical because the only intentional prototype change is an HTML comment.

## Architecture direction

The current local architecture remains product-validation scaffolding:

- existing HTML/CSS/JS Dialogue UI
- small Node HTTP/API server
- local JSON persistence
- local prototype filesystem storage
- sandboxed iframe viewer
- local MCP adapter
- no real auth or production hosting yet

The local persistence and direct MCP filesystem reads are not commitments to the eventual production stack.

The current lean production candidate remains one small self-hosted deployment (likely VPS + Docker/Coolify), Postgres when needed, persistent prototype storage, off-server backups and a separate prototype origin. Do not build that infrastructure yet unless a requirement forces it.

## LLM/API direction

Dialogue owns project/revision state. ChatGPT or another LLM should connect to Dialogue through an adapter/tool layer rather than Dialogue initially making provider-specific model calls itself.

Human import, local HTTP publishing and LLM publishing should converge on the same additive revision-ingestion model.

For LLM editing, the current preferred interaction is:

1. list project/revisions
2. select a base revision
3. inspect its file tree
4. read only the text files needed for the requested change
5. publish a **new** derived revision with bounded text edits
6. review the new revision in Dialogue

Do not add destructive delete tools at this stage.

## Remote LLM connection direction

A remote LLM cannot reach a localhost-only server directly. The current intended OpenAI development path is Secure MCP Tunnel rather than exposing Dialogue's local server publicly.

Current OpenAI product constraints verified in September 2026 are recorded in `docs/MCP.md`. In particular, ChatGPT plan/workspace capabilities affect whether a custom MCP connection can perform write actions, so the exact remote test path should be chosen only after Matt confirms which ChatGPT plan/workspace will be used.

This plan detail does not block the local MCP smoke test.

## Next milestone

1. fetch/switch to `feature/mcp-llm-bridge` on Matt's Mac
2. keep `Start Dialogue.command` running
3. double-click `Test MCP Bridge.command`
4. allow the first-run npm package installation to complete
5. verify the MCP client discovers/uses Dialogue tools and publishes the next Landline revision (expected V24 if V23 is latest)
6. open the new revision and confirm it runs and remains visually unchanged
7. if successful, merge the MCP bridge baseline
8. confirm the ChatGPT plan/workspace available for the real remote LLM test
9. configure the appropriate secure MCP connection
10. ask a real LLM to inspect Landline, make one small visible change and publish a new Dialogue revision
11. use what that test teaches us to refine context/tool schemas before production infrastructure

The key product question is now whether an actual LLM can get enough context through Dialogue's tools to make a useful targeted change and publish a safe additive revision.

## Product direction

The intended long-term loop remains:

`Figma design + live prototype → anchored feedback → structured revision request → connected LLM → new prototype revision → compare again`

Revision context may later include Figma node IDs, prototype/revision IDs, DOM references, coordinates, viewport details, screenshot/render crops and surrounding project context.

## UI status

Figma remains the source of truth for designed UI.

The current Import UI is temporary functional UI suitable for product validation. Settings remains intentionally incomplete while the LLM connection model is being proven.

The MCP smoke-test launcher is development tooling, not product UI.

## Repository / continuity workflow

Repository: `mattatgit/dialogue`

- `main` — stable baseline; eventually production
- `develop` — integration branch and standard `/context` source
- `feature/mcp-llm-bridge` — current active LLM integration milestone
- other `feature/*` branches — focused implementation work

GitHub is the source of truth for Dialogue implementation files and durable project context. Runtime imported prototypes/data remain outside Git.
