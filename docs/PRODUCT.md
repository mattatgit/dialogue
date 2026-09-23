# Dialogue — Product

## Purpose

Dialogue is Idealogue's private catalogue and publishing tool for AI-assisted interface prototypes.

It is intended to let a small internal team create projects, receive prototypes generated through an LLM workflow, review them in a consistent owner view, compare them with source designs, request revisions, and share selected prototypes externally through controlled public links.

## Product premise

The workflow being used to build Dialogue today is effectively a manual prototype of the product itself:

1. A design exists in Figma.
2. A prototype/build is produced.
3. The designer compares the two.
4. Differences are described to an LLM, often with screenshots and extra explanation.
5. The LLM changes the implementation.
6. A new build is inspected and the loop repeats.

Dialogue is intended to remove the friction from that loop. In particular, it should reduce or eliminate manual screenshot handoffs, ambiguous references to UI elements, file transfers between tools, and loss of implementation context between conversations.

## Initial users and scale

The first production release is for a very small internal Idealogue team. Public self-sign-up is not planned for the initial version.

The expected real audience for this web version is primarily Matt, Saori and a small number of clients. There is no current requirement to future-proof this implementation for a large public SaaS audience.

The product should be designer-first: a designer should be able to review, comment on, revise and publish prototypes without needing to operate developer tooling directly.

## Core product flow

1. Sign in to Dialogue.
2. Create or open a project. A project is backed by a git repository that contains the prototype.
3. Open a branch of that repository as a workspace.
4. Ask the connected agent, in the workspace, for a change; the agent edits the branch's checkout.
5. Dialogue shows the live prototype beside the agent and reloads it on every change.
6. Compare the live prototype with the associated Figma design when available.
7. Add revision comments directly against the relevant design/prototype element.
8. Send those comments and their context to the agent.
9. Commit and push the result; a pull request is the review artifact.
10. Share a public link when needed.

The long-term review loop should feel closer to:

`Compare design and prototype → identify what is wrong → describe the desired change → agent changes the branch → inspect the reloaded prototype`

GitHub, storage, deployment, terminals and other implementation machinery should remain largely underneath that experience. The current split-screen terminal deliberately exposes some of that machinery so the loop can be learned before it is designed away.

## Design/prototype comparison

A major planned capability is a side-by-side review surface containing the Figma design and the live prototype.

Feedback should be attachable to a specific point in that comparison rather than relying on prose alone. Depending on the surface, a comment may carry context such as:

- Figma file/node ID
- prototype ID and branch/commit
- DOM selector or element reference
- coordinates within the design or rendered prototype
- viewport dimensions
- screenshot crop or rendered visual reference
- surrounding project/revision context

This allows an LLM to receive a much more precise revision request than a screenshot plus a manually written explanation.

## Prototype and revisions

A prototype lives in a git repository at a known path (`repo.prototypePath`), as `index.html`, CSS, optional JavaScript, images/fonts/other assets. Git is the revision model: a commit is a revision, a branch is a line of work, a tag is a named release. Dialogue does not keep its own package or revision store.

This supports, without extra machinery:

- revision history
- comparison between versions
- rollback
- traceability from feedback to resulting commit
- retaining the design/comment context that caused a change (in commit messages and PRs)

Earlier lightweight milestones proved an immutable revision store with Landline V22 → V23 → V24 before this model replaced it.

## Agent relationship

Dialogue should not be a product tied to one model vendor. The current build embeds oh-my-pi (`omp`) as a **connected agent terminal** running inside the branch checkout; anything that can run in a terminal in a checkout could take its place, and a designed conversation UI will eventually replace the raw pane.

The connected agent can see the whole project checkout, edit files, run the project's own tooling, commit and push. Dialogue's job is to put the right context in front of it — the branch, the prototype, and later Figma references and anchored review comments — and to show the designer the result immediately.

The next product-learning milestone is whether a designer can drive a useful visible change end to end from that terminal without leaving Dialogue.

## Sharing

Public share URLs should be unguessable capability-style links using cryptographically strong random tokens. Links should be revocable. Expiry/password controls can be added later.

The public Share shell should remain HTML/CSS-only where practical. A prototype itself may contain JavaScript when required.

## Proven lightweight milestones

Completed locally with Landline and now superseded:

- manual ZIP import of a real prototype (V22) with validation, storage and an in-Dialogue viewer
- API publishing through the same ingestion path (V23)
- an MCP bridge letting an external LLM inspect files and publish an additive derived revision (V24, a non-visible change)

These proved that a revisioned prototype could be held and machine-published. The planned follow-on — connecting a ChatGPT Business workspace to that MCP bridge — was dropped when the model changed: the agent now runs inside Dialogue against a git branch rather than connecting from outside.

## Current build

`develop` provides git-backed workspaces: a project page listing the repository's branches and tags, and a split-screen workspace per branch with a connected agent terminal on the left and a live-reloading prototype preview on the right. Tags and commits open as read-only previews.

## Near-term capabilities

Next:

- first designer-driven visible change made through the connected agent terminal, pushed and opened as a PR
- learn what context the agent and designer need from that test
- a designed conversation UI to replace the raw terminal pane
- workspace management (close/clean up, see open branches)
- thumbnails/screenshots
- authentication when the workflow moves beyond a single user
- public sharing
- broader project management (adding projects with their repositories)

Later:

- side-by-side Figma design and live prototype views
- comments on both Figma and prototype surfaces
- comment context sent to the connected agent as change requests
- comment anchors such as Figma node ID, prototype selector, coordinates, viewport and screenshot crop
- feedback/revision traceability through commits and PRs
- JS warning/consent state for prototypes that require scripting
- share-link expiry/password options

## Current dogfood milestone

The current milestone is the first **real designer-driven change** in the web terminal.

Success means:

1. open a Landline branch in Dialogue;
2. ask the connected agent for one small visible HTML/CSS/JS change;
3. see the preview reload with the change and the status chip show uncommitted changes;
4. commit and push from the same terminal and open a pull request;
5. repeat in the NixOS VM;
6. record what additional structured context or UI the designer and agent needed.

The branch/tag tiles, the split-screen layout and the raw terminal pane are not final product design.

## Product-learning principle

Friction encountered while building Dialogue is useful product evidence. Problems such as screenshot handoffs, ambiguous element references, file transfers, cross-machine syncing, lost chat context and difficulty comparing revisions should be treated as signals for features Dialogue can eventually solve.

The same applies to the connected agent: if it struggles to identify the right file/element/change, improve Dialogue's context model rather than compensating with ad-hoc manual instructions forever.

## Current repository state

`develop` contains the git-workspace/terminal functional build plus the durable project documentation. New focused work should normally branch from `develop` and return through a tested pull request.

GitHub is the durable source of truth for Dialogue application code and project documentation. The repositories and worktrees Dialogue clones for projects live in application storage (`.dialogue-data/`) rather than being treated as Dialogue source files.
