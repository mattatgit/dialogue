# Dialogue — Local HTTP / SSE / WebSocket Contract

## Purpose

`server.js` exposes a small localhost HTTP surface used by the Dialogue UI. Workspaces are git worktrees; the API creates, lists, watches and removes them and proxies a terminal to each branch workspace. There is no import route, revision store or external publishing client any more: changes are committed and pushed from the workspace terminal.

All routes bind to `127.0.0.1` in the local build. In the VM nginx proxies them, including WebSockets.

## Routes

| Route | Behavior |
|---|---|
| `GET /api/health` | liveness check |
| `GET /api/projects` | projects including `repo: { url, prototypePath }` |
| `GET /api/projects/:slug/refs` | runs `git fetch --prune origin` on the bare mirror, then returns `{ branches: [{ name, sha, subject, committedAt, open }], tags: [ … ], fetchError? }`. If the fetch fails the last local refs are returned with `fetchError` set; this route only 5xxs when the bare repo cannot be created at all |
| `POST /api/projects/:slug/workspaces` body `{ ref }` | idempotent; ensures the worktree exists (branch → tracking branch from `origin/<ref>`; tag/commit → detached) and returns the workspace object below |
| `GET /api/workspaces/:id` | `{ id, project: { slug, name }, ref, kind: "branch" \| "tag" \| "commit", head: { sha, subject }, dirty, viewerUrl, entryPoint, terminal }`. `terminal` is `true` only for branch workspaces |
| `DELETE /api/workspaces/:id` | stops the workspace's ttyd if running, then `git worktree remove --force` |
| `GET /api/workspaces/:id/events` | Server-Sent Events. Event `change` with data `{ head, dirty }`, emitted (debounced 150 ms) when files under `<worktree>/<prototypePath>` or the worktree HEAD change |
| `GET /workspace-files/:id/*` | serves `<worktree>/<prototypePath>/*` for the preview iframe, with the same path-safety rules as the earlier prototype file server (no traversal outside the prototype path) |
| `GET /ws/terminal/:id` | WebSocket upgrade, proxied byte-for-byte to the workspace's ttyd. Branch workspaces only |

Workspace `id` is `<slug>/<encodeURIComponent(ref)>`, so it appears URL-encoded in paths. `open` on a ref means a worktree already exists for it.

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

One ttyd runs per branch workspace, started lazily on the first client on a free `127.0.0.1` port. Each client attaches to the same tmux session, so several tabs share one `omp` session and closing a tab does not end it.

## Environment

- `DIALOGUE_DATA` — data directory (default `.dialogue-data/` next to the code; `/var/lib/dialogue` in the VM)
- `DIALOGUE_GIT`, `DIALOGUE_TTYD`, `DIALOGUE_TMUX`, `DIALOGUE_OMP` — override the binaries otherwise found on PATH
- `PORT` — listen port (default `4173`)

## Development security

The server is localhost-only. There is no authentication: anyone who can reach the port can open a terminal running as the Dialogue process in a branch checkout. That is acceptable only for a single developer's machine or the single-user VM, and production must put real authentication in front of both the HTTP routes and the WebSocket upgrade, and serve prototype files from a separate origin.

## Next API evolution

Do not expand the API pre-emptively. Run the first real designer-driven change through the terminal, then decide from observed friction which additions are needed — likely candidates are structured revision-request context handed to the agent, and commit/PR status in the workspace object.
