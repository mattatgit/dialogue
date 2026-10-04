# Dialogue — Development Workflow

## Current state

`develop` contains the git-workspace + web-terminal functional build plus durable project documentation.

The three earlier functional milestones (Landline V22, V23, V24; see `docs/CURRENT.md`) used a separate revision store. That model was replaced on 2026-09-23 by git worktrees and an embedded `omp` terminal (`docs/superpowers/specs/2026-09-23-git-workspaces-web-terminal-design.md`).

The current product-development goal is the first **real designer-driven change** made through a structured review comment on a Landline branch, saved as a Version and opened as a pull request; the web terminal remains a fallback.

The immediate goal is still not a production framework/database/hosting migration. Production infrastructure remains deferred until that loop has been dogfooded.

## Local development (Nix)

The repo ships a Nix flake devshell (`nix/devshell.nix`) providing Node.js (also used by project preview servers), browser-sync, `git`, `ttyd`, `tmux`, `openssh`, Chromium for screenshots (`chromium` on Linux; on macOS Playwright's `chrome-headless-shell`, because nixpkgs' chromium is Linux-only and full Chrome builds crash headless without a desktop session) and the live-reloading `dev` command. The shell works on `x86_64-linux`, `aarch64-linux` and `aarch64-darwin`. `unzip`/`zip` and their `DIALOGUE_UNZIP`/`DIALOGUE_ZIP` variables are gone.

The devshell also provides `omp` from the `llm-agents` flake input: the terminal, preview setup, model sign-in and structured comment runs use it; Save version performs Git commit/push directly. It reads the usual `~/.omp` profiles and login, so an existing setup carries over; `DIALOGUE_OMP` points Dialogue at a different binary. The flake has no `x86_64-darwin` outputs because `llm-agents` has no omp there. On macOS the flake builds omp without its `--smoke-test` install check, which fails inside the Nix build sandbox (the binary passes it outside); `flake.nix` asserts the patched line still exists, so an upstream change fails evaluation instead of silently re-enabling it.

