# Git workspaces + embedded omp web terminal — design

Status: approved in conversation 2026-09-23. Supersedes the ZIP import and MCP bridge.

## Goal

A designer opens a branch of a project's git repository in Dialogue and sees, side by side, an
agent terminal (oh-my-pi, `omp`) running inside that branch's checkout and a live preview of the
prototype that reloads on every file change. No ZIPs, no MCP bridge, no separate revision store:
git is the revision model.

Must work identically for the local dev server (`dev` from the devshell) and the NixOS VM
(`nix run .#vm`).

## 1. Data model and storage

`db.json` schemaVersion 2. A project carries its git source. `prototypes` and `revisions` tables
are removed; any v1 file is replaced by the v2 seed on startup (it was runtime scaffolding).

```json
{
  "schemaVersion": 2,
  "projects": [
    {
      "id": "project-landline",
      "slug": "landline",
      "name": "Landline",
      "description": "A simpler way for households to stay in touch.",
      "repo": { "url": "https://github.com/mattatgit/landline", "prototypePath": "prototypes/app" }
    }
  ]
}
```

On disk under `DIALOGUE_DATA`:

```
repos/<slug>.git            bare clone, fetched on demand (`git fetch --prune origin`)
workspaces/<slug>/<ref>/    one git worktree per opened ref; <ref> is encodeURIComponent(ref)
home/                       omp profile + credentials in the VM only (dev uses the real $HOME)
```

Workspaces have no db table: `git worktree list --porcelain` on the bare repo is the source of
truth. Workspace id = `<slug>/<encoded ref>`.

- Branch workspace: `git worktree add <dir> <branch>` (local tracking branch created from
  `origin/<branch>` on first open), writable, gets a terminal.
- Tag or commit workspace: `git worktree add --detach <dir> <sha>`, read-only, no terminal.

## 2. Server

`server.js` keeps http routing/static/proxying. New Node-builtins-only modules:

- `server/git.js` — bare repo ensure/fetch, ref listing, worktree add/list/remove, HEAD/dirty
  status, exec wrapper (`DIALOGUE_GIT` overrides the binary).
- `server/terminal.js` — ttyd lifecycle per branch workspace.
- `server/watch.js` — `fs.watch` (recursive) on `<worktree>/<prototypePath>` plus the worktree's
  `.git` file/HEAD, debounced 150 ms, fan-out to SSE clients.

### API

Replaces `/api/prototypes`, `/api/projects/:slug/revisions`, `/api/revisions/:id` and
`POST /api/projects/:slug/import`.

| Route | Behavior |
|---|---|
| `GET /api/projects` | projects incl. `repo` |
| `GET /api/projects/:slug/refs` | fetch, then `{ branches:[{name,sha,subject,committedAt,open}], tags:[…], fetchError? }`. Fetch failure returns last local refs plus `fetchError`; never 5xx unless the bare repo cannot be created at all |
| `POST /api/projects/:slug/workspaces` `{ref}` | idempotent; ensures the worktree; returns the workspace |
| `GET /api/workspaces/:id` | `{ id, project:{slug,name}, ref, kind:"branch"\|"tag"\|"commit", head:{sha,subject}, dirty, viewerUrl, entryPoint, terminal:boolean }` |
| `DELETE /api/workspaces/:id` | stops the terminal, `git worktree remove --force` |
| `GET /api/workspaces/:id/events` | SSE, event `change` with `{ head, dirty }` |
| `GET /workspace-files/:id/*` | serves `<worktree>/<prototypePath>/*`, same path-safety rules as the old prototype file server |
| `GET /ws/terminal/:id` | WebSocket upgrade, proxied byte-for-byte to the workspace's ttyd |

### Terminal process

One ttyd per branch workspace, started lazily on the first WebSocket client, listening on a UNIX
socket under the system temp directory (no TCP port):

```
ttyd -i <tmp>/dialogue-term-*/<hash>.sock -W -b /ws/terminal/<id> -T xterm-256color \
  tmux -f <app>/omp/tmux.conf new-session -A -s dialogue-<hash> -c <worktree> \
    omp --config <app>/omp/config.yml --append-system-prompt <app>/omp/system-prompt.md
```

tmux keeps the omp session alive across tab closes and reconnects (ttyd runs a fresh command per
client). omp runs under the user's own profile (`OMP_PROFILE` is honoured) so existing credentials
and settings apply; before spawning, `omp/dialogue-theme.json` is copied to that profile's
`themes/dialogue.json` when missing or changed and selected through the `--config` overlay.
Binaries come from PATH; `DIALOGUE_OMP`, `DIALOGUE_TTYD`, `DIALOGUE_TMUX`, `DIALOGUE_GIT` override.
ttyd is a child of Dialogue and is killed on shutdown; tmux sessions survive Dialogue restarts by
design; the session name carries a checksum of `omp/*` (computed by `omp/attach.sh` on every
client connect) so overlay edits take effect on the next reconnect.

