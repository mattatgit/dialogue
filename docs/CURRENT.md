# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Review UI polish — 2026-09-28

### Create prototype UI implemented — 2026-09-29

Figma node `79:6629` is now implemented on the Landline project view. The top-right action is **Create**; projects with no stored revisions show the exact 180×180 Figma empty-state artwork and copy. Create opens the designed 504×664px **Create a prototype** modal with the 424×264 prompt editor, optional 424×72 Figma-link field, 208×56 Cancel/Create actions, the existing 32px modal-close asset, and the app's established hover/focus/disabled interaction treatment. The Create CTA remains disabled until there is prompt content; the optional Figma field must be empty or valid if present.

The prompt field is a lightweight rich Markdown editor for the agreed first-pass subset: bold, italic, headings (H1–H3), bulleted lists, numbered lists, links, and line breaks. Markdown typed or pasted into the field is rendered in place with syntax characters hidden while the underlying Markdown source is preserved in the form value. Formatting can be removed from the keyboard at its boundary (Backspace/Delete), restoring plain content rather than trapping invisible syntax. Pasted multi-line Markdown is rendered immediately.

Valid Figma URLs pasted into **Add a design file** are converted into the designed attachment chip using the exact Figma icon exported from node `79:6929` and the exact 16px chip-close export from node `79:6936`. The chip stores the original URL and can be removed to return to the URL field. The empty-state illustration is the exact node `79:6655` export.

This remains the pre-architecture-integration UI milestone: submitting the form emits a browser event, `dialogue:create-prototype`, carrying `{ project, prompt, figmaUrl }` and then closes the modal. It does not yet create a Git workspace/prototype. The event is the intended hand-off point for the forthcoming OMP/Git integration from Dave's architecture.

### Create prototype flow — Figma node `79:6629`

The project-level **Create** flow is now defined in Figma. An empty project shows a centered prototype-empty illustration and the message “This project doesn’t have a prototype yet. Click Create to start from an idea, or use an existing design.” The same top-right **Create** action is available when prototypes already exist.

Create opens one **Create a prototype** modal rather than separate role/path screens. The modal has a required large prompt field (**Describe what you want to create**) and an optional **Add a design file** field accepting a Figma link. This means the two creation paths converge in one surface: prompt only = start from an idea; prompt + Figma reference = start from an existing design. A valid Figma reference is represented as an attachment chip with Figma icon, truncated file name and remove control. **Create prototype** is disabled in the empty state and enabled once the creation request is sufficiently populated; **Cancel** and the close control dismiss the modal. The same modal is intended when adding another prototype to a project that already contains prototypes.

The board does not yet specify post-submit progress/setup UI, invalid-link/error handling, multiple Figma references, or GitHub/model connection gating; those should be resolved when this flow is wired into the OMP/Git architecture rather than invented as part of the visual port.

A recurring stale-runtime issue was identified during project-card/date verification: because static files are read from disk on each request while `server.js` logic remains loaded in the Node process, a previously running server can display newly pulled UI assets while continuing to return old API behaviour. `Start Dialogue.command` now detects a listener on port 4173: it automatically restarts `node server.js` only when that process belongs to the same checkout, and otherwise stops with a clear warning instead of silently opening an unrelated/stale server. The Projects client also narrowly normalizes the two known built-in legacy Landline descriptions to the current copy, so the card no longer depends on the server migration having already run; future user-authored descriptions remain untouched.

The Landline project description shown on the Projects card is now **“A simple push-to-talk peer to peer walkie talkie app”**. The local server seeds this text for new data stores and performs a narrow migration from both historical built-in variants of the previous description (with or without its trailing period), so existing local Dialogue data updates automatically without overwriting any user-custom description added later.

The prototype **Share** modal has been reconciled with Figma node `16:1915` / modal `15:1636`: it is 504×344px with 24px corners and the 0/0/20px `#00000014` window shadow, uses two exact 424×72px Ice `#F8F8F8` rows at y=120 and y=216, a 40px-high Copy button with 12px corners, and the Figma 32px close control exported locally as `assets/share-modal-close.svg`. The shared blue `:focus-visible` outline is suppressed specifically for this close control; keyboard focus uses the same light Ice background treatment instead. The extra local-sharing explanatory line that was not present in the Figma modal has been removed while the underlying local-link copy behavior remains connected.

