# Dialogue

Dialogue is Idealogue's private catalogue and publishing tool for AI-assisted interface prototypes.

This repository currently contains the working static interaction prototype. It is the baseline for the production application; the production architecture has not yet been implemented.

## Current prototype

Open `index.html` directly in a browser. No build step is required.

The current flow includes:
- mock sign-in
- Projects and project detail views
- New Project and Profile modals
- image upload previews
- modal open/close motion and backdrop closing
- Landline prototype owner view
- Share modal with copy interaction
- Restart interaction and `R` shortcut
- Settings skeleton
- HTML/CSS-only public Share shell

Inter Tight is the primary UI typeface. Figma-exported SVG/PNG assets are stored in `assets/`.

## Project documentation

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — product purpose, users and planned capabilities
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — proposed production architecture and security model
- [`docs/DESIGN.md`](docs/DESIGN.md) — Figma source and implementation conventions
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — branches, environments and development workflow

## Branches

- `main` — stable/tested baseline; eventually production
- `develop` — staging integration branch
- `feature/*` — individual implementation changes

New work should normally branch from `develop` and return through a pull request.

## Important

Do not commit credentials, API keys, database secrets or environment files. Production secrets will be managed by the deployment platform/environment configuration.
