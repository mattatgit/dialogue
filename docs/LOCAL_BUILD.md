# Dialogue — Lightweight Local Functional Build

## Purpose

This build exists to prove Dialogue's core product workflow — open a project branch, ask an agent for a change, see the prototype update, push the result — before committing to production hosting, authentication, database or storage services.

No production web-service accounts are required for the local application itself.

The current dogfood project is Landline (`https://github.com/mattatgit/landline`, prototype at `prototypes/app`). The earlier V22/V23/V24 runtime history on Matt's Mac belongs to the superseded revision-store model recorded in `docs/CURRENT.md`; those revisions do not exist in this build.

## Current architecture

The local build runs on one machine:

```text
Browser
  ├── Dialogue UI + /api/*          HTTP
  ├── /api/workspaces/:id/events    SSE → reload preview on change
  └── /ws/terminal/:id              WebSocket → ttyd → tmux → omp
        ↓
Dialogue local Node server (server.js, server/git.js, server/watch.js, server/terminal.js)
        ↓
.dialogue-data/
  db.json                     projects (schemaVersion 2) with repo.url / repo.prototypePath
  repos/<slug>.git            bare mirror, fetched on demand
  workspaces/<slug>/<ref>/    one git worktree per opened ref (<ref> URL-encoded)
  keys/<slug>, <slug>.pub     per-project SSH deploy key (push only) + known_hosts
  home/                       omp profile + credentials — VM only; dev uses the real $HOME
```

`.dialogue-data/` is ignored by Git.

Workspaces have no database table: `git worktree list --porcelain` on the bare mirror is the source of truth. Git is the revision model; there is no separate revision store.

## Start

Requirements:

- Node.js 22+
- `git`, `ttyd`, `tmux` on PATH — the Nix devshell provides them
- `omp` (oh-my-pi) on PATH — your own install; the devshell deliberately does not provide it

Start with one of:

```text
dev                       # devshell: live-reloading dev server, http://127.0.0.1:8080
npm start                 # plain server, http://127.0.0.1:4173
Start Dialogue.command    # macOS launcher for npm start; checks git/ttyd/tmux/omp are present
```

The server binds to localhost only.

## Workflow

1. Open Projects → Landline. Dialogue fetches the repository and shows a **Branches** group and, when there are any, a **Tags** group. Each tile shows the ref name, short sha, commit subject and relative commit date; a dot marks refs that already have a workspace. If the fetch fails (offline), a one-line note appears and tiles render from the last local refs.
2. Click a branch. Dialogue creates the worktree (first open creates a local tracking branch from `origin/<branch>`) and opens `workspace.html?id=…`.
3. The workspace is split: the **terminal** on the left, running `omp` inside that branch's checkout; the **prototype preview** on the right in the familiar 370×722 sandboxed iframe, served from `<worktree>/prototypes/app`. Crumbs read `Projects › Landline › <branch>`; the status chip shows `<sha7> · clean`.
4. Ask omp for a change in the terminal. As it edits files the preview reloads automatically, the chip switches to `· uncommitted changes` and a **COMMIT** button appears in the header. Restart / `R` still reloads the preview by hand.
5. Press COMMIT. The first time, Dialogue shows the project's public deploy key with instructions to add it to the repository with write access; after "I've added the key — continue" (or immediately on later commits) omp is asked to commit and push, reports in the terminal, and the chip returns to `clean` with the new sha. Between commit and push it reads `· 1 to push` and the button says **Push 1 commit**.

Closing the tab does not end the agent: the omp session lives in tmux and reattaches when the workspace is reopened. Opening a **tag** or commit gives a full-width read-only preview with no terminal.

Deleting a workspace (`DELETE /api/workspaces/:id`) stops its terminal and removes the worktree; the bare mirror and the remote are untouched.

## Terminal details

- ttyd starts lazily on the first WebSocket client, on a UNIX socket, and is proxied through Dialogue at `/ws/terminal/:id`; the browser never connects to ttyd directly.
- The command is `tmux -f omp/tmux.conf new-session -A -s dialogue-<hash> -c <worktree> omp --config omp/config.yml --append-system-prompt omp/system-prompt.md`.
- `omp/dialogue-theme.json` is installed into the active omp profile's themes directory before the first spawn, so the agent's colours match the pane (`css/terminal.css`).
- If `ttyd`, `tmux` or `omp` is missing, the pane shows the server's error instead of "Reconnecting…".

## Prototype viewer isolation

Prototypes run inside a sandboxed iframe. This is useful development containment, but it is **not yet the final production security boundary** because Dialogue and prototype files are still served by the same local server, and the agent runs with the Dialogue process's own privileges.

Production should retain a separate prototype execution origin, for example:

- trusted app: `dialogue.idealogue.studio`
- untrusted prototype code: `p.idealogue.studio`

## Known limitations

- no authentication — anyone who can reach the port gets a shell-capable agent in the checkout; localhost-only mitigates this on a dev machine
- the terminal is the raw omp TUI in an xterm.js pane, not a designed conversation UI
- localhost-only; the VM adds nginx but still no auth
- omp is authenticated through `OPENROUTER_API_KEY` in `.env` (dev and VM); other providers need `/login` in the terminal. Git push uses the generated deploy key; the private key lives unencrypted in `.dialogue-data/keys/` and is readable by the agent process
- no multi-user access
- no public sharing implementation
- no thumbnail generation; Landline tiles reuse the existing thumbnail asset
- no Figma comparison/comments yet
- workspaces are only removed through the API; there is no cleanup UI yet
- production separate-origin prototype hosting is not implemented

## Next test

1. run `dev`, open Landline → `main` (or a feature branch)
2. confirm the terminal connects and omp starts in the worktree
3. ask omp for one small visible colour/copy change in the prototype
4. confirm the preview reloads with the change and the chip shows uncommitted changes
5. press COMMIT, register the deploy key, let omp commit and push; open a PR on GitHub
6. repeat end to end in `nix run .#vm`

The purpose is to learn what the designer and the agent each need from the split screen before any production infrastructure work begins.
