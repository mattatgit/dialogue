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

- localhost-only Node server (`server.js`) with Node-builtins-only modules `server/git.js`, `server/terminal.js`, `server/watch.js`
- `.dialogue-data/db.json` schemaVersion 2: projects only, each with `repo: { url, prototypePath }`; Landline → `https://github.com/mattatgit/landline`, `prototypes/app`
- bare mirror per project at `.dialogue-data/repos/<slug>.git`, fetched with `git fetch --prune origin` when refs are listed
- one git worktree per opened ref at `.dialogue-data/workspaces/<slug>/<encoded-ref>/`; `git worktree list --porcelain` is the source of truth for workspaces (no db table)
- branch workspaces writable with a terminal; tag/commit workspaces detached, read-only, no terminal
- project page (`project-landline.html`) with Branches and Tags tile groups from live refs, "open" dot on tiles with a workspace, `fetchError` note when the fetch fails
- `workspace.html` + `js/workspace.js`: crumbs `Projects › Landline › <ref>`, status chip `<sha7> · clean` / `· uncommitted changes`, terminal pane left, 370×722 sandboxed prototype iframe right, Restart / `R`
- web terminal: `js/terminal.js` over vendored xterm.js 5.5 (`js/vendor/`), speaking ttyd's protocol through the `/ws/terminal/:id` WebSocket proxy, with reconnect backoff and server error display
- terminal process: ttyd → `omp/attach.sh` → tmux (`-L dialogue`, `omp/tmux.conf`) → `omp --config omp/config.yml --append-system-prompt omp/system-prompt.md`, started lazily on the first WebSocket client; tmux sessions survive Dialogue restarts but rotate when `omp/*` changes
- `omp/dialogue-theme.json` installed into the active omp profile's themes directory before spawn; `css/terminal.css` shares its palette; JetBrains Mono in `assets/fonts/`
- SSE `GET /api/workspaces/:id/events` fed by a debounced recursive `fs.watch` on the prototype path and the worktree HEAD; `change` events reload the iframe and update the chip
- `Start Dialogue.command` checking for `git`/`ttyd`/`tmux`/`omp`
- Nix: devshell with `git`/`ttyd`/`tmux`, `flake.nix` input `llm-agents` providing `omp` to the VM, NixOS module with `HOME=${dataDir}/home`, nginx WebSocket proxying and `services.dialogue.omp`
- `test/git.test.js` (`node --test test/`) covering ref parsing and workspace-id/path safety

Removed: `mcp-server.mjs`, `scripts/publish-revision.js`, `scripts/test-mcp.mjs`, every `*.command` except `Start Dialogue.command`, `js/local-import.js`, `docs/MCP.md`, ZIP/unzip code, `/api/revisions`, `/api/prototypes`, the import route, and the MCP npm dependencies.

## Current local requirements

No production web services are required for the local build.

- Node.js 22+
- `git`, `ttyd`, `tmux` on PATH (devshell provides them)
- `omp` on PATH (the developer's own)

Normal start: `dev` in the devshell, `npm start`, or `Start Dialogue.command`. VM: `nix run .#vm`.

In the VM, `HOME` is `/var/lib/dialogue/home`. On first use open a branch and run `/login` in the web terminal. Git push credentials are placed in that home directory by hand; this is documented, not automated.

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
4. have the agent commit and push the branch, then open a pull request
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
