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

Dialogue is intended to remove the friction from that loop. In particular, it should reduce or eliminate manual screenshot handoffs, ambiguous references to UI elements, ZIP/file transfers, and loss of implementation context between conversations.

## Initial users and scale

The first production release is for a very small internal Idealogue team. Public self-sign-up is not planned for the initial version.

The expected real audience for this web version is primarily Matt, Saori and a small number of clients. There is no current requirement to future-proof this implementation for a large public SaaS audience.

The product should be designer-first: a designer should be able to review, comment on, revise and publish prototypes without needing to operate developer tooling directly.

## Core product flow

1. Sign in to Dialogue.
2. Create or open a project.
3. Build or revise a prototype through an LLM such as ChatGPT.
4. Publish the generated prototype package directly into the selected Dialogue project.
5. Dialogue stores the prototype as a revisioned artifact and generates a preview/thumbnail.
6. Open the prototype in Dialogue's owner view.
7. Compare the live prototype with the associated Figma design when available.
8. Add revision comments directly against the relevant design/prototype element.
9. Send those comments and their context to the connected LLM.
10. Receive a new prototype revision back into Dialogue and review it.
11. Share a public link when needed.

The long-term review loop should feel closer to:

`Compare design and prototype → identify what is wrong → describe the desired change → send to LLM → inspect the new revision`

GitHub, storage, deployment, API calls and other implementation machinery should remain largely underneath that experience.

## Design/prototype comparison

A major planned capability is a side-by-side review surface containing the Figma design and the live prototype.

Feedback should be attachable to a specific point in that comparison rather than relying on prose alone. Depending on the surface, a comment may carry context such as:

- Figma file/node ID
- prototype ID and revision ID
- DOM selector or element reference
- coordinates within the design or rendered prototype
- viewport dimensions
- screenshot crop or rendered visual reference
- surrounding project/revision context

This allows an LLM to receive a much more precise revision request than a screenshot plus a manually written explanation.

## Prototype package

A published prototype should be treated as a complete package rather than a loose set of individual edits. A package may contain:

- `index.html`
- CSS
- optional JavaScript
- images/fonts/other assets
- metadata

Publishing should be atomic: validate the complete package, then make that revision live.

## Revisions

Internally, prototypes and revisions should be separate concepts. LLM updates should create a new revision rather than destructively replacing the previous version.

This supports:

- revision history
- comparison between versions
- rollback
- traceability from feedback to resulting revision
- retaining the design/comment context that caused a change

The product should be able to represent a progression such as V18 → V19 → V20 without losing earlier working versions.

## LLM relationship

Dialogue should not be a ChatGPT-specific product. Dialogue should expose an LLM-facing API/tool layer that capable models can connect to.

ChatGPT may be the initial integration, but the product model should remain provider-agnostic so another LLM can participate in the same workflow later.

The connected LLM should be able to discover Dialogue projects, read relevant prototype/revision context, publish new prototypes and create new revisions from requested changes.

## Sharing

Public share URLs should be unguessable capability-style links using cryptographically strong random tokens. Links should be revocable. Expiry/password controls can be added later.

The public Share shell should remain HTML/CSS-only where practical. A prototype itself may contain JavaScript when required.

## Planned capabilities

Near-term:

- real project/prototype/revision persistence
- manual prototype import
- safe prototype package validation/storage
- live imported prototype owner viewer
- API publishing path that uses the same ingestion pipeline as manual import
- first LLM connection/publishing experiment
- authentication when the workflow moves beyond local development
- thumbnails/screenshots
- owner view
- public sharing
- project/prototype management

Later:

- side-by-side Figma design and live prototype views
- comments on both Figma and prototype surfaces
- comment context sent back to the LLM as update prompts
- comment anchors such as Figma node ID, prototype selector, coordinates, viewport and screenshot crop
- direct revision requests from Dialogue to a connected LLM
- feedback/revision traceability
- JS warning/consent state for prototypes that require scripting
- share-link expiry/password options

## Current dogfood milestone

The first real functional target is to use **Landline V22**, the current Landline web prototype, as a genuine imported Dialogue revision.

Success for this milestone means:

1. import the Landline V22 ZIP through Dialogue
2. store it as a revision rather than mock/static content
3. show V22 in the Landline project grid
4. open and interact with the actual V22 prototype in Dialogue's owner viewer
5. use the same underlying revision-ingestion path later from an API/LLM client

The temporary Import UI used to prove this flow is not the final product design.

## Product-learning principle

Friction encountered while building Dialogue is useful product evidence. Problems such as screenshot handoffs, ambiguous element references, ZIP transfers, cross-machine file syncing, lost chat context and difficulty comparing revisions should be treated as signals for features Dialogue can eventually solve.

## Current repository state

The stable repository baseline contains the static interaction prototype. Active functional work is being introduced incrementally on feature branches while preserving the existing Figma-derived visual/interaction behaviour.

GitHub is the durable source of truth for Dialogue application code and project documentation. Imported runtime prototypes themselves should live in application storage rather than being treated as Dialogue source files.