With [direnv](https://direnv.net) installed, `direnv allow` once in the repo root; the shell then loads automatically. Without direnv, use `nix develop`.

```sh
dev              # app at http://127.0.0.1:8080, opens it in your browser
PORT=3000 dev    # alternative port
OPEN=0 dev       # don't launch a browser
```

`dev` runs `node --watch server.js` on 4173 and puts browser-sync in front of it on `PORT`: edits to HTML/CSS/JS/assets reload open tabs (CSS is injected in place); edits to `server.js` restart the server, then reload. Both listeners are bound to localhost only. Restarting the server does not kill agent sessions: they live in tmux. Preview servers are children of the Node server and are stopped with it; they start again when a workspace is viewed. `dev` also sets `DIALOGUE_PREVIEW_PORT=4173`: preview origins (`http://<token>.preview.localhost:4173/`) go straight to Node, because browser-sync rewrites the Host header they are routed by.

`npm start` still works inside the devshell for a plain server without reload. `npm test` (`node --test test/*.test.js`) runs the unit tests and the preview end-to-end test.

When multiple Dialogue worktrees are in use, localhost ports identify running processes, not branches. Before sharing a test URL, establish which worktree the user is working on, map the server process to its working directory, and verify that worktree's page responds. If it is not running, start that worktree on an unused port. Share only its URL; a reachable server from another branch is not a substitute.

Do not copy `.dialogue-data/` between source worktrees: Git's linked checkout metadata contains absolute paths to its original mirror and worktree. A copied directory may appear intact but fail to open a branch or use the other build's Git metadata. Start with a separate data directory; if preserving a copy is necessary, repair and verify every linked worktree's `.git` and mirror `worktrees/*/gitdir` pointers before running Dialogue.

### Environment overrides

- `DIALOGUE_DATA` — data directory; default `.dialogue-data/` next to the code
- `DIALOGUE_GIT`, `DIALOGUE_TTYD`, `DIALOGUE_TMUX`, `DIALOGUE_OMP` — paths to the binaries; default is whatever PATH resolves
- `DIALOGUE_SEED` — JSON file `[{ url }]` of projects added on start (`dev` defaults it to `seed.json`)
- `DIALOGUE_CHROMIUM` / `PUPPETEER_EXECUTABLE_PATH` — Chromium for screenshots; default is PATH
- `DIALOGUE_PREVIEW_DOMAIN` — parent domain for preview origins (`<token>.<domain>`); default `<token>.preview.localhost`
- `DIALOGUE_PREVIEW_PORT` — port written into `*.preview.localhost` URLs instead of the browser's (set by `dev`)
- `PORT` — server port (default 4173; `dev` sets it for the upstream and uses its own `PORT` for browser-sync)

### Hosted build: NixOS module and demo VM

Nix files live under `nix/`: `package.nix` (the app + `bin/dialogue-server`; the wrapper prefixes PATH with `nodejs` (so preview servers find `node`/`npm`), `git`, `ttyd`, `tmux`, `openssh` and `omp`), `module.nix` (NixOS module), `vm.nix` (demo VM), `devshell.nix`.

`flake.nix` has an input `llm-agents` (`git+https://github.com/numtide/llm-agents.nix?shallow=1`, nixpkgs follows) which provides the `omp` package for the devshell, the default package and the VM.

`nixosModules.default` provides `services.dialogue`: a systemd service (`DynamicUser`, data in `/var/lib/dialogue` via `DIALOGUE_DATA`, `HOME=/var/lib/dialogue/home`, Node bound to `127.0.0.1:<port>`), an optional `services.dialogue.environmentFile` (systemd `EnvironmentFile`, missing file tolerated) for secrets such as `OPENROUTER_API_KEY`, `services.dialogue.seedProjects` (`[{ url }]`, written to `DIALOGUE_SEED`), `services.dialogue.previewDomain` (sets `DIALOGUE_PREVIEW_DOMAIN`; needs wildcard DNS, and a wildcard certificate for HTTPS; when null previews use `<token>.preview.localhost`, which only works from the host or through a forwarded localhost port such as the demo VM's), and with `services.dialogue.nginx.enable` an nginx virtual host proxying to it with WebSockets enabled, buffering off, a 1 h read timeout, `proxy_set_header Host $http_host` and `X-Forwarded-Proto`, and `serverAliases` `*.preview.localhost` (plus `*.<previewDomain>`) so preview origins reach Node. No authentication yet.

```sh
nix run .#vm    # headless VM with the module + nginx; the console prints the URL (http://127.0.0.1:8483) once Dialogue is up
```

The demo VM (`nix/vm.nix`) has 4 GiB RAM and 2 cores — the qemu-vm default of 1 GiB gets omp OOM-killed as soon as it opens its browser tool — ships `chromium` for that tool (`PUPPETEER_EXECUTABLE_PATH`), and runs sshd for debugging: `ssh -p 2222 root@127.0.0.1`, no password (demo only). Inside, `journalctl -u dialogue` and the workspace tmux sessions (socket under the service's private `/tmp`, `tmux -S <socket> ls`) are the two things to look at.

The VM's disk image `nixos.qcow2` is written to the current directory and is ignored by Git. Quit with `Ctrl-a x` (QEMU) or `poweroff` at the root prompt.

### API keys: `.env`

Copy `.env.example` to `.env` (gitignored) and set `OPENROUTER_API_KEY`. `.envrc` loads it with `dotenv_if_exists`, so `dev` and `npm start` pass it to Dialogue, which runs its tmux server (`tmux -L dialogue`) with that environment; omp therefore starts authenticated. `nix run .#vm` stages `.env` (plus `OPENROUTER_API_KEY` from the shell) into a temporary directory that the VM mounts read-only at `/run/dialogue-env` and the service reads as `EnvironmentFile`. `omp/config.yml` sets `setupVersion` so the first-run wizard is skipped, `modelRoles.default` to `openrouter/anthropic/claude-opus-5.5`, `display.hideToolActivity` / `hideThinkingBlock` so the designer sees prose, not tool calls, and `startup.checkUpdate: false` (omp is Nix-pinned; no update banner) (toggle live with `/tools`-style display commands or Settings → Appearance); use `/model` in the terminal to change it, or `/login` for providers without an API key.

For Figma-backed Create and comment requests, add a read-only `FIGMA_ACCESS_TOKEN` (`file_content:read`) to this worktree's gitignored root `.env` or server environment, then restart Dialogue. `npm start` also loads this local `.env`; an inherited variable takes precedence. The token is captured by the server and removed from child environments before model probes, agents, terminals, preview setup, Git hooks and project preview processes launch. Pasting a link still makes a chip without credentials, but submitting it returns an actionable error instead of running an agent that cannot read the design.

Git push uses a per-project SSH deploy key that Dialogue generates in `.dialogue-data/keys/` on first use; the first Save version shows the public key to register on the repository. Nothing is placed in `/var/lib/dialogue/home` by hand any more.

## Branch strategy

- `main` — stable/tested baseline; eventually production
- `develop` — integration branch and normal context-loading source
- `feature/*` — focused implementation changes

New work should normally branch from `develop`, be tested, then return through a pull request.

After making a local commit, push its branch to GitHub as part of the same task.

## Designer-first working model

The intended collaboration remains:

- Matt designs and reviews in Figma/browser
- an agent (omp in the workspace terminal for prototype work; ChatGPT or another assistant for product/UX/architecture discussion) writes/updates code
- GitHub is the durable source of truth
- `.md` project docs are updated with meaningful implementation/architecture/UI decisions
- `Load project context` reconstructs state from the repo rather than chat memory
- project/chat containers are conveniences, not the authoritative project record

## Lightweight local build

Requirements:

- Node.js 22+
- `git`, `ttyd`, `tmux`, `omp` on PATH (devshell)

Start with `dev`, `npm start` or `Start Dialogue.command` (which checks for `git`/`ttyd`/`tmux`/`omp` before starting). Open `http://127.0.0.1:8080` (`dev`) or `http://127.0.0.1:4173`.

Runtime data — bare mirrors, worktrees, preview setup trees and logs, install stamps, screenshots and the VM home — is written to `.dialogue-data/` and must not be committed.

See `docs/LOCAL_BUILD.md`.

## Relevant files

- `server.js` — http routing, static files, preview-origin dispatch, SSE, WebSocket proxy, setup/preview routes
- `server/git.js` — bare repo ensure/fetch, ref listing, worktree add/list/remove, Draft/Edited/Version Git snapshots, atomic Version publication, HEAD/dirty status, recipe lookup and setup commits, watch roots
- `server/requests.js` — durable structured comment records, agent-run observation, immutable Edited snapshots and Version save coordination
- `server/activity.js`, `omp/activity.js` — validate and write bounded private agent-turn sidecars, with settled request summaries and live direct-terminal SSE updates
- `server/projects.js` — `db.json` store (schemaVersion 4, v2/v3 migration, `previewSetup`)
- `server/recipe.js` — `.dialogue/preview.json` parser
- `server/runner.js` — `Runner` (install stamp, dev server in its own process group, readiness probe) and `RunnerPool` (idle stop)
- `server/preview-proxy.js` — per-workspace preview origins: HTTP/WebSocket proxy, static file serving, status pages
- `server/live-preview.js` — runners per viewed workspace, SSE `runner` payloads, branch screenshots
- `server/setup.js` — preview setup pipeline (agent run, validation, retries, recipe commit, refresh)
- `server/preview.js` — headless-Chromium screenshots and the per-commit / `main.png` cache
- `server/agent-auth.js` — AI model readiness, model selection, web sign-in
- `server/terminal.js` — ttyd lifecycle per branch workspace, prompt injection
- `server/watch.js` — debounced `fs.watch` → SSE fan-out
- `projects.html`, `js/projects.js` — Projects page, card Preview status line and setup failure actions
- `project.html`, `js/project-refs.js` — branch/tag tiles, "from main" screenshot label
- `workspace.html`, `js/workspace.js` — split-screen workspace page, preview iframe on the preview origin, runner states, Restart preview, "Fix with agent" hand-off
- `js/prototype-review.mjs`, `css/prototype-review.css` — Activity cards, anchored comments, read-only snapshot previews and Save version
- `js/terminal.js`, `js/vendor/xterm*.js`, `css/terminal.css` — terminal pane
- `omp/config.yml`, `omp/system-prompt.md`, `omp/tmux.conf`, `omp/dialogue-theme.json` — agent runtime config
- `omp/preview-setup-prompt.md`, `omp/preview-fix-prompt.md` — preview setup/repair prompts Dialogue hands the agent
- `assets/fonts/SpaceMono-*.ttf`, `assets/fonts/InterTight-Latin.woff2` — terminal grid and panel chrome (OFL)
- `test/*.test.js` — unit tests per module plus `preview-e2e.test.js` and `agent-auth.e2e.test.js`

## Repository hygiene

Do not commit:

- `.dialogue-data/`
- `.env` files
- API keys or access tokens
- service credentials or anything from an omp home directory
- user passwords/auth credentials
- generated `node_modules/`
- runtime logs
- `nixos.qcow2`

## Visual baseline

Figma and the existing static prototype remain the visual baseline.

Functional work should preserve existing UI behaviour unless the task explicitly changes it. Temporary functional UI that has not been designed in Figma must be documented as temporary rather than silently becoming the new design source of truth.

The branch/tag tiles and the split-screen workspace are temporary functional UI. See `docs/DESIGN.md`.

## Regression checklist for current local build

When touching git/workspace/terminal/preview behaviour, preserve:

- localhost server startup
- static Dialogue pages
- `GET /api/projects/:slug/refs` lists branches and tags after a fetch, and still lists local refs with `fetchError` when offline
- adding a project queues its preview setup; the card goes Waiting to set up → Setting up… → Ready, commits `.dialogue/preview.json` on the local default branch ("Add Dialogue preview recipe") and shows a screenshot
- with no AI model signed in, the card says Waiting for an AI model and setup resumes by itself after signing in
- a failing setup ends as Setup failed after 3 tries, with a reason, Retry, Fix with agent and Show log; the log is at `.dialogue-data/setup/<slug>/log.txt`
- opening a branch creates a worktree under `.dialogue-data/workspaces/<slug>/<encoded-ref>/` and is idempotent on reopen
- the preview iframe loads from `http://<token>.preview.localhost:<port>/`, never from Dialogue's own origin; installing/starting messages show while a server recipe comes up
- a dev server's own HMR works through the preview origin (`reload: "self"`); with `reload: "dialogue"` saving a file reloads the iframe
- editing `.dialogue/preview.json` restarts the preview; killing the dev server shows the crash log and **Restart preview** brings it back
- the terminal connects and omp starts inside the worktree
- closing and reopening the tab reattaches to the same tmux session
- editing a project file flips the chip to uncommitted changes; Save version publishes a numbered tag and updates the branch/head chip only after remote confirmation
- completed comments with file changes retain private reopenable Edited commits; no-change and failed runs never appear as Edited
- the live Draft persists alongside Edited and Vn cards; opening a snapshot gives a read-only worktree and Draft returns to the source branch
- rejected pushes leave a retryable Draft, never an advertised Version or pushed private edit refs
- a tag workspace renders full-width with no terminal and no ttyd is spawned
- `DELETE /api/workspaces/:id` stops the terminal and preview server and removes the worktree
- a static preview refuses paths outside the recipe's `root`
- prototype interaction inside the sandboxed iframe
- branch tiles without their own screenshot show the main image labelled "from main"
- Restart / `R`
- runtime files remaining outside Git
- `npm test` passes

## Near-term build sequence

1. run the workspace end to end locally on a Landline branch: send anchored feedback, watch the preview reload and reopen an Edited snapshot
2. select Draft and Save version, register the deploy key on first use, verify remote commit and numbered tag; open a PR
3. repeat in `nix run .#vm` with `.env` providing the API key
4. record what context omp needed and where the designer had to leave the pane
5. use that to shape the designed conversation UI and the structured revision-request context
6. only then finalize production hosting/auth/storage choices

## Production deployment direction

Production architecture is deliberately deferred while the core workflow is still being proven.

The current lean candidate is a small self-hosted host running the NixOS module with nginx, `omp` from the `llm-agents` input, persistent `/var/lib/dialogue` for repos/worktrees/home, off-server backups, real authentication in front of the app and terminal, and a separate prototype execution origin. The earlier Vercel/Supabase/R2 architecture remains an available managed alternative, not the current default.

Production must preserve a separate browser origin for untrusted checked-out/generated prototype code.
