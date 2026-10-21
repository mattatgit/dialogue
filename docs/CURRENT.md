# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Current status

Accounts planning constraint (2026-10-21): Matt wants authentication introduced with a development/test workflow that avoids repeated manual logins. Plan persistent development sessions, disposable authenticated test identities, reusable browser state, and separate real authentication/access-denial tests. Test conveniences must remain unavailable in production and preserve authorization. Password/passkey/email sign-in is still a product choice; no account implementation has begun. See `docs/DEVELOPMENT.md`.

Main sidebar hover states (2026-10-21): Projects, Design systems and Settings labels and existing SVG icons change together from `#9ea39e` to Figma's `#6b6b6b` on pointer hover, with matching keyboard-focus colour and the existing visible focus outline. Selected destinations remain black. Shared styles cover all four sidebar-bearing pages and preserve 32 px icon geometry and compact-mode icon visibility. Safari renders the existing assets correctly; the full suite passed: **105 passed, 0 failed, 0 cancelled, 0 skipped**.

Gallery spacing follow-up (2026-10-21): removed the visible **Branches** heading/count while retaining the section's accessible label. Fixed spacing left by the hidden empty-state panel, so the first card row aligns vertically with the Projects view at a 40 px desktop top inset. Verified both views in external Safari; full suite passed again: **105 passed, 0 failed, 0 cancelled, 0 skipped**.

Gallery direction (2026-10-21): replace generic **Open** badges with a user badge/avatar identifying who is working on an app, website or prototype. Persisted worktrees and commit authors cannot establish active presence; accounts and reliable editing-session state are prerequisites. This is recorded product direction, not implemented presence tracking. See `docs/PRODUCT.md` and `docs/DESIGN.md`.

Project gallery styling (2026-10-21) now follows Figma `15:835` / card `15:845`: bundled Inter Tight, black names above grey Saved dates, a 72 px light-grey footer, correctly inset 8 px rounded yellow badges and an independent details menu for commit metadata. The current Branches/Tags structure remains temporary pending the unit-versus-branch product design. **Open** means a persistent local working copy exists, independently of merge state or active editors; **from main** identifies a fallback screenshot. Verified in external Safari, including menu switching and Escape dismissal. Full suite passed outside the restricted sandbox: **105 passed, 0 failed, 0 cancelled, 0 skipped**, including Chromium and file-watcher checks.

Product planning clarification (2026-10-21): a project is one Git repository containing potentially many apps, websites and prototypes, including prototypes of different areas of a larger app or OS. Units and branches are distinct concepts. Multiple users must be able to work on different units within the same project concurrently; a project-wide editing lock is unsuitable. The existing repository/ref workspace model does not yet implement this structure. Unit identity, preview/history context, editing ownership and shared-file isolation need design before implementation. See `docs/PRODUCT.md` and `docs/ARCHITECTURE.md`. The first deployment is intended for Matt and Saori.

The active integration worktree is `feature/integrate-feedback-ui`, branched from `self-host`; `feature/prototype-feedback-ui` supplied the visual design and rich entry editor. The original `self-host` checkout and its `.dialogue-data` remain separate. This branch renders the designed Projects, project, Settings, and review workspace surfaces against the Git-backed server. Create opens the repository's default branch and starts a durable agent request; the review canvas sends anchored comments. Model sign-in, repository URL/deploy-key connection, terminal fallback, and Save version are available.

Activity now renders the [Figma history-card states](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=207-4644). Create requests are recorded as **Created**, file-changing comments as **Edited**, and successfully completed no-change comments as **Commented**; the original card remains Created in history. A running request shows **Working** with bounded private agent progress, followed briefly by a tick and **Task completed** before its settled summary appears. The selected model is identified on completed cards. Green marks the current build, blue a selected previous preview, and dark an unselected previous state (80% opacity). Version saves transform the matching current request card into **Vn**, briefly show disabled **Saved a version** controls, then close the card. Tree matching prevents a version or manual worktree changes from being falsely attributed to an earlier comment; unattributed changes use a generic Draft card. Direct terminal turns remain separate activity, never fabricated edits.

History-card feedback is applied: padded, 8 px rounded request surfaces; safe inline Markdown in agent summaries; and a visible three-line ellipsis for long summaries instead of clipping. Working stays above the history without a duplicate generic Draft and becomes its settled card when the request finishes. Inter (regular/italic) and Inter Tight now load from bundled web fonts rather than an external Google Fonts request.

