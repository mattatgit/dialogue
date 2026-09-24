# Dialogue — Architecture

This document records the current architecture direction. It distinguishes the **lightweight development architecture being built now** from the likely **production architecture later**.

The production decision is intentionally deferred until the core Dialogue workflow has been proven with a real designer-driven change made through the embedded agent.

## Architectural principles that remain stable

Regardless of hosting/provider choices:

- Dialogue owns project state and knows where each project's source lives.
- Git is the revision model: a prototype's history is its repository's history, and changes land as commits on branches rather than as separately stored packages.
- Prior work is never destructively overwritten; a new state is a new commit or a new branch.
- GitHub is the source of truth for the Dialogue application, not for runtime clones/worktrees of user projects.
- untrusted checked-out/generated prototype code must not share the trusted authenticated Dialogue browser origin in production.
- the agent is a replaceable component running against the checkout; Dialogue does not embed provider-specific model calls.
- application code interacts with storage through a boundary (`server/git.js`, `server/terminal.js`, `server/watch.js`) so the on-disk layout can change without changing the product workflow.

## Current lightweight development architecture

The current milestone runs locally on one machine (or in the NixOS demo VM) and requires no production hosting services:

```text
Browser
  ├── HTTP: Dialogue UI, /api/*, /workspace-files/:id/*
  ├── SSE:  /api/workspaces/:id/events  (change → reload preview)
  └── WS:   /ws/terminal/:id            (xterm.js ↔ ttyd, byte-for-byte)
        ↓
Dialogue Node server (server.js)
  ├── server/git.js         bare repos, refs, worktrees, HEAD/dirty/ahead, push check
  ├── server/deploy-key.js  per-project SSH deploy key, push URL, known_hosts
  ├── server/watch.js       fs.watch on worktree + git dirs → SSE fan-out
  └── server/terminal.js    ttyd lifecycle per branch workspace, prompt injection
        ↓
.dialogue-data/
  ├── db.json                       projects with repo.url / repo.prototypePath
  ├── repos/<slug>.git              bare mirror, git fetch --prune origin
  ├── workspaces/<slug>/<ref>/      one git worktree per opened ref
  ├── keys/<slug>, <slug>.pub       deploy key per project; keys/known_hosts
  └── home/                         omp profile + credentials (VM only)

per branch workspace:
  ttyd -i 127.0.0.1 -p <port> -W -b /ws/terminal/<id>
    └── tmux new-session -A -s dialogue-<hash> -c <worktree>
          └── omp --config omp/config.yml --append-system-prompt omp/system-prompt.md
```

This deliberately avoids an early framework/database/hosting migration while the product behaviour is still being discovered.

### Git store

`db.json` (schemaVersion 2) holds projects only. Each project carries `repo: { url, prototypePath }`. There are no `prototypes` or `revisions` tables; a v1 file is replaced by the v2 seed on startup.

Per project, `server/git.js` maintains a bare clone at `repos/<slug>.git`, fetched on demand when refs are listed. Fetch failure is not fatal: the last local refs are returned together with a `fetchError` so the UI keeps working offline.

### Worktree per ref

A workspace is a git worktree at `workspaces/<slug>/<encodeURIComponent(ref)>/`. Its id is `<slug>/<encoded ref>`. `git worktree list --porcelain` on the bare repo is the source of truth; there is no workspace table.

- Branch: `git worktree add <dir> <branch>`, with a local tracking branch created from `origin/<branch>` on first open. Writable; gets a terminal.
- Tag or commit: `git worktree add --detach <dir> <sha>`. Read-only preview; no terminal.

Deleting a workspace stops its terminal and runs `git worktree remove --force`. Creating one is idempotent.

### Terminal process

