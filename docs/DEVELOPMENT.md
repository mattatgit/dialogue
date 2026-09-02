# Dialogue — Development Workflow

## Current state

`main` currently contains the latest static Dialogue interaction prototype and is the baseline from which the production app will be built.

## Branch strategy

- `main` — stable/tested baseline; eventually production
- `develop` — staging integration branch
- `feature/*` — individual implementation changes

New implementation work should normally branch from `develop`, then return via pull request.

Example:

1. create `feature/project-management` from `develop`
2. implement and test the change
3. open a pull request into `develop`
4. deploy/test the resulting staging build
5. when a tested release is ready, merge `develop` into `main`
6. `main` deploys to production

## Deployment direction

Planned environments:

- feature branches → temporary Vercel preview deployments
- `develop` → private staging environment
- `main` → production environment

Target domains:

- staging: `staging-dialogue.idealogue.studio`
- production: `dialogue.idealogue.studio`

Prototype content should be served from isolated prototype origins rather than the authenticated app origin.

## Repository hygiene

Do not commit:

- `.env` files
- API keys
- Supabase secrets
- Cloudflare/R2 credentials
- Vercel secrets
- user passwords or auth credentials
- generated `node_modules`

## Prototype baseline

The current prototype can be opened directly via `index.html` and has no build step. Preserve its working visual/interaction behavior while introducing the production stack incrementally.

Before a major framework migration, first establish a runnable baseline and compare the resulting UI against the current prototype/Figma references.

## Codex workflow

For code implementation work, open the `mattatgit/dialogue` repository in Codex and work from `develop` or a feature branch.

Codex should read these files before major implementation work:

- `README.md`
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/DEVELOPMENT.md`

When requesting a change, specify the desired branch/PR target and ask Codex to preserve the existing prototype behavior unless the request explicitly changes it.

For substantial work, prefer one focused feature per branch/PR rather than mixing unrelated changes.

## Initial production-build sequence

Recommended order:

1. establish the real application framework/tooling while preserving the static prototype UI
2. configure Vercel preview/staging deployment
3. add managed authentication and database integration
4. implement projects/prototypes/revisions data model
5. implement isolated prototype storage/serving
6. implement publishing API/tool integration
7. implement public share links and permissions
8. progressively replace remaining prototype-only/mock behaviors