The prototype-tile **New** badge has been reconciled with Figma node `15:835` / badge node `16:1900`: it is now positioned 8px from the tile's top/left edges, uses an 8px corner radius, 24px height with 10px horizontal padding, Lime `#CCFF00`, and live **Inter Tight SemiBold 12px** text. The previous outlined `badge-new.svg` rendering is no longer used by prototype tiles.

Prototype tile date sourcing was corrected again after live-app verification. The browser now prefers the stored revision `importedAt` timestamp directly, ahead of API-derived `editedAt`, so an already-running older server process cannot mask the true Dialogue import/publish time with a legacy `createdAt` value. In the current immutable revision model this import/publish timestamp is the authoritative source for the tile's user-facing **Edited** date.

Prototype tiles have been polished after the project-detail background change: the 72px information/footer area now uses Ice `#F8F8F8` instead of white so it remains distinct from the white project surface. Revision timestamps are now explicitly exposed by the local API as `editedAt`, with `importedAt` preferred over legacy/source `createdAt` when no explicit edit timestamp exists, and the tile UI renders those real timestamps as live, locale-aware labels such as **Edited just now**, **Edited 2:35pm yesterday**, a weekday for recent revisions, or an absolute date for older revisions. The labels refresh every minute while the page is open and expose the exact local timestamp on hover.

The Design systems empty state has now been updated from Figma node `15:1873`: the provisional line icon is replaced by the exact 176×176 **Suitcase** artwork from node `19:3794`, stored locally as `assets/design-system-empty-suitcase.png` and rendered at its native design size.

The project-management sidebar icon pass has now been reconciled with Figma node `1:2284`. The shared shell uses the exact exported Project, Design systems and Settings SVGs in both Default (`#9EA39E`) and Selected (`#171717`) states, with the 32px icon frames and 8px icon-to-label spacing from the Figma components. These replace the provisional `review-icons.svg` sidebar symbols across Projects, project detail, Design systems and Settings views.

A second Safari grid-alignment pass followed Matt's screenshot review. Figma node `26:4944` confirms the intended 8pt grid runs through both the prototype outer edge and internal 8pt-spaced controls. The earlier geometry used ideal floating-point transform coordinates; Safari can rasterize the transformed iframe/clip edge at slightly different subpixels. The viewer now measures the browser's final rendered iframe box after applying the transform and derives grid phase and spacing from that rendered geometry, so the visible prototype edge and its 8pt internal offsets should coincide with the visible grid lines rather than only agreeing mathematically before rasterization.

Prototype/grid registration was tightened after Safari review: the viewer previously centred the visible prototype root at arbitrary CSS coordinates, which could produce half/sub-grid placement on some window sizes even though the grid origin followed the prototype. `stageGeometry` now snaps the visible UI root to the rendered 8pt design grid before deriving the iframe position. The grid continues to originate from the measured prototype root, Comment-mode fixed positioning is preserved, and the snap is tested across odd viewport dimensions.

Activity/history model clarified for the future real-agent integration: every successful activity step should remain directly navigable without becoming a formal numbered version. The timeline uses three user-facing badge types: **Draft** for the latest unsaved working state, **Edited** for intermediate successful activity checkpoints, and **Vn** for deliberately saved versions. All three card types should also show the same friendly timestamp treatment so the rail stays visually consistent. Viewing an Edited checkpoint or older Version is non-destructive; the current Draft remains available to return to.

Reload-as-navigation has now been removed from this review UI. Successful simulated changes load directly as the current Draft, while the top-right control is **Restart**, which resets the currently viewed prototype state to its initial runtime state.

Saori's Draft → Version prototype at Figma node `51:3452` has now been reviewed and implemented in the simulated UI. Default Activity cards are fixed at 256px for predictable scanning; overflowing content is clipped at rest and expands on hover. Clicking any earlier Edited/Version card loads that exact prototype state directly. Clicking the Draft while viewing an earlier state returns to the latest Draft; clicking the already-active Draft expands it to 304px with **Cancel** and **Save version**. Cancel collapses back to Draft unchanged. Save version shows **Saved version** for 2 seconds, then the same card collapses and is promoted to the next numbered Version with a fresh friendly timestamp.

