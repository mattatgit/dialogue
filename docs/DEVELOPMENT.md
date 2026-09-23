# Dialogue — Development Workflow

## Current state

`develop` contains the git-workspace + web-terminal functional build plus durable project documentation.

The three earlier functional milestones (Landline V22, V23, V24; see `docs/CURRENT.md`) used a separate revision store. That model was replaced on 2026-09-23 by git worktrees and an embedded `omp` terminal (`docs/superpowers/specs/2026-09-23-git-workspaces-web-terminal-design.md`).

The current product-development goal is the first **real designer-driven change** made through the web terminal on a Landline branch, pushed and opened as a pull request.

The immediate goal is still not a production framework/database/hosting migration. Production infrastructure remains deferred until that loop has been dogfooded.

## Local development (Nix)

The repo ships a Nix flake devshell (`nix/devshell.nix`) providing Node.js, browser-sync, `git`, `ttyd`, `tmux` and the live-reloading `dev` command. `unzip`/`zip` and their `DIALOGUE_UNZIP`/`DIALOGUE_ZIP` variables are gone.

`omp` is deliberately **not** in the devshell: Dialogue uses the developer's own `omp` on PATH so the agent, its profiles and its login are the ones you already use.

With [direnv](https://direnv.net) installed, `direnv allow` once in the repo root; the shell then loads automatically. Without direnv, use `nix develop`.

```sh
dev              # app at http://127.0.0.1:8080, opens it in your browser
PORT=3000 dev    # alternative port
OPEN=0 dev       # don't launch a browser
```

`dev` runs `node --watch server.js` on 4173 and puts browser-sync in front of it on `PORT`: edits to HTML/CSS/JS/assets reload open tabs (CSS is injected in place); edits to `server.js` restart the server, then reload. Both listeners are bound to localhost only. Restarting the server does not kill agent sessions: they live in tmux.

`npm start` still works inside the devshell for a plain server without reload. `node --test test/` runs the unit tests (`test/git.test.js`: ref parsing, workspace-id/path safety).

### Environment overrides

- `DIALOGUE_DATA` — data directory; default `.dialogue-data/` next to the code
- `DIALOGUE_GIT`, `DIALOGUE_TTYD`, `DIALOGUE_TMUX`, `DIALOGUE_OMP` — paths to the binaries; default is whatever PATH resolves
- `PORT` — server port (default 4173; `dev` sets it for the upstream and uses its own `PORT` for browser-sync)

### Hosted build: NixOS module and demo VM

Nix files live under `nix/`: `package.nix` (the app + `bin/dialogue-server`; the wrapper prefixes PATH with `git`, `ttyd`, `tmux` and, when given, `omp`), `module.nix` (NixOS module), `vm.nix` (demo VM), `devshell.nix`.

`flake.nix` has an input `llm-agents` (`git+https://github.com/numtide/llm-agents.nix?shallow=1`, nixpkgs follows) which provides the `omp` package for the VM.

`nixosModules.default` provides `services.dialogue`: a systemd service (`DynamicUser`, data in `/var/lib/dialogue` via `DIALOGUE_DATA`, `HOME=/var/lib/dialogue/home`, Node bound to `127.0.0.1:<port>`), an optional `services.dialogue.environmentFile` (systemd `EnvironmentFile`, missing file tolerated) for secrets such as `OPENROUTER_API_KEY`, and with `services.dialogue.nginx.enable` an nginx virtual host proxying to it with WebSockets enabled, buffering off and a 1 h read timeout. No authentication yet.

```sh
nix run .#vm    # headless VM with the module + nginx; the console prints the URL (http://127.0.0.1:8483) once Dialogue is up
```

The demo VM (`nix/vm.nix`) has 4 GiB RAM and 2 cores — the qemu-vm default of 1 GiB gets omp OOM-killed as soon as it opens its browser tool — ships `chromium` for that tool (`PUPPETEER_EXECUTABLE_PATH`), and runs sshd for debugging: `ssh -p 2222 root@127.0.0.1`, no password (demo only). Inside, `journalctl -u dialogue` and the workspace tmux sessions (socket under the service's private `/tmp`, `tmux -S <socket> ls`) are the two things to look at.

The VM's disk image `nixos.qcow2` is written to the current directory and is ignored by Git. Quit with `Ctrl-a x` (QEMU) or `poweroff` at the root prompt.

### API keys: `.env`

Copy `.env.example` to `.env` (gitignored) and set `OPENROUTER_API_KEY`. `.envrc` loads it with `dotenv_if_exists`, so `dev` and `npm start` pass it to Dialogue, which runs its tmux server (`tmux -L dialogue`) with that environment; omp therefore starts authenticated. `nix run .#vm` stages `.env` (plus `OPENROUTER_API_KEY` from the shell) into a temporary directory that the VM mounts read-only at `/run/dialogue-env` and the service reads as `EnvironmentFile`. `omp/config.yml` sets `setupVersion` so the first-run wizard is skipped, `modelRoles.default` to `openrouter/anthropic/claude-opus-5.5`, `display.hideToolActivity` / `hideThinkingBlock` so the designer sees prose, not tool calls, and `startup.checkUpdate: false` (omp is Nix-pinned; no update banner) (toggle live with `/tools`-style display commands or Settings → Appearance); use `/model` in the terminal to change it, or `/login` for providers without an API key.

Git push credentials for the Landline remote are still placed in `/var/lib/dialogue/home` by hand in the VM (for example a credential helper or SSH key); this is documented, not automated.

## Branch strategy

- `main` — stable/tested baseline; eventually production
- `develop` — integration branch and normal context-loading source
- `feature/*` — focused implementation changes

New work should normally branch from `develop`, be tested, then return through a pull request.

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
- `git`, `ttyd`, `tmux` on PATH (devshell)
- `omp` on PATH

Start with `dev`, `npm start` or `Start Dialogue.command` (which checks for `git`/`ttyd`/`tmux`/`omp` before starting). Open `http://127.0.0.1:8080` (`dev`) or `http://127.0.0.1:4173`.

Runtime data — bare mirrors, worktrees and the VM home — is written to `.dialogue-data/` and must not be committed.

See `docs/LOCAL_BUILD.md`.

## Relevant files

- `server.js` — http routing, static files, `/workspace-files`, SSE, WebSocket proxy
- `server/git.js` — bare repo ensure/fetch, ref listing, worktree add/list/remove, HEAD/dirty status, exec wrapper
- `server/terminal.js` — ttyd lifecycle per branch workspace
- `server/watch.js` — debounced `fs.watch` → SSE fan-out
- `workspace.html`, `js/workspace.js` — split-screen workspace page
- `js/terminal.js`, `js/vendor/xterm*.js`, `css/terminal.css` — terminal pane
- `omp/config.yml`, `omp/system-prompt.md`, `omp/tmux.conf`, `omp/dialogue-theme.json` — agent runtime config
- `assets/fonts/JetBrainsMono-*.woff2` — terminal typeface (OFL)
- `test/git.test.js` — unit tests

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
- opening a branch creates a worktree under `.dialogue-data/workspaces/<slug>/<encoded-ref>/` and is idempotent on reopen
- the terminal connects and omp starts inside the worktree
- closing and reopening the tab reattaches to the same tmux session
- editing a file under the prototype path reloads the preview and flips the chip to uncommitted changes; committing flips it back
- a tag workspace renders full-width with no terminal and no ttyd is spawned
- `DELETE /api/workspaces/:id` stops the terminal and removes the worktree
- `/workspace-files/:id/*` refuses paths outside the prototype path
- prototype interaction inside the sandbox
- Restart / `R`
- runtime files remaining outside Git
- `node --test test/` passes

## Near-term build sequence

1. run the split-screen workspace end to end locally on a Landline branch: ask omp for a visible change, watch the preview reload
2. commit and push from the terminal; open a PR
3. repeat in `nix run .#vm` with `.env` providing the API key and hand-placed push credentials
4. record what context omp needed and where the designer had to leave the pane
5. use that to shape the designed conversation UI and the structured revision-request context
6. only then finalize production hosting/auth/storage choices

## Production deployment direction

Production architecture is deliberately deferred while the core workflow is still being proven.

The current lean candidate is a small self-hosted host running the NixOS module with nginx, `omp` from the `llm-agents` input, persistent `/var/lib/dialogue` for repos/worktrees/home, off-server backups, real authentication in front of the app and terminal, and a separate prototype execution origin. The earlier Vercel/Supabase/R2 architecture remains an available managed alternative, not the current default.

Production must preserve a separate browser origin for untrusted checked-out/generated prototype code.