Missing binaries or a ttyd that exits before its socket accepts connections close the WebSocket
with code 1011 and the error as the close reason; the UI shows it in place of "Reconnecting…".

## 3. UI

- `project-landline.html`: Import button, modal and static fallback tiles removed. The grid shows
  a **Branches** group and, when non-empty, a **Tags** group. Tiles reuse `.proto-tile`: ref name,
  short sha, commit subject, relative commit date, an "open" dot when a workspace exists. Click →
  `POST workspaces` → `workspace.html?id=…`. `fetchError` renders as a one-line note above the
  grid; tiles still render from local refs.
- `prototype.html` → `workspace.html`; `js/prototype-viewer.js` → `js/workspace.js`. Same dark
  viewer bar; crumbs `Projects › Landline › <ref>`; status chip `<sha7> · clean` /
  `· uncommitted changes` updated on every SSE `change`. Two-column body: terminal pane left
  (`minmax(420px, 44%)`), prototype stage right with the existing 370×722 sandboxed iframe,
  Restart/`R` kept; `change` reloads the iframe. Tag/commit workspaces render the stage
  full-width without a terminal.
- Terminal pane: vendored xterm.js 5.5 + fit addon (`js/vendor/`), `js/terminal.js` speaks
  ttyd's protocol (initial `{AuthToken,columns,rows}` JSON; `0`+data both ways; `1`+JSON resize
  to server; ignore `1` title / `2` prefs from server). ResizeObserver → fit → resize. On close a
  dimmed overlay shows "Reconnecting…" with 1 s → 8 s backoff, or the server's error reason.
- Look (`css/terminal.css`): JetBrains Mono woff2 in `assets/fonts/` (OFL), 13 px / 1.45,
  24 px pane padding, hidden scrollbar chrome, non-blinking block cursor. One palette shared by
  the xterm theme and `omp/dialogue-theme.json`: bg `#171717`, fg `#f8f8f8`, muted `#9ea39e`,
  borders `#272727`/`#3a3a3a`, accent `#ccff00`, success `#17b239`, error `#e5484d`, warning
  `#f5a623`, selection `rgba(204,255,0,.25)`, restrained syntax tints.

## 4. Nix / dev / VM

- `nix/devshell.nix`: add `git`, `ttyd`, `tmux`; drop `unzip`/`zip` and their env. `omp` is
  deliberately not added: the developer's own `omp` on PATH is used.
- `nix/package.nix`: fileset adds `server/`, `omp/`, `assets/fonts`, `js/vendor`; wrapper
  prefixes PATH with `git`, `ttyd`, `tmux` and, when the `omp` argument is given, that package.
- `flake.nix`: input `llm-agents` (`git+https://github.com/numtide/llm-agents.nix?shallow=1`,
  nixpkgs follows). VM passes `llm-agents.packages.${system}.omp`.
- `nix/module.nix`: `HOME=${dataDir}/home` in the unit; nginx `proxyWebsockets = true`,
  `proxy_buffering off`, `proxy_read_timeout 1h`; `client_max_body_size` dropped; new option
  `services.dialogue.omp` (nullable package).
- First VM use: open a branch, run `/login` in the web terminal. Git push credentials are placed
  in `${dataDir}/home` by hand; documented, not automated.

## 5. Removal and docs

Deleted: `mcp-server.mjs`, `scripts/publish-revision.js`, `scripts/test-mcp.mjs`,
`Publish API Test.command`, `Test MCP Bridge.command`, `Setup Dialogue for ChatGPT.command`,
`Start Dialogue with ChatGPT.command`, `js/local-import.js`, `docs/MCP.md`, import CSS in
`local-functional.css`, `package.json` MCP deps/scripts, all ZIP/unzip code.
`Start Dialogue.command` checks for `git`/`ttyd`/`tmux`/`omp`.

Docs rewritten to the new model: README, CURRENT, ARCHITECTURE, API, LOCAL_BUILD, DEVELOPMENT,
DESIGN (split-screen is temporary functional UI), PRODUCT next milestone. The ChatGPT Business
MCP milestone is recorded as superseded.

## Testing

`node --test test/` covers `server/git.js` ref parsing and workspace-id/path safety. Smoke: `dev`
locally (open `main`, ask omp for a colour change, iframe reloads) and `nix run .#vm` end to end.
