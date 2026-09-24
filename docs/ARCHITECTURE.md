# Dialogue — Architecture

This document records the current architecture direction. It distinguishes the **lightweight development architecture being built now** from the likely **production architecture later**.

The production decision is intentionally deferred until the core Dialogue workflow has been proven with a real designer-driven change made through the embedded agent.

## Architectural principles that remain stable

Regardless of hosting/provider choices:

- Dialogue owns project state and knows where each project's source lives.
- Git is the revision model: a prototype's history is its repository's history, and changes land as commits on branches rather than as separately stored packages.
- Prior work is never destructively overwritten; a new state is a new commit or a new branch.
- GitHub is the source of truth for the Dialogue application, not for runtime clones/worktrees of user projects.
- untrusted checked-out/generated prototype code must not share the trusted authenticated Dialogue browser origin; the local build already serves every preview from its own origin.
- the agent is a replaceable component running against the checkout; Dialogue does not embed provider-specific model calls.
- application code interacts with storage through a boundary (`server/git.js`, `server/terminal.js`, `server/watch.js`) so the on-disk layout can change without changing the product workflow.

## Current lightweight development architecture

The current milestone runs locally on one machine (or in the NixOS demo VM) and requires no production hosting services:

```text
Browser
  ├── HTTP: Dialogue UI, /api/*
  ├── SSE:  /api/workspaces/:id/events  (change / runner → reload or status)
  ├── WS:   /ws/terminal/:id            (xterm.js ↔ ttyd, byte-for-byte)
  └── HTTP+WS: <token>.preview.localhost:<port>   preview origin per workspace (iframe)
        ↓
Dialogue Node server (server.js)
  ├── server/git.js           bare repos, refs, worktrees, HEAD/dirty/ahead, push check, recipe lookup
  ├── server/deploy-key.js    per-project SSH deploy key, push URL, known_hosts
  ├── server/watch.js         fs.watch on worktree + git dirs → SSE fan-out
  ├── server/recipe.js        parses .dialogue/preview.json
  ├── server/runner.js        install + dev server per workspace (Runner, RunnerPool)
  ├── server/preview-proxy.js preview origins: proxy to dev server / serve static root
  ├── server/live-preview.js  runner + proxy + SSE `runner` events + branch screenshots
  ├── server/setup.js         preview setup pipeline (omp -p → recipe → validate → commit)
  ├── server/preview.js       headless-Chromium screenshots of a preview URL, cached
  ├── server/agent-auth.js    AI model readiness, model choice, web sign-in
  └── server/terminal.js      ttyd lifecycle per branch workspace, prompt injection
        ↓
.dialogue-data/
  ├── db.json                       projects (schemaVersion 4), see server/projects.js
  ├── repos/<slug>.git              bare mirror, git fetch --prune origin
  ├── workspaces/<slug>/<ref>/      one git worktree per opened ref
  ├── keys/<slug>, <slug>.pub       deploy key per project; keys/known_hosts
  ├── previews/<slug>/<sha>.png     screenshots per commit, plus main.png
  ├── setup/<slug>/                 preview setup: log.txt, tree/ (detached worktree), stamps/, shot.png
  ├── stamps/<slug>/<ref>/          install stamp per workspace (install.sha)
  ├── agent.json                    selected model
  └── home/                         omp profile + credentials (VM only)

per branch workspace:
  ttyd (UNIX socket) → omp/attach.sh
    └── tmux -L dialogue new-session -A -s dialogue-<hash>-<checksum> -c <worktree>
          └── omp --config omp/config.yml --append-system-prompt omp/system-prompt.md

per viewed workspace with a server recipe:
  /bin/sh -c "<start>"   own process group, PORT=<free port> HOST=127.0.0.1
```

This deliberately avoids an early framework/database/hosting migration while the product behaviour is still being discovered.

### Git store

