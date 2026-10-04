# Dialogue — Local HTTP / SSE / WebSocket Contract

## Purpose

`server.js` exposes a small localhost HTTP surface used by the Dialogue UI. Workspaces are git worktrees; the API creates, lists, watches and removes them, serves previews, records structured feedback runs and local edit snapshots, publishes numbered Versions, and proxies a terminal to each branch workspace. There is no import route or separate revision store.

All routes bind to `127.0.0.1` in the local build. In the VM nginx proxies them, including WebSockets. Requests whose Host is a preview origin (`<token>.preview.localhost[:port]` or `<token>.<DIALOGUE_PREVIEW_DOMAIN>`) never reach the routes below; see [Preview origins](#preview-origins).

## Routes

| Route | Behavior |
|---|---|
| `GET /api/health` | liveness check |
| `GET /api/projects` | `{ projects: [{ slug, name, webUrl, createdAt, defaultBranch, previewUrl, repo: { url, host, owner, repo }, previewSetup: { status, attempt, error, finishedAt } }] }`. `slug` is `<owner>-<repo>`; `name` is `repo`, or `owner/repo` when another project has the same repo name; `previewSetup.status` is `queued`, `running`, `waiting-for-agent`, `ready` or `failed`, `attempt` counts agent runs (max 3), `error` is the one-line reason for `failed`/`waiting-for-agent`; `previewUrl` points at the default branch's screenshot (null when no Chromium, no image yet or no mirror yet). Listing triggers a background screenshot refresh when origin's default branch has moved to a commit without its own image |
| `POST /api/projects` body `{ url }` | adds a repository by HTTPS, `git@host:owner/repo` or `ssh://` URL, clones the mirror and queues the [preview setup](ARCHITECTURE.md#preview-setup-pipeline). `201 { project }`; `400` unparseable; `409` already added; `502 { error, reason }` when the clone fails — `reason` is `repo` (private or missing over HTTPS), `network` or `unknown`, and the record is discarded. An SSH URL whose deploy key is not registered yet answers `502 { reason: "key", setup }` and keeps the project so its page can show the connect panel; its setup starts once the refs route can create the mirror |
| `GET /api/projects/:slug` | one project as above |
| `DELETE /api/projects/:slug` | stops terminals and preview servers, removes worktrees, the mirror, the setup directory, screenshots and the deploy key, then the record |
| `GET /api/projects/:slug/refs` | runs `git fetch --prune origin` on the bare mirror, then returns `{ project, branches: [{ name, sha, subject, committedAt, open, workspaceId, previewUrl, previewExact }], tags: [ … ], fetchError? }`. Dialogue's internal `dialogue/<branch>/Vn` Version tags are excluded from project tag tiles. If the fetch fails the last local refs are returned with `fetchError` set; `502 { reason, setup? }` when the mirror cannot be created (private SSH repository without its key → `reason: "key"` plus the connect payload). `previewExact` is `false` when `previewUrl` shows the latest default-branch image because that commit has none of its own |
| `GET /api/projects/:slug/preview/:sha.png` | screenshot (370×722) for that commit. Images are captured from running previews (setup validation, open workspaces, refresh) and stored at `previews/<slug>/<sha>.png`; the default branch's latest is also `main.png`. An exact image is served with immutable cache headers; otherwise `main.png` is served with `no-cache`; `404` when neither exists. Cached shas no longer referenced are pruned after each refs listing |
| `POST /api/projects/:slug/setup/retry` | resets `previewSetup` to `queued` (attempt 0) and enqueues the setup. `202 { previewSetup }` |
| `GET /api/projects/:slug/setup/log` | `text/plain` setup log (`setup/<slug>/log.txt`: agent output, install/start output, validation steps); `No setup log yet.` when empty |
| `POST /api/projects/:slug/setup/fix` | ensures the default-branch workspace and answers `201 { viewerUrl: "workspace.html?id=…&fix=1" }`; the workspace page then calls `fix-preview` below |
| `POST /api/projects/:slug/workspaces` body `{ ref }` | idempotent; ensures the worktree exists (branch → tracking branch from `origin/<ref>`; tag/commit → detached) and returns the workspace object below |
| `GET /api/workspaces/:id` | `{ id, project: { slug, name, previewSetup }, ref, kind: "branch" \| "tag" \| "commit", head: { sha, subject }, dirty, ahead, terminal, viewerUrl, previewUrl, runner }`. `terminal` is `true` only for branch workspaces; `ahead` counts commits not yet on `origin/<ref>`; `previewUrl` is the workspace's preview origin plus the recipe's `entry`, derived from the request's Host (and `X-Forwarded-Proto` with `DIALOGUE_PREVIEW_DOMAIN`); `runner` is the current runner payload as in the `runner` event |
| `GET /api/workspaces/:id/requests` | `{ requests: [record] }` in creation order for an existing workspace; each record is a durable observed agent run, not a saved prototype revision |
| `POST /api/workspaces/:id/requests` body `{ feedback, anchor?, figmaUrl? }` | Branch workspaces only; `feedback` is 1–4000 characters, `anchor` is JSON up to 4 KiB, `figmaUrl` is an optional HTTPS Figma `design`/`file` link (optionally with one `node-id`). Requires a ready AI model and no other active request on this branch. When a Figma link is attached, Dialogue reads the design with its server-side token before accepting the request: file links stage a page/frame outline, node links stage the full selected subtree. `201 { request }` starts `omp -p` in the worktree without committing or pushing; `400` invalid input, `401`/`403` inaccessible design, `404` missing file/node, `429` rate limit, `503` missing token, `409` read-only/not ready/already running. Figma failure does not start an agent. The agent's process exit determines `completed` vs `failed`, not a UI timer or changed-file heuristic |
| `GET /api/workspaces/:id/requests/:requestId/figma?access=…&node-id=…` | While the matching Figma-backed request runs, its agent can fetch the full subtree of another selected node in the same file. The capability is generated per run and appears only in the agent prompt, never in public request records. `404` when the request finishes or the capability is invalid; no Figma credential reaches the agent. |
| `GET /api/workspaces/:id/requests/:requestId/figma/export?access=…&node-id=…&setting=…` | While the matching request runs, returns an `image/svg+xml` or `image/png` download for a node explicitly marked for export in the initial snapshot or a previously inspected subtree. `setting` is the zero-based index of that node's `exportSettings` entry; SCALE/WIDTH/HEIGHT is converted to Figma's supported scale. The capability is the same per-run secret as the inspect URL. The response is an attachment with a sanitized filename, no cache and no Figma token; `404` for unauthorized/unseen/unconfigured nodes or finished runs, `400` for invalid IDs or unsupported configured sizes, `502` for failed/unsafe downloads. No automatic bulk export. |
| `GET /api/workspaces/:id/activity` | Branch workspaces only; `{ draft: { head: sha, dirty, ahead, canSave, pending? }, edits: [{ requestId, sha, createdAt, feedback, anchor? }], versions: [{ label: "V1", sha, createdAt }], requests: [record], terminalActivity: { state: "working" \| "complete", text, updatedAt } \| null }`. `draft` is always the live branch; each `edits` SHA is a private, immutable, reopenable commit tied to a completed comment with actual file changes. Versions are branch-scoped published commits, sorted by number. A completed no-change request remains in `requests`, not `edits`. Terminal activity is the most recent direct agent turn on that branch |
| `POST /api/workspaces/:id/versions` body `{}` | Branch workspaces only; publishes the current Draft, returning `201 { version: { label, sha, createdAt } }` only after an atomic push of the branch commit and numbered tag. Existing Edited snapshots are never pushed. `409 { error, setup }` when a deploy key needs registering; `409` when busy or there is nothing new; `502` for remote failure. A rejected push leaves a private pending commit for retry, never a visible Version |
| `DELETE /api/workspaces/:id` | stops the workspace's ttyd and preview server if running, then `git worktree remove --force` |
| `POST /api/workspaces/:id/preview/restart` | re-reads the recipe and restarts the preview server. `202 { accepted }` |
| `POST /api/workspaces/:id/fix-preview` | branch workspaces only (`409` otherwise). Fills `omp/preview-fix-prompt.md` with the project's setup failure, the setup log path and the path of `omp/preview-setup-prompt.md` (the recipe format), waits up to ~20 s for the workspace's tmux session to exist, and types it in. `202 { accepted }`; `409` when no session appears |
| `GET /api/workspaces/:id/events` | Server-Sent Events. Event `change` with data `{ head, dirty, ahead, files }`, emitted (debounced 150 ms) when files in the worktree (top level, and non-ignored non-dot top-level directories plus `.dialogue`), the worktree's git dir or the mirror's remote-tracking refs change. `files` is `false` for git-only changes (commit, push). The page reloads the preview on `files` only when the recipe's `reload` is `dialogue`. Event `runner` with data `{ state, message, reload, log?, restarted? }`: `state` is `installing`, `starting`, `ready`, `crashed`, `stopped` or `no-recipe`; `log` (last 40 lines) comes with `crashed`; `restarted` marks a ready after a recipe change or restart, which reloads the iframe. Connecting starts the preview server; it stops 10 min after the last client disconnects. A default-branch workspace reaching `ready` marks the project setup `ready` unless one is running (fixed by hand, e.g. after "Fix with agent") |
| `GET /ws/terminal/:id` | WebSocket upgrade, proxied byte-for-byte to the workspace's ttyd. Branch workspaces only |
| `GET /api/agent` | `{ status, model, defaultModel }`. `status` is the last readiness check (`null` until the first one finishes): `{ ready, reason, detail, model, checkedAt }` with `reason` one of `null`, `not-connected`, `rejected`, `quota`, `unreachable`, `unknown`. `model` is the `provider/model-id` every omp spawn uses; `defaultModel` is `omp/config.yml`'s `modelRoles.default` |
| `POST /api/agent/check` | forces a readiness check (bypasses the 10 min success cache; concurrent calls share one probe) and returns the same payload |
| `GET /api/agent/providers` | `{ providers: [{ id, name, authenticated }] }` — every provider omp can sign in to, including ones registered by omp extensions |
| `GET /api/agent/models` | `{ models: [{ id: "provider/model-id", provider, name }] }` — models a stored sign-in or environment key can serve (Dialogue's bootstrap placeholder excluded) |
| `PUT /api/agent/model` body `{ model }` | saves the selection to `<data>/agent.json`, stops running terminals (new connections rotate to a tmux session with the new `--model`) and re-checks. `400` unless `model` is `provider/model-id` |
| `POST /api/agent/login` body `{ providerId }` | `201 { id }` starts a web sign-in for that provider — an `omp --mode rpc` child running omp's own `/login` flow. Only one at a time; starting another cancels the previous. Killed after 10 min |
| `GET /api/agent/login/:id/events` | Server-Sent Events, replayed from the start for late subscribers: `open_url { url, launchUrl?, instructions? }` (send the browser to `url`; `launchUrl` is a localhost shortcut that only works on the server's machine), `progress { message }`, `input { title, placeholder? }` (omp waits for the pasted redirect address or code), `done { status }` (signed in, readiness re-checked, model possibly switched) or `error { message }`. `done`/`error` end the stream. `404` when that sign-in is not the current one |
| `POST /api/agent/login/:id/input` body `{ value }` | answers the pending `input` prompt. `202`; `400` empty; `409` when nothing is being asked yet |
| `DELETE /api/agent/login/:id` | cancels the sign-in and kills its omp child |

The workspace `events` stream also sends `activity { terminalActivity }` on connection and when direct terminal activity changes. `terminalActivity` is `null` if no agent turn has been recorded; working and completed entries carry a short, bounded, one-line status or summary. Structured comment runs instead use the `request` event and their durable request record.

On startup and forced readiness checks, if the selected provider has no sign-in, Dialogue looks for models from other authenticated providers. When exactly one other provider is available, it selects one of its models, saves the choice to `<data>/agent.json` and probes it before reporting readiness. It does not guess between multiple signed-in providers or switch away from a provider whose sign-in exists but whose probe fails; choose a model in Settings in those cases. This also picks up sign-ins made directly in omp outside Dialogue.

Workspace `id` is `<slug>/<encodeURIComponent(ref)>`: encode the ref portion, not the slash between slug and ref (for example `owner-proto/feature%2Fone`). `open` on a ref means a worktree already exists for it.

Request records contain `{ id, workspaceId, feedback, anchor?, figmaUrl?, status, model, createdAt, startedAt, finishedAt, error, output, outputTruncated, result, snapshotSha?, events }`. Status is `running`, `completed` or `failed`; events record `created`, `started`, `completed`, `failed` or `interrupted` with timestamps. Output is bounded text. `result` exists only after a successful agent exit and contains the observed `{ head: { sha, subject }, dirty, ahead }`. When a successful comment actually changes the checkout tree, `snapshotSha` references an immutable local Git commit at `refs/dialogue/edits/<branch>/<requestId>`; unchanged and failed runs have no edit snapshot. Snapshots exclude ignored files and current `.env*` contents without staging into the user's index. In-flight runs are marked failed after a server restart. Workspace/project deletion stops runs and removes their records and private edit refs. `GET /api/workspaces/:id/events` also emits `request` with the full record on every change and replays records when the connection opens.
Completed request records contain `summary`, a short final assistant summary when shareable or a neutral fallback; it is `null` during running and failed requests. Raw agent output stays separately bounded in `output` and is not used as the Activity card summary.


An attached Figma snapshot is a read-only JSON file under `requests/.figma-snapshots/`, outside the project checkout. Its absolute path is supplied to the running agent, and it is removed when the run finishes or Dialogue restarts. Only the canonical Figma URL stays in the durable request record. The server captures `FIGMA_ACCESS_TOKEN` before spawning any child process and removes it from the child environment.

The review iframe appends a random `reviewChannel` and its Dialogue `reviewOrigin` to the preview URL. For static HTML only, the proxy injects a channel-bound script into the HTTP response without writing the repository. It reports layout and element selection to the parent after source/origin/channel checks. Server-recipe previews are not instrumented: Area/Arrow still work, but Select remains disabled.

## Error semantics

- Unknown project or workspace → `404` with `{ error }`.
- Malformed body or a ref that does not exist on the remote → `400` with `{ error }`.
- Git failures other than fetch (worktree add/remove, bare repo creation) → `500` with `{ error }`. All API errors use the same `{ error: message }` JSON shape as before.
- Fetch failure is reported inside the `refs` payload as `fetchError`, never as a 5xx.
- Terminal failures are reported on the WebSocket, not over HTTP: a missing `ttyd`/`tmux`/`omp` binary, or a ttyd that exits before its socket accepts connections, closes the socket with code `1011` and a JSON `{ error }` close reason. The UI shows that reason in the terminal pane instead of "Reconnecting…".

## Terminal WebSocket protocol

Dialogue does not interpret the terminal stream; it forwards ttyd's protocol. `js/terminal.js` implements the client side:

- first client message: JSON `{ AuthToken: "", columns, rows }`
- client → server: `0` + input bytes; `1` + JSON `{ columns, rows }` on resize
- server → client: `0` + output bytes; `1` (title) and `2` (preferences) are ignored

One ttyd runs per branch workspace, started lazily on the first client and listening on a UNIX socket. Each client attaches to the same tmux session, so several tabs share one `omp` session and closing a tab does not end it.

## Preview origins

Every workspace gets a random 16-hex token and a preview origin: `http://<token>.preview.localhost:<port>/`, where `<port>` is the port the browser used to reach Dialogue (or `DIALOGUE_PREVIEW_PORT`), or `<scheme>://<token>.<DIALOGUE_PREVIEW_DOMAIN>/` when a preview domain is configured. The server picks the workspace from the request's Host header before any other routing. What the origin answers depends on the workspace's runner:

- `server` recipe, ready: HTTP requests and WebSocket upgrades (HMR) are proxied to the dev server with `Host`, `Origin` and `Referer` rewritten to `localhost:<port>`; `Location` headers pointing at the dev server are rewritten back to the preview origin. An unreachable dev server gives an auto-refreshing `502` page.
- `static` recipe: files are served from the recipe's `root`, directories resolving to `index.html`; paths that escape the root (including through symlinks) are refused.
- installing/starting/stopped: an auto-refreshing "Starting" / "Preview stopped" page; crashed, missing or invalid recipe: a failure page with the log tail.

Tokens are held in memory and change when the server restarts. The workspace page's iframe loads the origin with `sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"`; `allow-same-origin` is safe because the preview origin is never Dialogue's.

## Environment

- `DIALOGUE_DATA` — data directory (default `.dialogue-data/` next to the code; `/var/lib/dialogue` in the VM)
- `DIALOGUE_GIT`, `DIALOGUE_TTYD`, `DIALOGUE_TMUX`, `DIALOGUE_OMP` — override the binaries otherwise found on PATH
- `HOME` — where omp keeps its credentials (`~/.omp/agent/agent.db`) and discovers extensions (`~/.omp/agent/extensions/`); readiness checks and sign-ins run omp with the server's environment from an empty temporary directory, and the setup agent runs with the project's `.env` moved aside, so project `.env` files never count but `$HOME/.env` and real environment API keys (e.g. `OPENROUTER_API_KEY`) do
- `DIALOGUE_SEED` — JSON file `[{ url }]` of projects added on start when missing
- `DIALOGUE_CHROMIUM` (or `PUPPETEER_EXECUTABLE_PATH`) — Chromium for screenshots; otherwise found on PATH
- `DIALOGUE_PREVIEW_DOMAIN` — parent domain for preview origins (`<token>.<domain>`, needs wildcard DNS); unset → `<token>.preview.localhost`
- `DIALOGUE_PREVIEW_PORT` — port put into `*.preview.localhost` URLs instead of the one the browser used; `dev` sets it to the Node port because browser-sync would rewrite the Host header preview origins are routed by
- `PORT` — listen port (default `4173`)
- `FIGMA_ACCESS_TOKEN` — optional read-only Figma personal access token (`file_content:read`) for attached design/file links; inherited environment wins over a gitignored application-root `.env`. Unset or denied access rejects Figma-backed requests before launching the agent.
- Preview servers inherit the server's environment **except `FIGMA_ACCESS_TOKEN`**, plus `PORT`, `HOST=127.0.0.1`, `BROWSER=none`, `CI=1`, `FORCE_COLOR=0`; `node`/`npm` must be on PATH for Node projects (the Nix package adds them).

## Development security

The server is localhost-only. There is no authentication: anyone who can reach the port can open a terminal running as the Dialogue process in a branch checkout, and every preview server runs repository code as that process too. That is acceptable only for a single developer's machine or the single-user VM, and production must put real authentication in front of both the HTTP routes and the WebSocket upgrade. Previews already run on a separate browser origin.

## Next API evolution

Expand the API only when a real designer pass requires it. Figma attachments provide bounded read-only node data for a request, not binary asset export or a long-lived project import; do not present no-change or failed execution records as Edited snapshots.