Comment dismissal is now intentionally low-friction: closing a composer, changing mode/tool, or navigating away silently discards any unsent text rather than opening a browser-level confirmation. The native `title` tooltip has been removed from the submit control. Figma now names the component **Send button**; the long-hover/clicked label is **Send** while Enter remains the keyboard shortcut for submitting (Shift+Enter still inserts a new line).

Safari 26.5 exposed the shared review `:focus-visible` outline on the comment textarea, producing an unintended heavy blue rectangle inside the composer. The textarea now explicitly suppresses browser/shared focus outlines and box shadows (including Safari/WebKit appearance) while the composer itself retains the intended light Summer Sky focused border as the visible focus state.

The comment composer has now been reconciled with the Figma component variants in `33:3592` (`Comment box`, `Send button`, and `Comment close icon`). The box has explicit Default / Focused / Typing states: Default uses the Dust `#EBEBEB` border, while Focused and Typing use Summer Sky `#BAE6FF`. The textarea still receives focus when a new anchored comment opens, so the normal entry state is Focused immediately; blurring an empty composer shows Default, and entering text switches it to Typing.

The close control now uses the exact exported Figma X assets and states: Default is transparent with the Granite X, Hover uses a Dust background and Main Text X, and pointer-down/Clicked uses Cloud `#CDD1CD`. The Send control now mirrors Figma's four variants and prototype timing: Default shows the smaller Granite return icon; Hover transitions over 50ms ease-out to a 32×24 Dust background with the larger Main Text icon; after a 300ms dwell, Long hover smart-animates over 100ms ease-out to the full 69×24 background and reveals the **Send** label; Clicked uses the full Cloud background with label/icon visible. Mouse leave returns to Default over 50ms ease-out. Exact local SVG exports are stored as `comment-enter-default.svg`, `comment-enter-active.svg`, `comment-close-default.svg`, and `comment-close-active.svg`.

The top review mode switch now follows the updated Figma component at `33:3592`: the visible Test label is renamed **Interact**, the switch is 200×48px, and both Interact and Comment segments are fixed at 88×32px with 8px outer padding, an 8px segment gap, and 6px icon/label spacing. The switch now also uses the exact exported Figma SVG assets `interact-grey`, `interact-white`, `comment-grey`, and `comment-white` rather than the earlier provisional symbols. Internal `data-mode="test"` naming remains implementation-only for now; the user-facing term is Interact.

Figma node `16:3477` ("Comment Arrow") was re-checked before this polish pass. The feature branch now clips the imported prototype iframe to the measured prototype UI root (including reported corner radii), so page/background gutters such as Landline's black outer box are not shown in Dialogue. The review bridge prefers an explicit `data-dialogue-root`, then known prototype/device roots. Landline's actual imported structure is `.stage > .landline`; `.landline` is now selected before the generic full-viewport `main.stage`, so its dark presentation backdrop is excluded.

Arrow annotations now follow the reference interaction: the user presses anywhere on the review canvas (including outside the prototype viewport), drags toward the thing they want to point at, and releases to set the arrowhead. The comment composer is anchored to the arrow's press/origin point rather than its release point, with a red terminal ball at the connection point. Arrow coordinates remain relative to the prototype viewport and may be outside its bounds, so they track the prototype when it recentres.

The existing Area and Select tools remain prototype-bounded. Interact/Comment mode switching now keeps the top mode control and prototype at the same screen position; opening Comment only reduces the white canvas to make room for the activity rail. The canvas left edge transitions over 100ms with ease-out, and the prototype geometry compensates continuously during that resize so it does not jump sideways. The Comment toolbar now follows the measured prototype root centre, so it stays centred beneath the prototype while the canvas opens/closes. Reduced-motion preferences still disable transitions. No runtime prototype/revision data is migrated or reset by these changes.

## Active UI branch — 2026-09-24

`feature/prototype-feedback-ui` is the new first-review UI build from `main`. It is NOT merged into `main` and is not a completed live LLM integration.

Two parallel workstreams are now active: Matt's developer colleague is building an easier LLM connection, while Matt and Saori's updated Figma defines the prototype feedback/review UI. This branch implements the UI against a clearly labelled simulated adapter so the connection can be replaced later without redesigning the viewer.

