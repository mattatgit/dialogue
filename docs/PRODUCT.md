# Dialogue — Product

## Purpose

Dialogue is Idealogue's private catalogue and publishing tool for AI-assisted interface prototypes.

It is intended to let a small internal team create projects, receive prototypes generated through an LLM workflow, review them in a consistent owner view, and share selected prototypes externally through controlled public links.

## Initial users

The first production release is for a very small internal Idealogue team. Public self-sign-up is not planned for the initial version.

## Core product flow

1. Sign in to Dialogue.
2. Create or open a project.
3. Build or revise a prototype through an LLM such as ChatGPT.
4. Publish the generated prototype package directly into the selected Dialogue project.
5. Dialogue stores the prototype as a revisioned artifact and generates a preview/thumbnail.
6. Open the prototype in Dialogue's owner view.
7. Share a public link when needed.

## Prototype package

A published prototype should be treated as a complete package rather than a loose set of individual edits. A package may contain:

- `index.html`
- CSS
- optional JavaScript
- images/fonts/other assets
- metadata

Publishing should be atomic: validate the complete package, then make that revision live.

## Revisions

Internally, prototypes and revisions should be separate concepts. LLM updates should create a new revision rather than destructively replacing the previous version. This allows history and rollback.

## Sharing

Public share URLs should be unguessable capability-style links using cryptographically strong random tokens. Links should be revocable. Expiry/password controls can be added later.

The public Share shell should remain HTML/CSS-only where practical. A prototype itself may contain JavaScript when required.

## Planned capabilities

Near-term:

- authentication
- projects
- prototype publishing
- prototype revisions
- thumbnails/screenshots
- owner view
- public sharing
- project/prototype management
- staging/production environments
- LLM connection/publishing API

Later:

- side-by-side Figma design and live prototype views
- comments on both Figma and prototype surfaces
- comment context sent back to the LLM as update prompts
- comment anchors such as Figma node ID, prototype selector, coordinates, viewport and screenshot crop
- JS warning/consent state for prototypes that require scripting
- share-link expiry/password options

## Current repository state

The repository currently contains a static interaction prototype, not the production implementation. Product behavior and visual fidelity in that prototype should be preserved while the real application architecture is introduced incrementally.