The waiting glyph now uses the user-supplied `Dialogue_waiting animation.svg` artwork. That SVG is a single intermediate frame rather than an animated export; `assets/history-wait.svg` animates its three strokes using the four Figma Waiting component states (`111:4499`), their 10 ms/500 ms delays and 100 ms ease-out transitions. `assets/history-wait-static.svg` preserves the supplied frame for reduced-motion preferences, while `assets/history-complete.svg` supplies the completion tick. The short status text still pulses except in reduced-motion mode. The integration workspace already has an observed Edited snapshot; no Version has been published in its real project data.

The workspace now uses the Figma three-way top switch: Interact shows the full canvas, Comment shows Activity plus annotation tools, and LLM terminal shows the on-demand `omp` terminal in place of Activity, with the prototype staying fixed as the canvas narrows. Terminal mode is unavailable on read-only previews, and **Fix with agent** opens it directly. The terminal's light `#f8f8f8` pane has white sent prompts and status line and a rounded white session strip using Inter Tight. The xterm transcript uses Space Mono to preserve its character grid; native `omp` prompt corners remain square until a custom conversation view is designed.

History-card navigation now preserves Comment mode across historical read-only previews and the return to the current branch. A selected past card is blue; the live current card returns to green, including when the current build is a published version. Read-only previews keep the Comment tab label and Activity rail but cannot annotate or use the terminal; Interact remains available by manual selection.

Preview first load and Restart now navigate the iframe directly to its unique review-channel URL when the runner is ready. The prior `about:blank` navigation depended on a later timer to install the real URL; if that timer did not run, the canvas could remain blank even though Dialogue reported the preview as ready.

Integration limitations: Version saves publish the current worktree and any ahead branch commits, not a selective diff or PR; a failed push leaves the Draft retryable. Prior Edited snapshots stay local and reopen as read-only commit workspaces; they are not GitHub versions. Element Select is available on instrumented **static** preview HTML; server-backed dev previews retain Area/Arrow annotation, and selection is disabled if no bridge answers. Create and comment Figma chips connect read-only file/node data to the agent using a server-only token; during a request the agent can download SVG/PNG nodes marked for export, but pasting a link does not bulk-import assets or save the design permanently. Design-system import, notifications, accounts/teams, and production authentication are unavailable; the sidebar identifies only the local workspace rather than a fictitious user.

The older milestone and terminal-first account below describes the `self-host` base and historical decisions, not an alternate entry path to reintroduce.


Three earlier lightweight milestones were completed and merged into `develop`:

1. PR #1 — local prototype ZIP import/viewer (Landline V22 imported and ran correctly)
2. PR #2 — external HTTP/API revision publishing (V23)
3. PR #3 — local MCP / LLM bridge baseline (V24, a non-visible change)

They proved that Dialogue could hold immutable prototype revisions and that a machine client could publish one. They are now **superseded** by the git-workspace + web-terminal build approved on 2026-09-23 (`docs/superpowers/specs/2026-09-23-git-workspaces-web-terminal-design.md`). The planned ChatGPT Business custom-MCP connection was dropped with them: the agent now runs inside Dialogue instead of connecting to it from outside.

The new model: a project carries its git repository (`repo.url`). Dialogue fetches refs, and opening a branch creates a git worktree and a split-screen workspace with an `omp` web terminal on the left and a live prototype preview on the right. How to preview a project is not detected by Dialogue: after a project is added, the agent works it out and records it in a committed recipe, `.dialogue/preview.json`, which Dialogue then runs and serves itself — plain files or the project's own dev server. Git is the revision model; there is no separate revision store, no ZIPs and no MCP bridge.

The standard fresh-chat context phrase is **`Load project context`**.

## Codex local startup

Starting Dialogue from a restricted Codex session requires write access to the existing OMP profile/runtime directories plus network access. Without it, provider/model discovery fails before authentication can be checked. The existing ChatGPT sign-in and model readiness were verified with local OMP 18.12.3 via `DIALOGUE_OMP`; the running integration server has since reported `openai-codex/gpt-6.1-sol` ready. See `docs/DEVELOPMENT.md`. The full suite, including file watching and headless Chromium, passed with approved execution outside the sandbox on 2026-10-21; restricted execution may still block those capabilities.

