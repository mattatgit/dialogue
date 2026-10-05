# Dialogue — Lightweight Local Functional Build

## Purpose

This build exists to prove Dialogue's core product workflow — open a project branch, ask an agent for a change, see the prototype update, push the result — before committing to production hosting, authentication, database or storage services.

No production web-service accounts are required for the local application itself.

The current dogfood project is Landline (`https://github.com/mattatgit/landline`, prototype at `prototypes/app`, previewed through the `.dialogue/preview.json` recipe that preview setup writes for it). The earlier V22/V23/V24 runtime history on Matt's Mac belongs to the superseded revision-store model recorded in `docs/CURRENT.md`; those revisions do not exist in this build.

## Current architecture

The local build runs on one machine:

```text
Browser
  ├── Dialogue UI + /api/*          HTTP
  ├── /api/workspaces/:id/events    SSE → chip, preview reload, preview server state
  ├── /ws/terminal/:id              WebSocket → ttyd → tmux → omp
  └── <token>.preview.localhost     preview origin per workspace → static files or the project's dev server
        ↓
Dialogue local Node server (server.js, server/git.js, server/requests.js, server/watch.js,
                            server/terminal.js, server/setup.js, server/runner.js,
                            server/preview-proxy.js, server/live-preview.js, server/figma.js)
        ↓
.dialogue-data/
  db.json                     projects (schemaVersion 4): slug, repo.url/host/owner/repo, previewSetup
  repos/<slug>.git            bare mirror, fetched on demand
  workspaces/<slug>/<ref>/    one git worktree per opened ref (<ref> URL-encoded)
  requests/<slug>/*.json      persisted structured comments and agent runs
  keys/<slug>, <slug>.pub     per-project SSH deploy key (push only) + known_hosts
  setup/<slug>/log.txt        preview setup log (agent + install/start output)
  setup/<slug>/tree/          detached worktree the setup agent works in (kept, so installs are reused)
  stamps/<slug>/<ref>/        install stamp per workspace: install reruns only when lockfiles change
  previews/<slug>/            screenshots per commit (<sha>.png) and main.png
  agent.json                  selected AI model
  home/                       omp profile + credentials — VM only; dev uses the real $HOME
```

`.dialogue-data/` is ignored by Git.

Workspaces have no database table: `git worktree list --porcelain` on the bare mirror is the source of truth. Git is the revision model; there is no separate revision store.

## Start

Requirements:

- Node.js 22+
- `git`, `ttyd`, `tmux` and `omp` (oh-my-pi) on PATH — the Nix devshell provides them; outside it, install omp yourself
- whatever the projects' previews run, e.g. `node`/`npm` (devshell and Nix package provide Node.js); Chromium for screenshots is optional (devshell provides it)

Start with one of:

```text
dev                       # devshell: live-reloading dev server, http://127.0.0.1:8080
npm start                 # plain server, http://127.0.0.1:4173
Start Dialogue.command    # macOS launcher for npm start; checks git/ttyd/tmux/omp are present
```

The server binds to localhost only.

## Workflow