`db.json` (schemaVersion 4, `server/projects.js`) holds projects only: `{ slug, createdAt, repo: { url, host, owner, repo }, previewSetup: { status, attempt, error, finishedAt } }`. The slug is `<owner>-<repo>` so it is unique per repository and stable for the `repos/`, `workspaces/`, `keys/` and `setup/` paths; the display name is computed at read time (`repo`, or `owner/repo` when two projects share a repo name). `previewSetup.status` is `queued`, `running`, `waiting-for-agent`, `ready` or `failed` (see [Preview setup pipeline](#preview-setup-pipeline)). Schema-2 and schema-3 files are migrated in place by rebuilding each record from its URL: v3's detected `prototypePath` is dropped and every migrated project gets its preview setup queued. Nothing is hardcoded: projects are added from the Projects page by pasting a repository URL (HTTPS or SSH), and `DIALOGUE_SEED` names a JSON list of `{ url }` entries (`seed.json` in the repo lists Landline; the NixOS module writes one from `services.dialogue.seedProjects`) that is merged in on every start for entries not present yet. Adding a project clones the mirror synchronously so a wrong address fails in the dialog, then queues the preview setup. An SSH URL is used for fetching as well as pushing, so a private repository shows the connect panel on its project page until the deploy key is registered (its setup starts once the mirror exists); an HTTPS URL to a private repository fails with a hint to use the SSH address instead.

Per project, `server/git.js` maintains a bare clone at `repos/<slug>.git`, fetched on demand when refs are listed. Fetch failure is not fatal: the last local refs are returned together with a `fetchError` so the UI keeps working offline. A bare clone leaves a clone-time copy of every branch under `refs/heads`; such a copy is not treated as local work. Opening a branch whose local ref has nothing that origin lacks fast-forwards it to origin first, so a workspace starts current.

### Preview recipe

Dialogue does not guess where a prototype lives. Each repository describes its own live preview in a committed recipe, `.dialogue/preview.json` (parsed by `server/recipe.js`):

```text
{
  "version": 1,
  "kind": "static" | "server",
  "root": ".",
  "install": "npm ci",
  "start": "npm run dev -- --host 127.0.0.1 --port $PORT",
  "entry": "/",
  "reload": "dialogue" | "self",
  "readyTimeoutSeconds": 120
}
```

`static` serves plain files from `root` (`entry` `/` means `index.html`) with no process; `server` runs `install` (optional) and a `start` command that must listen on `$PORT`. `reload` is `self` when the dev server reloads the page itself (Vite, Next, webpack dev server), else `dialogue`, meaning Dialogue reloads the iframe on file changes. `readyTimeoutSeconds` (1–1800, default 120) bounds startup. `ProjectRepo.readRecipe()` picks the recipe for a workspace: the worktree's own file (even uncommitted) wins; otherwise the local default branch's when it carries commits origin lacks (the unpushed recipe commit); otherwise origin's default branch.

### Preview setup pipeline

`server/setup.js` (`PreviewSetup`) produces the recipe with the agent and proves it works. A setup job runs after a project is added, at server start for projects whose setup is `queued`, `running` or `waiting-for-agent`, and on Retry. Jobs run one at a time (installs are heavy).

1. **Workplace.** The job works in the open default-branch workspace if there is one (so its branch is not moved underneath it), else in a persistent detached worktree at `setup/<slug>/tree`, checked out at the local default branch when it has local work, else at `origin/<default>`. The tree is kept between runs so ignored files such as `node_modules` survive and repeat installs are cheap.
2. **Existing recipe.** A recipe already in the repository is validated before any agent run; if it works, setup succeeds without the agent.
3. **Plain HTML fast path.** With no recipe and no `package.json` anywhere, `guessStaticRecipe` (`server/recipe.js`) proposes a static recipe for `prototypes/app`, else the shallowest `index.html`. If it validates, setup succeeds in seconds without the agent or a connected model.
4. **Agent gate.** Only now is `AgentAuth` asked for readiness. Not ready → status `waiting-for-agent` with the reason; the job resumes when `AgentAuth` emits `ready` (after a sign-in).
5. **Agent run.** `omp -p --approval-mode yolo --config omp/config.yml <model args> <omp/preview-setup-prompt.md>` in the workplace, 10 min timeout, with the repository's `.env` moved aside while it runs (omp loads `.env` from its cwd and a client key there must not override the connected model). The prompt describes the recipe format and forbids other changes and commits.
6. **Validation.** Dialogue parses the recipe, starts it with a `Runner` exactly as a workspace would, and screenshots it through a temporary preview origin, then stops it. A failure is `{ step, exitCode, message, log }` with step `recipe`, `install`, `start`, `ready`, `screenshot` or `agent`.
7. **Retry.** Up to 3 attempts; each retry prompt carries the failed step, exit code, the recipe as written and the tail of the output. If the agent itself exits non-zero and a forced readiness re-check says the model is gone, the job parks as `waiting-for-agent` without consuming the attempt. After the last failed attempt the status is `failed` with a one-line reason.
8. **Success.** `git commit -- .dialogue/preview.json` with the message "Add Dialogue preview recipe". In the setup tree the local default branch is then moved to that commit with a compare-and-swap `update-ref` and its upstream set to origin, so the recipe goes out with the user's next COMMIT/PUSH; nothing is pushed by the pipeline. The validation screenshot is copied to the origin sha, the local sha and `main.png`. Status `ready`, and `PreviewSetup` emits `ready` so workspaces opened during the setup start their preview. The project and workspace pages poll/say "setting up" meanwhile.

Everything the job and its runners print is appended to `setup/<slug>/log.txt` (`GET /api/projects/:slug/setup/log`). A failed card offers Retry, **Fix with agent** (opens the default-branch workspace and types `omp/preview-fix-prompt.md` — failure, log path, recipe format — into its terminal; the setup is marked `ready` as soon as that workspace's preview reaches `ready`) and Show log.

`refresh(slug)` keeps the project card current without the agent: when origin's default branch has moved to a commit without an image, the setup tree is checked out there (with the local recipe copied in if origin does not have it yet), validated and screenshotted.

### Live preview

`server/runner.js` runs one workspace's recipe. `static` starts no process; the proxy serves `root` directly. `server` runs `install` only when the stamp changes — a sha256 over the install command and whichever of `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock(b)`, `requirements.txt`, `Gemfile.lock` exist, stored as `stamps/<slug>/<ref>/install.sha` — then `start` through `/bin/sh` in its own process group with `PORT` (a free port), `HOST=127.0.0.1`, `BROWSER=none`, `CI=1`. Readiness polls `entry` on both `127.0.0.1` and `::1` with `Host: localhost:<port>` until it answers below 400 or `readyTimeoutSeconds` passes. States: `installing`, `starting`, `ready`, `crashed`, `stopped`; the last 500 output lines are kept. Stopping sends SIGTERM to the group, then SIGKILL after 5 s. `RunnerPool` keys runners by workspace id and stops one 10 min after its last viewer (SSE client) leaves; shutdown stops all.

`server/preview-proxy.js` gives every workspace its own browser origin: `http://<16-hex token>.preview.localhost:<port>/`, or `<token>.<DIALOGUE_PREVIEW_DOMAIN>` behind a real hostname (scheme from `X-Forwarded-Proto`). Requests are routed by their Host header before any Dialogue route is consulted. For a server target, HTTP and WebSocket upgrades (dev-server HMR) are proxied with `Host`/`Origin`/`Referer` rewritten to `localhost:<port>` and `Location` redirects rewritten back to the preview origin; a static target is served from its root with realpath checks so nothing outside it is reachable; otherwise a small auto-refreshing pending or failed page (with the log tail) is shown.

`server/live-preview.js` (`LivePreviews`) ties them together. A workspace SSE client opens the preview: the recipe is read, the runner started or reused, and every state change is sent as an SSE `runner` event `{ state, message, reload, log?, restarted? }`. A missing or invalid recipe is reported the same way (`no-recipe` / `crashed`). A changed recipe restarts the runner; `POST /api/workspaces/:id/preview/restart` does so by hand. Branch screenshots are taken through the preview origin 5 s after the runner becomes ready and 30 s after the last file change, stored under the worktree's HEAD sha (the default branch also writes `main.png`).

### Screenshots

Project cards show the default branch and branch tiles show their commit, as screenshots from `server/preview.js`: `capture(url, files)` runs headless Chromium (`--screenshot`, 370×722, `--virtual-time-budget=5000`) against a running preview URL, one render at a time, and writes the image to every listed file under `previews/<slug>/`. `lookup(slug, sha)` returns the commit's own image, else `main.png` (the latest default-branch image) marked as not exact. `GET /api/projects/:slug/preview/:sha.png` serves an exact image with immutable cache headers and the fallback with `no-cache`; refs carry `previewUrl` and `previewExact`, and tiles without an exact image carry a "from main" label. Listing projects triggers a background `refresh` when origin's default branch has no exact image. Images come from the setup pipeline, from open workspaces and from refresh — never from a checkout of an arbitrary commit — so a branch nobody has opened shows the main image. Cached shas no longer referenced are pruned after each refs listing. Chromium comes from `DIALOGUE_CHROMIUM`, `PUPPETEER_EXECUTABLE_PATH`, PATH, or the macOS Chrome bundle; without one, previews still run but cards show the initials badge and tiles a blank device. The devshell and the NixOS module provide `pkgs.chromium`.

### Worktree per ref

A workspace is a git worktree at `workspaces/<slug>/<encodeURIComponent(ref)>/`. Its id is `<slug>/<encoded ref>`. `git worktree list --porcelain` on the bare repo is the source of truth; there is no workspace table.

- Branch: `git worktree add <dir> <branch>`, with a local tracking branch created from `origin/<branch>` on first open. Writable; gets a terminal.
- Tag or commit: `git worktree add --detach <dir> <sha>`. Read-only preview; no terminal.

Deleting a workspace stops its terminal and preview server and runs `git worktree remove --force`. Creating one is idempotent.

### Terminal process

One ttyd per branch workspace, started lazily by `server/terminal.js` on the first WebSocket client. ttyd listens on a UNIX socket under the system temp directory, so no TCP port is ever opened. ttyd runs `omp/attach.sh` for every client; the script checksums the `omp/*` overlay files, kills stale sessions for the workspace, then `tmux -L dialogue new-session -A -s dialogue-<workspace>-<checksum>` attaches to the existing session or creates one in the worktree running `omp`. Editing anything under `omp/` and reconnecting therefore starts a fresh omp with the new settings. tmux therefore keeps the agent session alive across tab closes, reconnects and Dialogue restarts; ttyd itself is a child of Dialogue and is killed on shutdown.

Before spawning, `omp/dialogue-theme.json` is copied into the active omp profile's themes directory (`~/.omp/agent/themes`, or `~/.omp/profiles/<OMP_PROFILE>/agent/themes`) when missing or changed, so the developer's own omp credentials and settings are used. Binaries come from PATH, overridable with `DIALOGUE_OMP`, `DIALOGUE_TTYD`, `DIALOGUE_TMUX`, `DIALOGUE_GIT`. A missing binary, or a ttyd that exits before its socket accepts connections, closes the WebSocket with code 1011 and a `{ error }` JSON reason that the UI shows in the pane.

### Watcher and SSE

`ProjectRepo.watchRoots()` decides what to watch: the worktree's top level (non-recursive), every top-level directory that is neither a dot directory nor git-ignored (recursively; `.dialogue` is kept so a rewritten recipe is noticed), the worktree's git dir and the mirror's remote-tracking refs. Ignored directories such as `node_modules` and build output are therefore never walked. `server/watch.js` runs those `fs.watch`es, debounced 150 ms, and fans out a `change` event with `{ head, dirty, ahead, files }` to every SSE client of that workspace; `files` is `false` when only git state moved. The workspace page updates the status chip on each event and reloads the iframe on file changes only when the recipe's `reload` is `dialogue` (a `self` dev server reloads the page itself). File changes also go to `LivePreviews`, which restarts the runner when the recipe changed and otherwise schedules the branch screenshot. The same SSE stream carries the `runner` events described above.

### WebSocket proxy

`server.js` handles the HTTP upgrade for `/ws/terminal/:id`, ensures the workspace's ttyd is running, and proxies the socket byte-for-byte to its UNIX socket. The browser never talks to ttyd directly. Upgrades addressed to a preview origin are handed to the preview proxy first (dev-server HMR). In the VM nginx proxies WebSockets to the Node port with buffering off and a 1 h read timeout, passes the browser's `Host` (`$http_host`) and `X-Forwarded-Proto`, and lists `*.preview.localhost` (plus `*.<previewDomain>`) as server aliases so preview origins reach Node.

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

A dirty or ahead branch workspace shows a COMMIT (or PUSH) button. `POST /api/workspaces/:id/commit` first runs `git ls-remote <pushurl>` with the deploy key (successes cached 60 s). If the host rejects the key, the response carries the public key and host-specific instructions, and the workspace page opens the "Connect Dialogue to your repository" panel: copy the key, open `<repo>/settings/keys/new` (GitHub) or the equivalent, tick write access, come back and press continue. Once the check passes, the server finds the workspace's tmux session (`dialogue-<hash>-<checksum>`) and types `omp/commit-prompt.md` into it with `tmux send-keys`; omp commits, pushes and reports in the terminal. Dialogue itself never runs `git commit`. The status chip and button follow the SSE stream: commit → `ahead` 1, push → clean. When the push is rejected because the remote has new commits, the prompt has omp run `git pull --rebase` and push once more, aborting the rebase on conflict. On the default branch this push also publishes the recipe commit left by the preview setup pipeline.

A revision request should eventually be able to reference the feedback that caused it:

`design comment → revision request → agent work in the branch → commit/PR`

## Prototype isolation

### Local development

Each workspace's preview runs on its own browser origin (`<token>.preview.localhost:<port>`, or `<token>.<DIALOGUE_PREVIEW_DOMAIN>`), served by `server/preview-proxy.js`, so prototype JavaScript cannot read Dialogue's cookies, storage or DOM. Preview hosts never reach Dialogue's own routes. Because the origin already differs, the iframe sandbox includes `allow-same-origin` (with `allow-scripts`, `allow-forms`, `allow-modals`, `allow-popups`, `allow-downloads`) so dev servers, storage and HMR work normally. `*.localhost` names resolve to loopback in browsers without DNS setup; a real deployment needs wildcard DNS (and a wildcard certificate for HTTPS) for `previewDomain`.

The remaining gap is process isolation: preview servers, installs and the agent all run with the same privileges as the Dialogue process. That is acceptable only on a single developer's machine or the single-user VM.

### Production requirement

Checked-out/generated prototype JavaScript must execute on a separate origin from authenticated Dialogue, for example:

- trusted app: `dialogue.idealogue.studio`
- prototype runtime: `<token>.p.idealogue.studio` (`services.dialogue.previewDomain = "p.idealogue.studio"`)

The local preview origins already follow this shape. Production additionally needs the preview processes and the agent sandboxed away from Dialogue's data directory and credentials.

## Public Share shell

The existing product direction remains to keep the public Share shell HTML/CSS-only where practical, while the prototype framed inside it may contain JavaScript.

Public sharing is not part of the current lightweight local milestone.

## Agent integration

The agent (`omp`) runs inside the branch checkout with an ordinary shell, git and the repository's own tooling. Dialogue supplies the working directory, a profile, a config, an appended system prompt (`omp/system-prompt.md`) and a theme; it does not mediate the agent's file access. This replaces the earlier model where an external LLM connected to Dialogue through a tool layer and Dialogue re-packaged the result.

Later, Dialogue may feed the agent structured context — Figma node references, review comments, screenshot crops — through the same terminal session or through a designed conversation UI that replaces the raw pane. The agent remains replaceable: anything that can run in a tmux session in a checkout fits.

### Agent sign-in

omp needs a signed-in model provider before it can do anything, and a designer must be able to get there without a terminal. `server/agent-auth.js` (`AgentAuth`, one instance in `server.js`) owns three things. **Readiness:** `check()` runs `omp token <provider>` for the selected model's provider (stored credential or environment key), then a live `omp -p --config omp/config.yml … "Reply with exactly: OK"` from an empty temporary directory (omp auto-loads `.env` from its cwd, so the probe must not run in a project) with a 60 s timeout; ready iff exit 0 and the answer contains `OK`. Failures are classified from omp's output into `not-connected`, `rejected`, `quota`, `unreachable` or `unknown`; success is cached 10 min, failure never, concurrent callers share one probe, and the `ready` event fires when the state flips: the preview setup pipeline checks readiness before every job, parks projects as `waiting-for-agent` while no model works, and resumes them on that event. A check runs at server start and after every sign-in. **Model selection:** `<data>/agent.json` `{ model }`, default `omp/config.yml`'s `modelRoles.default`; `ompArgs()`/`ompEnv()` are what every omp spawn must include, and `server/terminal.js` passes them to `omp/attach.sh` as `DIALOGUE_OMP_ARGS`, which is part of the tmux session checksum so a model change rotates the session. **Web sign-in:** `POST /api/agent/login` spawns `omp --mode rpc` and sends omp's own `login` command, i.e. exactly what `/login` does, so credentials land in `~/.omp/agent/agent.db`. omp's `open_url` / `notify` / `input` UI requests become SSE events and the pasted redirect address or code is answered with an `extension_ui_response`. Because omp refuses to start rpc mode with no usable model — precisely the state before the first sign-in — rpc children load `omp/bootstrap-provider.js` with `-e`, an extension registering a placeholder provider on a closed port; nothing is written to the user's `models.yml`. After signing in to a provider that cannot serve the current model, the first sensible chat model of that provider (`get_available_models`) becomes the selection; Settings lets the designer change it.

The browser side is `js/agent-connect.js`: the Settings page's "AI model" section (status, provider list with a curated top five, sign-in steps, always-visible paste box, model picker, "Check again") and a "Connect an AI model to continue" banner that opens the same flow in a modal on the Projects page. The provider's page opens in a new tab from `url` (never `launchUrl`, which is a localhost shortcut valid only on the server's machine); when the browser runs on another machine the OAuth redirect to `localhost:<port>` fails and the designer pastes the address they land on, which is the path the end-to-end test drives. Plain API-key providers go through the same two steps in omp 18.2.10 (`open_url` to the provider's docs, then an `input` prompt for the key); only prompts omp marks `secret` are refused by its rpc mode, and that error is shown verbatim.

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
- prototype runtime uses a separate origin: set `services.dialogue.previewDomain` with wildcard DNS and certificate so previews work from other machines (`*.preview.localhost` only works when the browser is on the host or reaches it through a forwarded localhost port)
- preview servers run each project's own `install`/`start` commands (arbitrary code from the repository and its dependencies) as the Dialogue user; they need the same sandboxing as the agent
- the agent process needs real authentication in front of it before anyone but the owner can reach the terminal
- repos/worktrees/home live on the host filesystem; storage calls should remain behind `server/git.js` so the layout can move
- automated off-server backups are mandatory if the data lives on one host
- agent credentials (`/login`) live in the service home directory; git push uses the per-project deploy key under `keys/`, which is unencrypted on disk and readable by the agent process, so the data directory must be treated as secret

The final production choice should be revisited after the branch → agent → preview → PR loop has been dogfooded.
