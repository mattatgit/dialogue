# Dialogue — Current State

This file is the short continuity record for active Dialogue work. It should be updated whenever a meaningful milestone, decision or next step changes.

## Current implementation

The repository contains the latest static Dialogue interaction prototype originally developed through ChatGPT/Figma iteration and then moved into GitHub to eliminate ZIP handoffs.

Current prototype capabilities include:

- mock sign-in
- Projects and Landline project views
- New Project modal
- Profile modal
- JPG/PNG badge/avatar upload previews
- modal open/close motion with backdrop closing
- Landline V19 owner view
- Share modal
- Copy → Copied! interaction with 3-second reset
- Restart control and `R` keyboard shortcut
- Settings skeleton
- public HTML/CSS-only Share shell
- Figma-exported SVG/PNG assets and Inter Tight UI typography

The repository is still a static prototype, not the production application.

## Repository workflow

Repository: `mattatgit/dialogue`

Branches:

- `main` — stable baseline; eventually production
- `develop` — current staging/integration branch
- `feature/*` — temporary implementation branches where useful

GitHub is now the source of truth for files. ZIP exchange should no longer be part of the normal workflow.

## Working relationship

The intended collaboration model is designer-first:

- Matt designs in Figma, reviews builds and describes desired changes.
- ChatGPT discusses product/UX/architecture and writes or modifies the code.
- GitHub holds the durable implementation and project documentation.
- Vercel staging will become the browser-visible review environment once the production app setup begins.

Codex is not required for this workflow. Normal Chat is suitable for design discussion and many implementation changes; Work can be used when a task benefits from longer multi-step execution or browser interaction.

## Continuity strategy

This file exists specifically to reduce dependence on chat history.

When a conversation becomes too long or a new chat is started, the working context should be recoverable by reading:

1. `README.md`
2. `docs/PRODUCT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DESIGN.md`
5. `docs/DEVELOPMENT.md`
6. this file (`docs/CURRENT.md`)
7. the current `develop` branch source

A useful new-chat instruction is:

> Continue working on Dialogue. Read the README and everything in `docs/`, especially `docs/CURRENT.md`, then inspect the current `develop` branch before making changes.

Chat memory should not be treated as the primary project record.

## Important product direction

The workflow currently used to build Dialogue is itself a manual prototype of what Dialogue is intended to become.

Today the review loop often requires:

`Figma → build → screenshot/explanation → LLM change → new build → review`

The long-term Dialogue loop should be:

`Figma design + live prototype in Dialogue → anchored feedback → structured revision request → connected LLM → new prototype revision → compare again`

Dialogue should eventually let the designer compare Figma and live prototype views side-by-side and attach feedback directly to the relevant element.

Revision context may include:

- Figma node ID
- prototype/revision ID
- DOM selector or element reference
- coordinates
- viewport dimensions
- screenshot/render crop
- surrounding project context

This should remove much of the need for manual screenshots and explanations.

## LLM/API direction

Dialogue should expose its own LLM-facing API/tool layer rather than being tightly coupled to ChatGPT.

Potential core operations include:

- `list_projects()`
- `get_prototype()`
- `publish_prototype()`
- `update_prototype()`

Later the API should support structured review/revision requests so an LLM can receive precise design/prototype context and publish a new revision back into Dialogue.

Prototype updates should create new revisions rather than destructively overwriting previous versions. Feedback should ideally remain linked to the revision it produced.

## Current architecture direction

Proposed production stack remains:

- GitHub — Dialogue application source control
- Vercel Pro — app/API and staging/production deployment
- Supabase — Postgres + authentication
- Cloudflare R2 — prototype package/assets storage

Generated prototypes should run on an isolated prototype origin, separate from Dialogue's authenticated app origin, and be displayed through a sandboxed viewer.

Staging and production data/storage should remain separate.

## Next work

Continue design and implementation work from the GitHub repository rather than exchanging ZIPs.

When the production transition begins, introduce the real application framework incrementally while preserving the current prototype's visual and interaction behaviour. A browser-accessible staging environment should then become the primary place for build review.

The long-term Dialogue review/API workflow described above should remain a guiding product requirement while near-term core features are implemented.