One ttyd per branch workspace, started lazily by `server/terminal.js` on the first WebSocket client. ttyd listens on a UNIX socket under the system temp directory, so no TCP port is ever opened. ttyd runs `omp/attach.sh` for every client; the script checksums the `omp/*` overlay files, kills stale sessions for the workspace, then `tmux -L dialogue new-session -A -s dialogue-<workspace>-<checksum>` attaches to the existing session or creates one in the worktree running `omp`. Editing anything under `omp/` and reconnecting therefore starts a fresh omp with the new settings. tmux therefore keeps the agent session alive across tab closes, reconnects and Dialogue restarts; ttyd itself is a child of Dialogue and is killed on shutdown.

Before spawning, `omp/dialogue-theme.json` is copied into the active omp profile's themes directory (`~/.omp/agent/themes`, or `~/.omp/profiles/<OMP_PROFILE>/agent/themes`) when missing or changed, so the developer's own omp credentials and settings are used. Binaries come from PATH, overridable with `DIALOGUE_OMP`, `DIALOGUE_TTYD`, `DIALOGUE_TMUX`, `DIALOGUE_GIT`. A missing binary, or a ttyd that exits before its socket accepts connections, closes the WebSocket with code 1011 and a `{ error }` JSON reason that the UI shows in the pane.

### Watcher and SSE

`server/watch.js` runs a recursive `fs.watch` on `<worktree>/<prototypePath>` plus the worktree's `.git` file/HEAD, debounced 150 ms, and fans out a `change` event with `{ head, dirty }` to every SSE client of that workspace. The workspace page reloads the iframe and updates the status chip on each event.

### WebSocket proxy

`server.js` handles the HTTP upgrade for `/ws/terminal/:id`, ensures the workspace's ttyd is running, and proxies the socket byte-for-byte to `127.0.0.1:<port>`. The browser never talks to ttyd directly, so the app stays single-origin and localhost-only. In the VM nginx proxies WebSockets to the Node port with buffering off and a 1 h read timeout.

## Data model direction

Core concepts remain:

- users
- projects (with git source)
- workspaces (branch/tag/commit checkouts)
- share links
- agent connections
- Figma design references
- comments/review annotations
- revision requests

The local build implements projects and workspaces. A "revision" is a commit; a "prototype variant" is a branch. Comparison, rollback and traceability come from git rather than from a bespoke store.

## Publishing

Publishing a change is a git commit and push made by the agent in the workspace. The branch's remote (GitHub or any git host) is where the result lands, and a pull request is the review artifact.

### Deploy keys

Fetching keeps using the project's HTTPS URL so browsing a public repository needs no setup. Pushing goes over SSH: `server/deploy-key.js` generates an ed25519 key per project on first use (`keys/<slug>`), records the host's SSH key with `ssh-keyscan` in `keys/known_hosts`, and `ProjectRepo.ensure()` sets `remote.origin.pushurl` (`git@host:owner/repo.git`) and `core.sshCommand` (`ssh -i <key> -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=<known_hosts>`) on the bare mirror. Worktrees inherit both, so `git push` works for the agent in the terminal as soon as the public key is registered as a deploy key with write access. GitHub allows one deploy key per repository, which is why the key is per project. The bare repo also gets a fallback `user.name`/`user.email` when no global identity exists (VM).

### COMMIT button

A dirty or ahead branch workspace shows a COMMIT (or PUSH) button. `POST /api/workspaces/:id/commit` first runs `git ls-remote <pushurl>` with the deploy key (successes cached 60 s). If the host rejects the key, the response carries the public key and host-specific instructions, and the workspace page opens the "Connect Dialogue to your repository" panel: copy the key, open `<repo>/settings/keys/new` (GitHub) or the equivalent, tick write access, come back and press continue. Once the check passes, the server finds the workspace's tmux session (`dialogue-<hash>-<checksum>`) and types `omp/commit-prompt.md` into it with `tmux send-keys`; omp commits, pushes and reports in the terminal. Dialogue itself never runs `git commit`. The status chip and button follow the SSE stream: commit → `ahead` 1, push → clean.

A revision request should eventually be able to reference the feedback that caused it:

`design comment → revision request → agent work in the branch → commit/PR`

## Prototype isolation

### Local development

