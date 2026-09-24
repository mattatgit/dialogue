# Dialogue

Dialogue is Idealogue's private catalogue, review and publishing tool for AI-assisted interface prototypes.

The repository currently contains two layers of work:

1. the Figma-derived static interaction prototype, which remains the visual/interaction baseline; and
2. a lightweight local functional build that is proving the real project → branch → agent → prototype workflow before production infrastructure is chosen.

## Current functional state

The functional build is git-backed. A project points at a git repository (Landline: `https://github.com/mattatgit/landline`, prototype at `prototypes/app`). Dialogue fetches the repository's branches and tags, and opening one creates a **workspace**: a git worktree for that ref under `.dialogue-data/`.

A branch workspace is a split screen: on the left, a web terminal running the oh-my-pi coding agent (`omp`) inside that branch's checkout; on the right, a live preview of the prototype in a sandboxed iframe that reloads on every file change. The designer asks the agent for a change, sees the result immediately, and presses COMMIT: the agent commits and pushes the branch over a per-project SSH deploy key that Dialogue generates and asks the designer to add to the repository once. Git is the revision model. Tag and commit workspaces are read-only previews without a terminal.

The three earlier functional milestones (Landline V22, V23, V24 on Matt's Mac) are superseded by this model; `docs/CURRENT.md` records them.

The next milestone is the first **real designer-driven change** made through the web terminal on a Landline branch, then pushed and opened as a pull request.

## Run the lightweight local build

Requirements:

- Node.js 22 or newer
- `git`, `ttyd` and `tmux` on PATH (the Nix devshell provides these)
- `omp` (oh-my-pi) on PATH — the developer's own install; the devshell deliberately does not provide it

Start Dialogue in one of these ways:

```text
dev                          # inside the Nix devshell: live-reloading dev server at http://127.0.0.1:8080
npm start                    # plain server at http://127.0.0.1:4173
Start Dialogue.command       # macOS double-click launcher for npm start; checks for git/ttyd/tmux/omp
nix run .#vm                 # headless NixOS demo VM with nginx; console prints http://127.0.0.1:8483 and the ssh command
cp .env.example .env         # then set OPENROUTER_API_KEY; picked up by dev, npm start and the VM
```

Local application data — the bare git mirrors, worktrees and (in the VM) the omp home directory — is stored in `.dialogue-data/`. That folder is deliberately excluded from Git.

See `docs/LOCAL_BUILD.md` for the workflow, data layout and limitations, and `docs/DEVELOPMENT.md` for the devshell, environment overrides and VM.

## Static design prototype

The existing HTML files can still be opened directly in a browser without the local server. In that mode, Dialogue behaves as the original static interaction prototype and uses its mock Landline V19/V18 content.

Current static prototype UI/interaction coverage includes:

- mock sign-in
- Projects and project detail views
- New Project and Profile modals
- image upload previews
- modal motion/backdrop closing
- prototype owner view
- Share modal with copy interaction
- Restart interaction and `R` shortcut
- Settings skeleton
- HTML/CSS-only public Share shell

Inter Tight is the primary UI typeface. Figma-exported SVG/PNG assets are stored in `assets/`. The terminal pane uses JetBrains Mono (OFL) from `assets/fonts/`.

## Project documentation

- `CONTEXT.md` — `Load project context` loading instructions
- `docs/CURRENT.md` — concise active state and next step
- `docs/PRODUCT.md` — product purpose and planned capabilities
- `docs/ARCHITECTURE.md` — current development and production architecture direction
- `docs/DESIGN.md` — Figma source and UI conventions
- `docs/DEVELOPMENT.md` — branches, devshell, VM and development workflow
- `docs/LOCAL_BUILD.md` — lightweight local functional build
- `docs/API.md` — local HTTP/SSE/WebSocket contract
- `docs/superpowers/specs/2026-09-23-git-workspaces-web-terminal-design.md` — approved design for the git-workspace/terminal build

## Branches

- `main` — stable/tested baseline; eventually production
- `develop` — current integration branch and standard context-loading source
- `feature/*` — focused implementation work

New work normally branches from `develop`, is tested, and returns through a pull request.

## Important

GitHub is the source of truth for the Dialogue application source and durable project documentation. The git mirrors and worktrees Dialogue creates under `.dialogue-data/` are runtime artifacts and should not be committed to this repository.

Do not commit credentials, API keys, database secrets, environment files, `.dialogue-data/`, generated `node_modules/` or runtime logs.