Implemented here: Interact/Comment mode, Select/Area/Arrow anchors, comment composer, direct Activity/history navigation, Draft/Edited/Version badges and Draft → Version save controls, Restart, and a canvas-local grid toggle. Grid defaults are 8 design pixels, `#BAE6FF`, and 50% opacity, with Settings controls. Hover uses 110% for <=24px controls and 105% for normal >=32px controls, 100ms ease-out. Design systems navigation/empty state is a placeholder for the later import milestone; Projects distinguishes empty data from a connection failure.

Saved revisions and navigation are real. Sending feedback only creates browser-local simulated Draft/Edited checkpoints of the unchanged base; **Save version** promotes the current simulated Draft to a browser-local numbered Version for interaction testing. It does not call an LLM or publish/modify any prototype files. The iframe sandbox is retained; response-only inspection metadata provides element selection without adding `allow-same-origin`.

Twelve Node checks passed, including disposable HTTP import/restart persistence and verification that review instrumentation does not modify stored prototype bytes. Full browser interaction testing was blocked by the implementation environment's browser navigation policy; an offline viewer-layout/hover check was performed instead. Safari review on Matt/Saori's actual prototypes remains necessary. Empty-state clay illustrations are still line-icon placeholders, and some utility icons need the final asset pass.

Next: switch the existing checkout to this branch, use the app-only `Start Dialogue.command`, and review the interactions before merging. No tunnel, new setup, data reset or re-import is required for the simulated UI. See `docs/PROTOTYPE_FEEDBACK_UI.md` for the adapter contract, test commands, limitations and designer review checklist. Keep `main` unchanged during review.

**Figma export preflight (required before future Figma-driven build work):** re-check the target Figma node and confirm intended SVG/PNG assets are actually exportable before implementing or refining the UI. On 2026-09-24 this preflight confirmed that the Folder and Suitcase clay empty-state illustrations are now available as PNG exports, and Dialogue/Grid/Share/Reload have SVG exports. The current first-review commit predates that asset availability and still uses line-icon placeholders for the clay illustrations; replace/verify those assets during the post-browser-review fidelity pass rather than rebuilding the branch before Matt's interaction review.

The earlier local data-loss trigger remains unproven; the prior external-cleanup theory was not a confirmed diagnosis. This UI branch does not reset or migrate `.dialogue-data`.

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

`main` now provides:

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

1. establish a supported tunnel-client route for Saori's Intel iMac or move her setup to supported hardware
2. provision Saori with a distinct tunnel/runtime key/profile and verify read-only access to her local Landline revision set
3. prototype the anchored feedback → revision request → provider-neutral activity → resulting revision loop
4. run additional real model-authored revisions beyond the one-heading V25 test
5. refine MCP/API context schemas and tool ergonomics from observed friction
6. continue using short-lived feature branches from `main`

### Combined launcher smoke test — passed

On 2026-09-22 Matt re-imported Landline **V23.18** after the disposable local test-data reset. Revision ID: `0b24d81a-5add-4312-b13d-05f786529a0a`.

Verified:

- the revision survived a Dialogue restart;
- `.dialogue-revision.json` exists in the revision directory;
- both `db.json` and `db.json.bak` exist;
- `Start Dialogue with ChatGPT.command` brought the app/tunnel path back online;
- ChatGPT listed Landline and returned V23.18 with the matching revision ID and 28 files.

This closes the manual smoke-test gate for PR #5.

## GitHub project-creation UX clarified — 2026-09-28

For the intended product UX, users should not normally paste Git repository URLs into Dialogue. During setup they should connect/install Dialogue's GitHub integration once. Dialogue should then be able to list accessible repositories and create a new repository from inside the app, subject to the user's and organization's GitHub permissions. Dave's current repository-address/deploy-key flow remains useful implementation scaffolding, but the preferred product direction is a GitHub-connected project flow with "New project" and "Open existing" choices.

A new Dialogue project can therefore create its backing Git repository behind the scenes, then create/open the initial workspace and run the same preview/agent setup. Git should remain infrastructure under the product rather than something designers must understand. Organization-owned repositories may still require owner/admin approval depending on GitHub App installation and organization policies.

## Project empty-state and Figma context direction — 2026-09-28

Once a Dialogue project has been created but has no prototype/app yet, the project empty state should become the primary creation entry point. It should explain the two initial creation routes and let the user start without understanding Git/OMP internals.

Preferred product framing: expose the routes by **starting material**, not by hard role labels, so the same person can use either path:
- **Start from prompt** — prompt-first creation for developers, non-designers, product people or anyone starting from an idea.
- **Start from Figma** — Figma reference + prompt for designer-led creation.

