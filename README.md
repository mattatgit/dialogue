# Dialogue

Dialogue is Idealogue's private catalogue, review and publishing tool for AI-assisted interface prototypes.

The repository currently contains two layers of work:

1. the Figma-derived static interaction prototype, which remains the visual/interaction baseline; and
2. a lightweight local functional build that begins turning the prototype into a real application without requiring hosted services.

## Current functional milestone

The first functional milestone is intentionally small: import a real web prototype ZIP into the Landline project, store it locally as a revision, show it in the project grid, and run the imported prototype inside Dialogue's owner viewer.

Landline's current web prototype is **V22**, and V22 is the first intended real test package.

## Run the lightweight local build

Requirements:

- macOS for the current development importer
- Node.js 22 or newer
- the standard `/usr/bin/unzip` command included with macOS

There are currently no npm package dependencies and no web-service accounts are required.

Either:

- double-click `Start Dialogue.command`; or
- run `npm start` from the repository folder.

Then open:

`http://127.0.0.1:4173`

Local application data and imported prototype files are stored in `.dialogue-data/`. That folder is deliberately excluded from Git.

See [`docs/LOCAL_BUILD.md`](docs/LOCAL_BUILD.md) for the current local-build details and limitations.

## Static design prototype

The existing HTML files can still be opened directly in a browser without the local server. In that mode, Dialogue behaves as the original static interaction prototype and uses its mock Landline V19/V18 content.

Current prototype UI/interaction coverage includes:

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

Inter Tight is the primary UI typeface. Figma-exported SVG/PNG assets are stored in `assets/`.

## Project documentation

- [`CONTEXT.md`](CONTEXT.md) — `/context` loading instructions
- [`docs/CURRENT.md`](docs/CURRENT.md) — concise active state and next step
- [`docs/PRODUCT.md`](docs/PRODUCT.md) — product purpose and planned capabilities
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current development and production architecture direction
- [`docs/DESIGN.md`](docs/DESIGN.md) — Figma source and UI conventions
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — branches and development workflow
- [`docs/LOCAL_BUILD.md`](docs/LOCAL_BUILD.md) — lightweight local functional build

## Branches

- `main` — stable/tested baseline; eventually production
- `develop` — integration branch
- `feature/*` — focused implementation work

New work normally branches from `develop` and returns through a pull request.

## Important

GitHub is the source of truth for the Dialogue application source and project documentation. Imported user prototypes are runtime artifacts and should not be committed to this repository.

Do not commit credentials, API keys, database secrets, environment files, or `.dialogue-data/`.
