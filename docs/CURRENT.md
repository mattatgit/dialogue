# Dialogue — Current State

This is the concise continuity record for active Dialogue work. Update it whenever a meaningful milestone, decision, known issue or next step changes.

## Current status

Three earlier lightweight milestones were completed and merged into `develop`:

1. PR #1 — local prototype ZIP import/viewer (Landline V22 imported and ran correctly)
2. PR #2 — external HTTP/API revision publishing (V23)
3. PR #3 — local MCP / LLM bridge baseline (V24, a non-visible change)

They proved that Dialogue could hold immutable prototype revisions and that a machine client could publish one. They are now **superseded** by the git-workspace + web-terminal build approved on 2026-09-23 (`docs/superpowers/specs/2026-09-23-git-workspaces-web-terminal-design.md`). The planned ChatGPT Business custom-MCP connection was dropped with them: the agent now runs inside Dialogue instead of connecting to it from outside.

The new model: a project carries its git repository (`repo.url`, `repo.prototypePath`). Dialogue fetches refs, and opening a branch creates a git worktree and a split-screen workspace with an `omp` web terminal on the left and a live-reloading prototype preview on the right. Git is the revision model; there is no separate revision store, no ZIPs and no MCP bridge.

The standard fresh-chat context phrase is **`Load project context`**.

## Current build

`develop` provides:

- localhost-only Node server (`server.js`) with Node-builtins-only modules `server/git.js`, `server/projects.js`, `server/deploy-key.js`, `server/terminal.js`, `server/watch.js`
- `.dialogue-data/db.json` schemaVersion 3: projects only, `{ slug: "<owner>-<repo>", repo: { url, host, owner, repo, prototypePath } }`; nothing hardcoded — projects are added from the Projects page (paste any HTTPS/SSH git URL; the prototype directory is detected) or seeded from the JSON file named by `DIALOGUE_SEED` (`seed.json` → Landline; `dev` sets it, the NixOS module builds it from `services.dialogue.seedProjects`). Duplicate repo names display as `owner/repo`. Projects can be removed from their card
- bare mirror per project at `.dialogue-data/repos/<slug>.git`, fetched with `git fetch --prune origin` when refs are listed
- one git worktree per opened ref at `.dialogue-data/workspaces/<slug>/<encoded-ref>/`; `git worktree list --porcelain` is the source of truth for workspaces (no db table)
- branch workspaces writable with a terminal; tag/commit workspaces detached, read-only, no terminal
- project page (`project.html?slug=…`) with Branches and Tags tile groups from live refs, "open" dot on tiles with a workspace, `fetchError` note when the fetch fails; a private SSH repository shows the "Connect Dialogue to your repository" panel (shared `js/connect-panel.js`) until its deploy key is registered
- `workspace.html` + `js/workspace.js`: crumbs `Projects › Landline › <ref>`, status chip `<sha7> · clean` / `· uncommitted changes`, terminal pane left, 370×722 sandboxed prototype iframe right, Restart / `R`
- web terminal: `js/terminal.js` over vendored xterm.js 5.5 (`js/vendor/`), speaking ttyd's protocol through the `/ws/terminal/:id` WebSocket proxy, with reconnect backoff and server error display
- terminal process: ttyd → `omp/attach.sh` → tmux (`-L dialogue`, `omp/tmux.conf`) → `omp --config omp/config.yml --append-system-prompt omp/system-prompt.md`, started lazily on the first WebSocket client; tmux sessions survive Dialogue restarts but rotate when `omp/*` changes
- `omp/dialogue-theme.json` installed into the active omp profile's themes directory before spawn; `css/terminal.css` shares its palette; JetBrains Mono in `assets/fonts/`
- SSE `GET /api/workspaces/:id/events` fed by a debounced recursive `fs.watch` on the prototype path and the worktree HEAD; `change` events reload the iframe and update the chip
- COMMIT button on dirty/ahead branch workspaces: `POST /api/workspaces/:id/commit` checks the remote accepts the project's deploy key, then types `omp/commit-prompt.md` into the workspace's tmux session so omp commits and pushes; the chip shows `· N to push` between commit and push
- per-project SSH deploy key (`.dialogue-data/keys/<slug>`), generated on first use by `server/deploy-key.js`; fetch stays HTTPS, `remote.origin.pushurl` + `core.sshCommand` on the bare mirror make push use the key. First commit without a registered key opens the "Connect Dialogue to your repository" panel with the public key and step-by-step instructions written for a designer
- `Start Dialogue.command` checking for `git`/`ttyd`/`tmux`/`omp`/`ssh`/`ssh-keygen`
- Nix: devshell with `git`/`ttyd`/`tmux`/`openssh`, `flake.nix` input `llm-agents` providing `omp` to the VM, NixOS module with `HOME=${dataDir}/home`, nginx WebSocket proxying and `services.dialogue.omp`
- `test/git.test.js` and `test/deploy-key.test.js` (`npm test`) covering ref parsing, workspace-id/path safety, push-URL derivation and push-error classification