0. Projects lists what is in `db.json` (Landline when seeded). **Add project** takes the address of any Git repository — HTTPS for public repositories, the `git@…` SSH address for private ones (the dialog explains where to find it on GitHub). Dialogue clones it and opens the project page; a private repository first shows the key to add as a deploy key. Hovering a card reveals **×** to remove the project from Dialogue (local copy only).
1. In the background Dialogue sets up the project's preview. Each card has a **Preview** line: *Waiting to set up*, *Setting up…* (*try 2 of 3* on retries), *Waiting for an AI model* (sign in under Settings; setup continues by itself), *Ready* or *Setup failed*. The agent inspects the repository and writes `.dialogue/preview.json` — plain files, or the project's install and dev-server commands — and Dialogue proves it by starting the preview and taking a screenshot, handing any error back to the agent up to three times. A repository that already has a working recipe skips the agent. On success the recipe is committed on the local default branch (not pushed; the next Save version on that branch sends it) and the card shows the screenshot. A failed card shows the reason with **Retry**, **Fix with agent** (opens the default branch with the problem handed to the agent in the terminal) and **Show log**.
2. Open Projects → Landline. Dialogue fetches the repository and shows a **Branches** group and, when there are any, a **Tags** group. Each tile shows the ref name, short sha, commit subject and relative commit date, and a screenshot — the branch's own once it has been opened, otherwise the default branch's labelled "from main"; a dot marks refs that already have a workspace. If the fetch fails (offline), a one-line note appears and tiles render from the last local refs.
3. Click a branch. Dialogue creates the worktree (first open creates a local tracking branch from `origin/<branch>`, or fast-forwards a local branch that has nothing of its own) and opens `workspace.html?id=…`.
4. The workspace shows a 370×722 sandboxed prototype preview on its own origin `http://<token>.preview.localhost:<port>/`. The top switch selects Interact (full-width preview), Comment (Activity rail and annotation tools), or LLM terminal (on-demand `omp` in the left rail instead of Activity). Switching modes keeps the terminal session running. For a server recipe Dialogue runs the install (only when lockfiles changed) and the dev server, showing *Installing…* / *Starting the preview…* meanwhile; the server stops 10 minutes after the last viewer leaves. Crumbs read `Projects › Landline › <branch>`; the status chip shows `<sha7> · clean`.
5. Send an anchored comment in Comment mode. While the agent works, Activity shows its pulsing Dialogue mark and live status; when it finishes, the card shows the comment and short summary instead of verbose agent notes. The agent edits the checkout; the preview reloads (or uses the dev server's own HMR with `"reload": "self"`). The live Draft remains in Activity and a successful file-changing run adds a private, read-only Edited snapshot linked to the comment. A no-change run is just an execution record. Direct terminal turns show their status and summary separately, without a fake Edited snapshot. The chip reports `· uncommitted changes`; Restart / `R` still reloads manually. If the dev server stops, the last output and **Restart preview** replace it; editing the recipe restarts it automatically.
6. Select Draft and press **Save a version** after reviewing. The first time, Dialogue shows the project's public deploy key to register with write access. Once connected, Dialogue atomically pushes a commit for the current Draft and the numbered Version tag. Only a confirmed publish briefly displays **Saved version**. A failed push leaves the Draft and pending save retryable, never a false Version; previous Edited snapshots remain private. The chip updates to the saved SHA and clean state. Open a PR on the git host.

The **Create a prototype** modal accepts a pasted Figma design/file link in its second field and turns it into a removable chip. In Comment mode, a Figma link pasted anywhere in the message becomes a separate removable chip while the surrounding prose remains. Both submit `figmaUrl` with the feedback. Dialogue reads the file outline or selected node using its server-only `FIGMA_ACCESS_TOKEN`, stages design JSON outside the checkout for the agent, and lets a running request inspect deeper frame nodes on demand. For nodes configured for SVG or PNG export in that snapshot or an inspected frame, the agent can fetch the actual binary at Figma's configured scale through a short-lived URL; it then decides which downloaded assets to add to the worktree. Nothing is exported solely by pasting a link. If the token is missing or Figma denies access, the request is rejected with a specific error; the link alone is not treated as a connected design.

Closing the tab does not end the agent: the omp session lives in tmux and reattaches when the workspace is reopened. Opening a **tag** or commit gives a full-width read-only preview with no terminal.

Deleting a workspace (`DELETE /api/workspaces/:id`) stops its terminal and preview server and removes the worktree; the bare mirror and the remote are untouched.

## Terminal details

- ttyd starts lazily on the first WebSocket client, on a UNIX socket, and is proxied through Dialogue at `/ws/terminal/:id`; the browser never connects to ttyd directly.
- The command is `tmux -f omp/tmux.conf new-session -A -s dialogue-<hash> -c <worktree> omp --config omp/config.yml --append-system-prompt omp/system-prompt.md`.
- `omp/dialogue-theme.json` is installed into the active omp profile's themes directory before the first spawn, so the agent's colours match the pane (`css/terminal.css`).
- If `ttyd`, `tmux` or `omp` is missing, the pane shows the server's error instead of "Reconnecting…".

## Prototype viewer isolation

Each workspace's preview is served on its own browser origin (`<token>.preview.localhost:<port>`), separate from Dialogue's, so prototype JavaScript cannot reach Dialogue's session, storage or pages; the iframe sandbox therefore allows same-origin behaviour for the prototype itself. `*.localhost` resolves to loopback in current browsers, so this works on one machine and through the VM's forwarded port; other machines need `services.dialogue.previewDomain` with wildcard DNS.

This is **not yet the final production security boundary**: preview servers run the repository's own install/start commands, and the agent runs, with the Dialogue process's own privileges.

Production keeps the separate prototype execution origin, for example:

- trusted app: `dialogue.idealogue.studio`
- untrusted prototype code: `<token>.p.idealogue.studio`

## Known limitations

- no authentication — anyone who can reach the port gets a shell-capable agent in the checkout; localhost-only mitigates this on a dev machine
- the terminal is the raw omp TUI in an xterm.js pane, not a designed conversation UI
- localhost-only; the VM adds nginx but still no auth
- omp is authenticated through `OPENROUTER_API_KEY` in `.env` (dev and VM) or by signing in under Settings → AI model (or `/login` in the terminal). Git push uses the generated deploy key; the private key lives unencrypted in `.dialogue-data/keys/` and is readable by the agent process
- no multi-user access
- no public sharing implementation
- screenshots exist only for commits whose preview has run (setup, opened workspaces, default-branch refresh); other tiles show the default branch's image
- Figma attachments supply document/node data, not automatically exported SVG/PNG assets or a persistent project-wide design import; the temporary agent snapshot is removed after the request.
- workspaces are only removed through the API; there is no cleanup UI yet
- preview servers and installs are not sandboxed; a project's dependencies run as the Dialogue user

## Next test

1. run `dev` (seeds Landline from `seed.json`) or add a project by pasting its repository address; wait for Preview Ready, then open `main` (or a feature branch)
2. send an anchored comment; confirm a file-changing run creates a reopenable Edited card while Draft remains live
3. confirm the prototype preview reloads with the change and the chip shows uncommitted changes
4. select Draft and Save version; register the deploy key if required and confirm a Vn card, remote commit and tag
5. open a PR and repeat end to end in `nix run .#vm`

The purpose is to learn what the designer and the agent each need from the split screen before any production infrastructure work begins.
