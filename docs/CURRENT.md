# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Current status

Four lightweight functional milestones are now proven:

1. PR #1 — local prototype import/viewer
2. PR #2 — external HTTP/API revision publishing
3. PR #3 — local MCP / LLM bridge baseline
4. real ChatGPT Business → Secure MCP Tunnel → Dialogue read/write flow

Verified sequence on Matt's Mac:

- real Landline V22 imported through the Dialogue UI and ran correctly
- external non-UI HTTP client published Landline V23
- local MCP smoke client inspected V23 and published immutable Landline V24
- ChatGPT Business connected to the local Dialogue MCP server through the `Dialogue` Dev app and Secure MCP Tunnel
- ChatGPT discovered Landline and confirmed V24 as the latest revision
- ChatGPT published **Landline V25** from V24 with one requested visible change: the main heading became “Landline Test V25”
- Dialogue showed V25 correctly and V24 remained untouched

This proves the complete development loop from a real hosted LLM into Dialogue's local immutable revision model.

Two macOS launchers are now in source:

- `Setup Dialogue for ChatGPT.command` — one-time tunnel profile + Keychain setup
- `Start Dialogue with ChatGPT.command` — starts Dialogue and the tunnel together and waits for readiness

The one-click combined launcher has now passed its post-reset smoke test. After re-importing Landline V23.18, Dialogue persisted the revision across restart, created its revision manifest and metadata backup, and ChatGPT read the same revision successfully through the Dialogue Dev app.

The next milestone is **repeatable onboarding + deeper dogfooding**: establish Saori's distinct connection, then use more realistic revision requests to refine Dialogue's context/tools.

The standard fresh-chat context phrase remains **`Load project context`**.

## Local data safeguard hardening — 2026-09-22

During the combined-launcher smoke test on Matt's Mac, Dialogue returned the default Landline project with zero revisions. Investigation showed that the existing `.dialogue-data/` directory dated from September 14, while `db.json` had been recreated at 13:38 on September 22 and most prior revision directories were no longer present. The exact external deletion/cleanup source was not established. The committed Dialogue setup/start launchers do not delete `.dialogue-data/`, and Git does not track that directory.

Recovery of the old local revisions is not required because the latest prototype ZIPs are retained outside Dialogue and this remains disposable early-stage test data.

Safeguards now added on `develop`:

- back up existing metadata to `.dialogue-data/db.json.bak` before metadata replacement;
- write a reserved `.dialogue-revision.json` manifest into each newly imported/published revision directory;
- refuse startup if `db.json` is missing while prototype storage still contains content, instead of silently creating an empty database;
- refuse startup for unreadable/corrupt `db.json`;
- log genuine first-run data-store creation with path/timestamp;
- hide/exclude the reserved revision manifest from prototype serving and MCP prototype file operations/derived ZIPs.

These safeguards improve detection and metadata recoverability but do not protect against deletion of the entire Git-ignored `.dialogue-data/` directory. Prototype source ZIPs remain the practical external fallback during this development phase.

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

## ChatGPT Business / real LLM path

Matt's Idealogue ChatGPT Business workspace is now connected successfully to Dialogue through a draft/Dev custom MCP app backed by OpenAI Secure MCP Tunnel.

The local/private architecture remains:

- Dialogue web app bound to localhost
- Dialogue MCP server launched locally over stdio
- tunnel-client connects that MCP server to the OpenAI tunnel control plane
- ChatGPT uses the Dialogue Dev app to call the MCP tools

The first real write test succeeded with Landline V25. No public exposure of Dialogue's localhost web app was required.

The OpenAI API billing/key route remains a valid provider-agnostic fallback, but it is not needed for the current ChatGPT Business workflow.

## Next milestone

1. promote the now-smoke-tested integration baseline to `main` via PR #5
2. establish a supported tunnel-client route for Saori's Intel iMac or move her setup to supported hardware
3. provision Saori with a distinct tunnel/runtime key/profile and verify read-only access to her local Landline revision set
4. run additional real model-authored revisions beyond the one-heading V25 test
5. refine MCP/API context schemas and tool ergonomics from observed friction
6. use short-lived feature branches from `main` for subsequent work

### Combined launcher smoke test — passed

On 2026-09-22 Matt re-imported Landline **V23.18** after the disposable local test-data reset. Revision ID: `0b24d81a-5add-4312-b13d-05f786529a0a`.

Verified:

- the revision survived a Dialogue restart;
- `.dialogue-revision.json` exists in the revision directory;
- both `db.json` and `db.json.bak` exist;
- `Start Dialogue with ChatGPT.command` brought the app/tunnel path back online;
- ChatGPT listed Landline and returned V23.18 with the matching revision ID and 28 files.

This closes the manual smoke-test gate for PR #5.

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

Current promotion plan:

- `main` — stable/tested baseline and normal source for new work after this milestone
- `feature/*` — short-lived focused branches created from `main`
- `develop` — temporary historical integration branch being retired after the current baseline promotion

PR #3 (`feature/mcp-llm-bridge`) was merged into `develop` after successful V24 verification. The real ChatGPT V25 test subsequently proved the hosted-LLM connection and write path.

After the current promotion PR reaches `main`, new work should normally branch from `main` and return through tested pull requests rather than accumulating on a long-lived `develop` branch.

GitHub is the source of truth for Dialogue implementation files and durable project context. Runtime imported prototypes/data remain outside Git.