The workspace page runs the checked-out prototype in a sandboxed iframe served from `/workspace-files/:id/*`, with the same path-safety rules as the earlier prototype file server. Dialogue and prototype files are served by the same localhost server, so this is useful containment but not the final browser-origin security boundary. The agent runs with the same privileges as the Dialogue process; that is acceptable only on a single developer's machine or the single-user VM.

### Production requirement

Checked-out/generated prototype JavaScript must execute on a separate origin from authenticated Dialogue, for example:

- trusted app: `dialogue.idealogue.studio`
- prototype runtime: `p.idealogue.studio`

The viewer should continue using sandboxing as appropriate. This separation prevents prototype code from gaining access to Dialogue's trusted session/origin state.

## Public Share shell

The existing product direction remains to keep the public Share shell HTML/CSS-only where practical, while the prototype framed inside it may contain JavaScript.

Public sharing is not part of the current lightweight local milestone.

## Agent integration

The agent (`omp`) runs inside the branch checkout with an ordinary shell, git and the repository's own tooling. Dialogue supplies the working directory, a profile, a config, an appended system prompt (`omp/system-prompt.md`) and a theme; it does not mediate the agent's file access. This replaces the earlier model where an external LLM connected to Dialogue through a tool layer and Dialogue re-packaged the result.

Later, Dialogue may feed the agent structured context — Figma node references, review comments, screenshot crops — through the same terminal session or through a designed conversation UI that replaces the raw pane. The agent remains replaceable: anything that can run in a tmux session in a checkout fits.

## Development path

Completed and superseded:

1. Landline V22 imported through Dialogue's UI and run
2. the same ingestion path exercised by an external API client (V23)
3. an external-agent adapter proved reads plus additive publishing (V24)

Current:

4. git-backed workspaces with an embedded omp terminal and live preview
5. first real designer-driven change: open a Landline branch, ask omp, watch the preview reload, commit, push, PR
6. use observed friction to decide what context the agent and the designer need

Only after this loop is useful should production hosting/database/auth/storage decisions be finalized.

## Design/prototype review context

Dialogue should eventually act as a context broker between the designer, Figma, the rendered prototype and the connected agent.

A review annotation may include:

- Figma file/node IDs
- project ID
- branch and commit
- DOM selector or stable element reference
- coordinates
- viewport width/height
- screenshot/render crop
- comment text
- surrounding project metadata

The side-by-side comparison surface is therefore both a visual viewer and a structured context-capture surface.

## Intended closed loop

Long term:

1. Dialogue displays a Figma design beside a live prototype branch.
2. The designer comments on a specific design/prototype element.
3. Dialogue captures the comment plus structured context.
4. Dialogue hands that request to the agent working in the branch.
5. The agent reads additional project context as needed.
6. The agent commits the change; the preview reloads.
7. The designer reviews and pushes / opens a PR.
8. Earlier commits and branches remain available for history/rollback.

## Current production direction

The original managed proposal — Vercel + Supabase + Cloudflare R2 — remains technically valid, but after reviewing the expected real scale with Idealogue's lead developer it is no longer the default recommendation for this version.

Dialogue is expected primarily to serve Matt, Saori and a small number of clients. There is no requirement to future-proof this web application for thousands of users.

The current lean candidate is a small self-hosted host running the NixOS module (`nix/module.nix`): a systemd unit with data in `/var/lib/dialogue`, nginx in front, `omp` from the `llm-agents` flake input. Postgres only if a real multi-user need appears; the git store is already durable on disk.

Important production details:

- production and testing data should still be separated sufficiently to avoid accidental destructive testing
- prototype runtime should use a separate origin
- the agent process needs real authentication in front of it before anyone but the owner can reach the terminal
- repos/worktrees/home live on the host filesystem; storage calls should remain behind `server/git.js` so the layout can move
- automated off-server backups are mandatory if the data lives on one host
- agent credentials (`/login`) live in the service home directory; git push uses the per-project deploy key under `keys/`, which is unencrypted on disk and readable by the agent process, so the data directory must be treated as secret

The final production choice should be revisited after the branch → agent → preview → PR loop has been dogfooded.