## Current build

The current integration build provides:

- localhost-only Node server (`server.js`) with Node-builtins-only modules `server/git.js`, `server/projects.js`, `server/deploy-key.js`, `server/requests.js`, `server/activity.js`, `server/figma.js`, `server/recipe.js`, `server/runner.js`, `server/preview-proxy.js`, `server/live-preview.js`, `server/setup.js`, `server/preview.js`, `server/terminal.js`, `server/watch.js`, `server/agent-auth.js`
- `.dialogue-data/db.json` schemaVersion 4: projects only, `{ slug: "<owner>-<repo>", createdAt, repo: { url, host, owner, repo }, previewSetup: { status, attempt, error, finishedAt } }`; v2/v3 files are rebuilt from their URLs (v3's `prototypePath` is dropped and the preview setup queued). Nothing hardcoded — projects are added from the Projects page (paste any HTTPS/SSH git URL) or seeded from the JSON file `[{ url }]` named by `DIALOGUE_SEED` (`seed.json` → Landline; `dev` sets it, the NixOS module builds it from `services.dialogue.seedProjects`). Duplicate repo names display as `owner/repo`. Projects can be removed from their card
- preview recipe `.dialogue/preview.json` v1 (`kind` `static`|`server`, `root`, `install`, `start` listening on `$PORT`, `entry`, `reload` `dialogue`|`self`, `readyTimeoutSeconds`). A workspace uses its own file (even uncommitted), else the local default branch's when it has unpushed commits, else origin's default branch's
- preview setup pipeline (`server/setup.js`), one job at a time, after a project is added, on server start for unfinished setups and on Retry: waits for a working AI model (`waiting-for-agent`, resumes on `AgentAuth`'s `ready`), validates any existing recipe, else runs `omp -p --approval-mode yolo` with `omp/preview-setup-prompt.md` in the open default-branch workspace or a persistent detached worktree `.dialogue-data/setup/<slug>/tree` (project `.env` moved aside), proves the recipe by running it and taking a screenshot through a temporary preview origin, and feeds failures back for up to 3 attempts. Success commits the recipe on the local default branch ("Add Dialogue preview recipe"; published by the next Save version) and stores the screenshot; log at `.dialogue-data/setup/<slug>/log.txt`
- Projects page cards show a Preview status line (Waiting to set up / Setting up… (try n of 3) / Waiting for an AI model / Ready / Setup failed) and poll while setups are queued or running; failed cards show the reason with Retry, Fix with agent (opens the default-branch workspace and hands `omp/preview-fix-prompt.md` to its terminal) and Show log
- live preview: `server/runner.js` installs (only when the lockfile/manifest stamp under `.dialogue-data/stamps/` changes) and starts the dev server in its own process group with `PORT`/`HOST`, probing readiness on `127.0.0.1` and `::1`; `RunnerPool` stops it 10 min after the last viewer leaves. `server/preview-proxy.js` serves each workspace on its own origin `http://<token>.preview.localhost:<port>/` (or `<token>.<DIALOGUE_PREVIEW_DOMAIN>`), proxying HTTP and WebSocket/HMR with Host/Origin rewritten, or serving static roots safely
- bare mirror per project at `.dialogue-data/repos/<slug>.git`, fetched with `git fetch --prune origin` when refs are listed
- one git worktree per opened ref at `.dialogue-data/workspaces/<slug>/<encoded-ref>/`; `git worktree list --porcelain` is the source of truth for workspaces (no db table)
- branch workspaces writable with a terminal; tag/commit workspaces detached, read-only, no terminal
- project page (`project.html?slug=…`) with Branches and Tags tile groups from live refs, "open" dot on tiles with a workspace, `fetchError` note when the fetch fails; a private SSH repository shows the "Connect Dialogue to your repository" panel (shared `js/connect-panel.js`) until its deploy key is registered
- prototype previews: project cards and branch tiles show real screenshots (`GET /api/projects/:slug/preview/:sha.png`, headless Chromium from `DIALOGUE_CHROMIUM`/`PUPPETEER_EXECUTABLE_PATH`/PATH) captured from running previews — by the setup pipeline, 5 s after a workspace's preview is ready and 30 s after file changes — and stored per commit under `.dialogue-data/previews/<slug>/`, with `main.png` as the fallback for commits without their own image (tiles then say "from main"). Cards refresh in the background when origin's default branch moves. Without Chromium the initials badge / blank device is shown
- `workspace.html` + `js/workspace.js`: crumbs `Projects › Landline › <ref>`, Restart and Share in the top-right header with no commit or worktree-status chip, terminal pane left, 370×722 preview iframe on the preview origin right (sandbox with `allow-same-origin`, safe because the origin differs), installing/starting messages while the preview comes up, the crash log and a **Restart preview** button when it stops, Restart / `R`
- web terminal: `js/terminal.js` over vendored xterm.js 5.5 (`js/vendor/`), speaking ttyd's protocol through the `/ws/terminal/:id` WebSocket proxy, with reconnect backoff and server error display
- terminal process: ttyd → `omp/attach.sh` → tmux (`-L dialogue`, `omp/tmux.conf`) → `omp --config omp/config.yml --append-system-prompt omp/system-prompt.md -e omp/activity.js`, started lazily on the first WebSocket client; tmux sessions survive Dialogue restarts but rotate when `omp/*` changes
- `omp/dialogue-theme.json` installed into the active omp profile's themes directory before spawn; `css/terminal.css` shares its palette; Space Mono (terminal text), Inter Tight (panel chrome and card metadata), and Inter (card copy) bundled in `assets/fonts/`, with the UI font faces declared in `css/dialogue.css`
- SSE `GET /api/workspaces/:id/events`: `change` events from debounced `fs.watch`es on the worktree (top level, non-ignored non-dot top-level directories, `.dialogue`; never `node_modules`) and its git dirs, which reload the iframe only when the recipe's `reload` is `dialogue`; `runner` events with the preview server's state; `activity` events with the private direct-terminal sidecar status and summary; a changed recipe restarts the preview
- Activity: `GET /api/workspaces/:id/activity` combines the current branch Draft, private per-comment snapshots in the local mirror (`refs/dialogue/edits/<branch>/<requestId>`), numbered published Versions, durable request summaries, and the most recent direct-terminal status/summary from a private sidecar. `POST /api/workspaces/:id/versions` snapshots the current Draft and pushes the branch commit and `dialogue/<branch>/Vn` tag atomically, reporting success only after remote confirmation. A failed push retains a pending local ref for retry; private Edited refs never travel to the remote
- per-project SSH deploy key (`.dialogue-data/keys/<slug>`), generated on first use by `server/deploy-key.js`; fetch stays HTTPS, `remote.origin.pushurl` + `core.sshCommand` on the bare mirror make push use the key. The first Save version without a registered key opens the "Connect Dialogue to your repository" panel with the public key and step-by-step instructions written for a designer
- `Start Dialogue.command` checking for `git`/`ttyd`/`tmux`/`omp`/`ssh`/`ssh-keygen`
- Nix: devshell with `nodejs`/`git`/`ttyd`/`tmux`/`openssh`/`chromium` (`dev` sets `DIALOGUE_PREVIEW_PORT`), `flake.nix` input `llm-agents` providing `omp` to the VM, NixOS module with `HOME=${dataDir}/home`, nginx WebSocket proxying with `*.preview.localhost` (+ `*.<previewDomain>`) server aliases and the browser's Host passed through, `services.dialogue.omp`, `services.dialogue.previewDomain`, `seedProjects = [{ url }]`; the package puts `node`/`npm` on PATH for preview servers
- unit tests (`npm test`) cover Git workspaces, private Activity snapshots and Version publication, structured requests, previews, setup and authentication; `test/preview-e2e.test.js` exercises the server, a fake setup agent and the preview origin
- agent sign-in without a terminal: `server/agent-auth.js` checks readiness (`omp token` + a live `omp -p` probe from an empty temp dir, classified `not-connected`/`rejected`/`quota`/`unreachable`/`unknown`, success cached 10 min, `ready` event that also resumes waiting preview setups) at start and after each sign-in; `/api/agent*` routes; the Settings page "AI model" section and the Projects page "Connect an AI model to continue" banner (`js/agent-connect.js`) drive omp's own `/login` over `omp --mode rpc` — provider page opens in a new tab, the designer pastes the address they land on. rpc children load `omp/bootstrap-provider.js` (`-e`) so omp starts before any credential exists; the selected model lives in `.dialogue-data/agent.json` and reaches terminals as `DIALOGUE_OMP_ARGS` (part of the tmux session checksum) and the setup agent as its model arguments
- `test/agent-auth.e2e.test.js`: the full sign-in against the real server and real `omp` with an in-process fake OpenAI-compatible provider registered as an omp extension in a temp `HOME` (skips when `omp` is not on PATH)

Removed: `mcp-server.mjs`, `scripts/publish-revision.js`, `scripts/test-mcp.mjs`, every `*.command` except `Start Dialogue.command`, `js/local-import.js`, `docs/MCP.md`, ZIP/unzip code, `/api/revisions`, `/api/prototypes`, the import route, the MCP npm dependencies, prototype-directory detection (v3's `repo.prototypePath`), the old worktree file route for the iframe and screenshots rendered from exported commits.

## Current local requirements

No production web services are required for the local build.

- Node.js 22+
- `git`, `ttyd`, `tmux`, `ssh`/`ssh-keygen`/`ssh-keyscan` on PATH (devshell provides them; OpenSSH ships with macOS)
- `omp` on PATH (the developer's own)
- a signed-in AI model before preview setup can run (setups wait as "Waiting for an AI model" until then)
- whatever a project's preview needs on PATH (`node`/`npm` for most web projects; the devshell and the Nix package provide Node.js); Chromium for screenshots is optional

Normal start: `dev` in the devshell, `npm start`, or `Start Dialogue.command`. VM: `nix run .#vm`.

In the VM, `HOME` is `/var/lib/dialogue/home`. On first use open Settings (or press Connect on the Projects page) and sign in to a model provider; the web terminal's `/login` still works too. Pushing needs no hand-placed credentials: the first Save version shows the project's public deploy key to add to the repository.

## Architecture direction

The current local architecture remains product-validation scaffolding:

- existing HTML/CSS/JS Dialogue UI
- small Node HTTP server with SSE and a WebSocket proxy
- git as the store: bare mirror + worktrees, no separate revision database
- ttyd + tmux + omp as the agent runtime
- previews on per-workspace `*.preview.localhost` origins, run and proxied by Dialogue from the repository's own recipe
- no real auth or production hosting yet

Do not productionize infrastructure yet unless the real designer-driven test exposes a requirement that forces it.

The lean production candidate remains a small self-hosted deployment (the NixOS module is the current shape of it), persistent storage for repos/worktrees, automated off-server backups and a separate prototype origin for untrusted prototype code (`services.dialogue.previewDomain` with wildcard DNS; the origin separation exists, process sandboxing of preview servers and the agent does not yet).

## Next milestone

Run a real designer-driven pass through the integrated flow on a connected repository:

1. Add the repository, confirm preview setup and model readiness, then use Create with a prompt and optional Figma URL.
2. Verify the request starts on the default-branch worktree, the preview reflects actual file changes, and Activity shows an Edited snapshot only when a completed comment changed files.
3. Select an element on a static preview (or use Area/Arrow for a server recipe), send anchored feedback, and reopen the resulting Edited snapshot without changing the live Draft.
4. Save the current Draft as a numbered Version after review; register the deploy key if needed and confirm the branch and tag landed remotely, then open a pull request.
5. Record whether the designer can complete the loop without terminal assistance and which context the agent actually used. Do not mistake a clean agent exit without file changes for a saved edit.

## Product direction

The intended long-term loop remains:

`Figma design + live prototype → anchored feedback → structured revision request → connected agent → new prototype revision → compare again`

Revision context may later include Figma node IDs, branch/commit references, DOM references, coordinates, viewport details, screenshot/render crops and surrounding project context.

## UI status

The integration branch uses the feedback-UI visual system for Projects, project Create, Settings and workspace review. Create retains the rich Markdown editor and optional validated Figma URL; request submission uses the actual default branch and model readiness. Activity shows a compact live status and a settled short summary for structured requests and direct terminal turns; verbose output remains in durable request records rather than the cards. The terminal stays accessible from the workspace rather than serving as the primary review UI.

## Repository / continuity workflow

Repository: `mattatgit/dialogue`

- `main` — stable baseline; eventually production
- `develop` — current integration branch and standard context-loading source
- `feature/*` — focused implementation work

GitHub is the source of truth for Dialogue implementation files and durable project context. `.dialogue-data/` (repos, workspaces, home) stays outside Git.
