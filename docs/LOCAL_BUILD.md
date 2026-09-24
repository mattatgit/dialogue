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
Dialogue local Node server (server.js, server/git.js, server/watch.js, server/terminal.js,
                            server/setup.js, server/runner.js, server/preview-proxy.js, server/live-preview.js)
        ↓
.dialogue-data/
  db.json                     projects (schemaVersion 4): slug, repo.url/host/owner/repo, previewSetup
  repos/<slug>.git            bare mirror, fetched on demand
  workspaces/<slug>/<ref>/    one git worktree per opened ref (<ref> URL-encoded)
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
- `git`, `ttyd`, `tmux` on PATH — the Nix devshell provides them
- `omp` (oh-my-pi) on PATH — your own install; the devshell deliberately does not provide it
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
1. In the background Dialogue sets up the project's preview. Each card has a **Preview** line: *Waiting to set up*, *Setting up…* (*try 2 of 3* on retries), *Waiting for an AI model* (sign in under Settings; setup continues by itself), *Ready* or *Setup failed*. The agent inspects the repository and writes `.dialogue/preview.json` — plain files, or the project's install and dev-server commands — and Dialogue proves it by starting the preview and taking a screenshot, handing any error back to the agent up to three times. A repository that already has a working recipe skips the agent. On success the recipe is committed on the local default branch (not pushed; the next COMMIT on that branch sends it) and the card shows the screenshot. A failed card shows the reason with **Retry**, **Fix with agent** (opens the default branch with the problem handed to the agent in the terminal) and **Show log**.
2. Open Projects → Landline. Dialogue fetches the repository and shows a **Branches** group and, when there are any, a **Tags** group. Each tile shows the ref name, short sha, commit subject and relative commit date, and a screenshot — the branch's own once it has been opened, otherwise the default branch's labelled "from main"; a dot marks refs that already have a workspace. If the fetch fails (offline), a one-line note appears and tiles render from the last local refs.
3. Click a branch. Dialogue creates the worktree (first open creates a local tracking branch from `origin/<branch>`, or fast-forwards a local branch that has nothing of its own) and opens `workspace.html?id=…`.
4. The workspace is split: the **terminal** on the left, running `omp` inside that branch's checkout; the **prototype preview** on the right in the familiar 370×722 sandboxed iframe, loaded from the workspace's own preview origin `http://<token>.preview.localhost:<port>/`. For a server recipe Dialogue runs the install (only when lockfiles changed) and the dev server, showing *Installing…* / *Starting the preview…* meanwhile; the server stops 10 minutes after the last viewer leaves. Crumbs read `Projects › Landline › <branch>`; the status chip shows `<sha7> · clean`.
5. Ask omp for a change in the terminal. As it edits files the preview updates — Dialogue reloads the iframe, or the dev server's own hot reload does when the recipe says `"reload": "self"` — the chip switches to `· uncommitted changes` and a **COMMIT** button appears in the header. Restart / `R` still reloads the preview by hand. If the dev server stops, its last output and a **Restart preview** button replace the preview; editing the recipe restarts it automatically.
6. Press COMMIT. The first time, Dialogue shows the project's public deploy key with instructions to add it to the repository with write access; after "I've added the key — continue" (or immediately on later commits) omp is asked to commit and push (pulling with rebase and retrying once if the remote moved), reports in the terminal, and the chip returns to `clean` with the new sha. Between commit and push it reads `· 1 to push` and the button says **Push 1 commit**.

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
- no Figma comparison/comments yet
- workspaces are only removed through the API; there is no cleanup UI yet
- preview servers and installs are not sandboxed; a project's dependencies run as the Dialogue user

## Next test

1. run `dev` (seeds Landline from `seed.json`) or add a project by pasting its repository address; wait for the card's Preview line to say Ready, then open `main` (or a feature branch)
2. confirm the terminal connects and omp starts in the worktree
3. ask omp for one small visible colour/copy change in the prototype
4. confirm the preview reloads with the change and the chip shows uncommitted changes
5. press COMMIT, register the deploy key, let omp commit and push; open a PR on GitHub
6. repeat end to end in `nix run .#vm`

The purpose is to learn what the designer and the agent each need from the split screen before any production infrastructure work begins.
