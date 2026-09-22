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

The standard fresh-chat context phrase is now **`Load project context`** rather than `/context`, to avoid collision with ChatGPT's own slash-command UI.

The next milestone is the first **real ChatGPT-authored visible revision** using the Business workspace's custom MCP support.

## Saori's Intel iMac setup — 2026-09-22

Matt reports that Dialogue is running on Saori's Intel iMac, **Landline V23.17** has been imported, and the prototype works correctly. This is user-confirmed local application/import/viewer success; it does not yet verify the ChatGPT tunnel or a model-authored revision on that machine. Restart persistence and the exact macOS version have not been reported in this setup conversation.

Stage 2 is currently blocked at the fresh Homebrew installation, not at Dialogue import/viewing. The immediate next step is to select and verify an appropriate tunnel installation/deployment route before resuming the connection setup. Do not repeat the earlier Homebrew installer instructions on this Intel Mac. After a working route is established, confirm the MCP dependencies, configure a distinct secure ChatGPT connection, and perform a read-only check against V23.17 before any publishing.

Use a separate Terminal window for installation commands while the local app is running. Give explicit Finder/Terminal steps rather than assuming command-line familiarity. Stop the existing app-only server before starting the combined launcher; do not run two Dialogue servers on port 4173.

Her runtime data is local to her Mac. Cloning/pulling the repository does not synchronize Matt's revision library, and Matt's V24 must not be assumed to be Saori's latest revision.

### Confirmed Homebrew installation blocker

Matt reports that the official shell installer refused the Intel iMac with an Apple-Silicon-only message. On 2026-09-22, the live `Homebrew/install` repository was checked: `install.sh` explicitly aborts on macOS when `uname -m` is not `arm64`, with `Homebrew on macOS is only supported on Apple Silicon processors!`. This is a hard block in the current fresh-install script, not merely a warning that can be acknowledged and ignored. The previous chat guidance suggesting that a sufficiently recent macOS version would make that installer suitable for an Intel Mac was incorrect.

Homebrew's support-tier documentation distinguishes existing Intel installations (Tier 3, unsupported) from the fresh-install path; do not infer fresh-install compatibility from the presence of Intel prefixes or older binaries in documentation.

OpenAI's current `openai/homebrew-tools` formula still references a `darwin-amd64` tunnel-client artifact. That establishes that an Intel artifact is listed, not that installation or operation has been verified on Saori's iMac. OpenAI's `tunnel-client` README currently identifies Homebrew as the supported macOS installation route, states that direct-download release ZIPs are not notarized and can be blocked by Gatekeeper, and advises against bypassing that check. Do not present direct download, an old Homebrew installer, or another package manager as a tested drop-in fix.

Keep the working local Dialogue installation and imported V23.17 intact. A replacement Mac has been mentioned as a possibility, but no purchase or architecture change has been decided. An alternative client build/installation or a shared supported host would require separate engineering and validation; shared authenticated browser access is not implemented in this local build. Do not expose the unauthenticated localhost app publicly to work around this installer failure.

Sources checked on 2026-09-22:

- https://github.com/Homebrew/install/blob/main/install.sh
- https://docs.brew.sh/Installation
- https://docs.brew.sh/Support-Tiers
- https://github.com/openai/homebrew-tools/blob/main/Formula/tunnel-client.rb
- https://github.com/openai/tunnel-client#install-with-homebrew

### ChatGPT launchers now present in source

Commit `37a57107d70c246200d6f8b16c324a0eafefbae9` (2026-09-21) added:

- `Setup Dialogue for ChatGPT.command` — creates the `dialogue` tunnel profile and saves the runtime API key in the current macOS user's Keychain.
- `Start Dialogue with ChatGPT.command` — starts the app and tunnel, checks readiness, opens Dialogue, and cleans up its child processes on Control-C.

The launchers do not install npm dependencies or Homebrew/tunnel-client automatically. Their presence in `develop` is not evidence of a completed real ChatGPT connection or Intel tunnel verification. Keep runtime keys out of chat, Git and shared files; provision a distinct connection for Saori rather than copying Matt's key/profile.

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

The Personal workspace will remain separate. The Dialogue Project itself is not being migrated; instead, a new Dialogue Project will be created in the Business workspace and will reconstruct project state from this repository when Matt sends `Load project context`.

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
5. use the real model to inspect the latest Landline revision (currently V24 on Matt's test Mac; V23.17 is the user-confirmed import on Saori's iMac)
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
- `develop` — current integration branch and standard context-loading source
- `feature/*` — focused implementation work

PR #3 (`feature/mcp-llm-bridge`) has been merged into `develop` after successful V24 verification.

GitHub is the source of truth for Dialogue implementation files and durable project context. Runtime imported prototypes/data remain outside Git.