Removed: `mcp-server.mjs`, `scripts/publish-revision.js`, `scripts/test-mcp.mjs`, every `*.command` except `Start Dialogue.command`, `js/local-import.js`, `docs/MCP.md`, ZIP/unzip code, `/api/revisions`, `/api/prototypes`, the import route, and the MCP npm dependencies.

## Current local requirements

No production web services are required for the local build.

- Node.js 22+
- `git`, `ttyd`, `tmux`, `ssh`/`ssh-keygen`/`ssh-keyscan` on PATH (devshell provides them; OpenSSH ships with macOS)
- `omp` on PATH (the developer's own)

Normal start: `dev` in the devshell, `npm start`, or `Start Dialogue.command`. VM: `nix run .#vm`.

In the VM, `HOME` is `/var/lib/dialogue/home`. On first use open a branch and run `/login` in the web terminal. Pushing needs no hand-placed credentials: the first COMMIT shows the project's public deploy key to add to the repository.

## Architecture direction

The current local architecture remains product-validation scaffolding:

- existing HTML/CSS/JS Dialogue UI
- small Node HTTP server with SSE and a WebSocket proxy
- git as the store: bare mirror + worktrees, no separate revision database
- ttyd + tmux + omp as the agent runtime
- sandboxed iframe preview served from the worktree
- no real auth or production hosting yet

Do not productionize infrastructure yet unless the real designer-driven test exposes a requirement that forces it.

The lean production candidate remains a small self-hosted deployment (the NixOS module is the current shape of it), persistent storage for repos/worktrees, automated off-server backups and a separate prototype origin for untrusted prototype code.

## Next milestone

The first **real designer-driven change** through the web terminal:

1. open a Landline branch in Dialogue (locally via `dev`, then in the VM)
2. ask `omp` in the terminal for one small visible change to the prototype
3. watch the preview reload with the change and the chip show uncommitted changes
4. press COMMIT; on first use add the shown deploy key to the repository, then let the agent commit and push; open a pull request
5. record what context the agent needed and what the split screen got wrong or right

The key product question is whether a designer can drive a useful change end to end from inside Dialogue without touching developer tooling outside the terminal pane.

## Product direction

The intended long-term loop remains:

`Figma design + live prototype → anchored feedback → structured revision request → connected agent → new prototype revision → compare again`

Revision context may later include Figma node IDs, branch/commit references, DOM references, coordinates, viewport details, screenshot/render crops and surrounding project context.

## UI status

Figma remains the source of truth for designed UI.

The branch/tag tiles on the project page and the split-screen workspace are temporary functional UI suitable for product validation. The terminal's typography and palette are a deliberate designer-facing choice, but the raw terminal pane itself will be superseded by a designed conversation UI. Settings remains intentionally incomplete while the agent model is being proven.

## Repository / continuity workflow

Repository: `mattatgit/dialogue`

- `main` — stable baseline; eventually production
- `develop` — current integration branch and standard context-loading source
- `feature/*` — focused implementation work

GitHub is the source of truth for Dialogue implementation files and durable project context. `.dialogue-data/` (repos, workspaces, home) stays outside Git.