Both routes should create the same underlying Dialogue workspace/project and feed the same AgentSession/OMP execution layer. The distinction is only the context supplied at task start.

Figma should be treated as Dialogue-owned project/task context rather than as an OMP-specific integration. Dialogue should store the Figma reference(s), resolve file/node metadata, and pass the relevant design context to the agent. This also means Figma references must be attachable after project creation, including from the Comment UI. A comment can therefore carry both spatial prototype context (Select/Area/Arrow) and one or more Figma links/frames as design references.

For Stage 1, keep this lightweight: allow paste/add of a Figma URL (file or specific node/frame) in the new-project empty state and in the comment composer. Dialogue parses/stores the reference and supplies it to the agent; richer browsing, multi-file management and sync/version controls can come later. External ChatGPT/Claude entry points should be able to create the same Dialogue tasks/projects and pass Figma references into this same context model rather than creating a separate workflow.

## Product direction clarified — 2026-09-26

Dialogue's longer-term product direction now includes two primary human workflows over a shared project/workspace engine:

- a prompt-first workflow for non-designers and developers, where work is primarily directed through natural-language requests; and
- a designer workflow that begins from design context (most likely Figma), moves through reviewable prototypes, and can continue toward working application code.

The broader goal is seamless project handoff between roles: for example, a non-designer can start a project, hand it to a designer for UI/UX work, and then hand the same project/workspace to a developer for production cleanup and deployment. Git/workspace history can underpin code state, but Dialogue will also need its own human-workflow context (feedback, tasks, design references, activity and eventual handoff/ownership metadata).

This should be delivered in stages. The immediate Stage 1 priority is still a strong prototype workflow for Matt and Saori. Dave's `self-host` branch is being evaluated as a substantially stronger runtime foundation: git-backed workspaces, live previews, OMP-based multi-model agent connectivity, commit/push and self-hosting. The main unresolved product/architecture question is how to use that engine without making the raw OMP terminal the primary designer interface, and how to connect the Figma-driven Feedback/Activity UI to a structured agent-session layer.

No merge or architecture replacement has been approved yet; keep `main` unchanged while this integration direction is reviewed.

## Product direction

The intended long-term loop remains:

`Figma design + live prototype → anchored feedback → structured revision request → connected LLM → new prototype revision → compare again`

Revision context may later include Figma node IDs, prototype/revision IDs, DOM references, coordinates, viewport details, screenshot/render crops and surrounding project context.

### Decision: Feedback + Activity, not an embedded universal LLM chat client

Dialogue will support giving revision feedback directly from the prototype Share/review surface, with comments/requests anchored to the relevant prototype context.

A companion panel should show the useful Dialogue-owned history of that request: the user's feedback, attached context, request status, meaningful tool/action activity, explicit assistant messages or concise work summaries when available, errors, and the resulting revision.

The panel should render a provider-neutral Dialogue event model rather than trying to reproduce the complete output UI of ChatGPT, Claude, Kimi, Qwen or other providers. Provider-supplied reasoning summaries may be shown when available, but raw private chain-of-thought is not a product requirement.

This keeps Dialogue focused on prototype review and revision orchestration. It avoids making Dialogue responsible for becoming a general-purpose multi-provider chat client with provider-specific streaming, formatting, reasoning displays and conversation semantics.

## UI status

Figma remains the source of truth for designed UI.

The current Import UI is temporary functional UI suitable for product validation. Settings remains intentionally incomplete while the LLM connection model is being proven.

The API/MCP launchers are development tooling, not product UI.

## Repository / continuity workflow

Repository: `mattatgit/dialogue`

Current branch workflow:

- `main` — stable/tested baseline and normal source for new work
- `feature/*` — short-lived focused branches created from `main`
- `develop` — historical integration branch; no longer the normal place for new work

PR #3 (`feature/mcp-llm-bridge`) was merged into `develop` after successful V24 verification. The real ChatGPT V25 test subsequently proved the hosted-LLM connection and write path.

PR #5 has been merged into `main`. New work should normally branch from `main` and return through focused pull requests rather than accumulating on the historical `develop` branch.

GitHub is the source of truth for Dialogue implementation files and durable project context. Runtime imported prototypes/data remain outside Git.
