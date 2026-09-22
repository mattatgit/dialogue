# Dialogue — MCP / LLM Bridge

## Purpose

This document records the first MCP adapter used to prove the real LLM → Dialogue revision workflow before Dialogue is moved to a production stack.

The architectural rule remains:

```text
LLM client
   ↓
MCP adapter
   ↓
Dialogue application/API + revision model
```

Dialogue should remain model-provider agnostic. The current bridge is development scaffolding for learning what context and revision operations an LLM actually needs.

## Status

The MCP bridge baseline was completed via PR #3 and is now part of the tested `main` baseline after PR #5.

The preceding local API publishing milestone created Landline V23. The MCP smoke test then successfully inspected the latest Landline revision and published **Landline V24** as a new derived immutable revision. V24 appeared in Dialogue and ran correctly.

The V24 test intentionally changed only a non-visible HTML comment, so the prototype remained visually/functionally equivalent. This proves the tool transport, revision reading and additive publishing path independently of model-authored visual changes.

Matt's **Idealogue ChatGPT Business workspace** is connected successfully to Dialogue through the custom MCP app + Secure MCP Tunnel path. The first real model-authored visible write was completed with Landline V25.

## Local MCP server

`mcp-server.mjs` is a stdio MCP server built with the MCP TypeScript SDK.

Current tools:

- `list_projects()` — read-only
- `list_revisions(project_slug)` — read-only
- `get_revision(revision_id)` — read-only
- `list_revision_files(revision_id)` — read-only
- `read_revision_file(revision_id, path)` — read-only text-file access
- `publish_revision(...)` — additive write action

`publish_revision` never overwrites its base revision. It derives a new revision from an existing local revision, reuses unchanged assets, applies bounded text edits, packages the result, and sends the complete package back through Dialogue's existing HTTP import/revision pipeline.

The tool currently supports:

- exact single-occurrence text replacements in existing files
- full text-file writes where necessary
- automatic next numeric revision selection
- optional explicit numeric version
- no file deletion
- no binary-file editing
- at most 25 edits per publish call
- maximum 2 MB per editable text file

These constraints are intentionally conservative for the first real LLM test.

## Development-only storage access

The MCP adapter currently reads revision file trees directly from `.dialogue-data/` because the lightweight Dialogue HTTP API does not yet expose file-list/read endpoints.

This is acceptable only for the local product-validation build.

Publishing still returns through Dialogue's normal import API, so the authoritative revision creation path remains shared with the browser Import UI and the already-proven API test client.

Before production, local filesystem reads should become proper Dialogue application/API operations. The eventual MCP adapter should not need privileged knowledge of storage layout.

## Verified local smoke test

`Test MCP Bridge.command` is the designer-friendly local test.

The verified test sequence was:

1. connect to Dialogue's MCP server over stdio
2. discover the Dialogue MCP tools
3. read the Landline project and latest revision
4. list its files
5. read its entry-point HTML
6. call `publish_revision`
7. create the next numeric revision with only a non-visual HTML comment added
8. open the Landline project and verify the new revision

Result: V23 was used as the base and V24 was created successfully. V24 appeared in the project and ran correctly.

## Why derived revisions instead of sending a whole ZIP from the LLM

The earlier API milestone proved that a complete ZIP can be published through Dialogue. That is suitable for human import and generic external clients, but it is awkward for an LLM because a prototype package can contain many unchanged images, fonts and other binary assets.

The MCP bridge therefore uses a base-revision model:

```text
Landline V23
   ↓ clone locally
small HTML/CSS/JS edit
   ↓
package complete derived revision
   ↓
Dialogue import API
   ↓
Landline V24
```

This is closer to the real product behavior we want: the model changes only what is necessary, while Dialogue still stores an immutable complete revision that can run independently.

## ChatGPT Business connection direction

Matt is keeping his Personal ChatGPT workspace separate and has created an **Idealogue Business workspace** for work projects including Dialogue and Landline.

OpenAI product documentation checked in September 2026 says full custom MCP support, including write/modify actions, is available in beta to ChatGPT Business, Enterprise and Edu workspaces. This makes Business the preferred route for the first direct ChatGPT UI → Dialogue `publish_revision` test.

The intended development path is:

```text
ChatGPT Business
   ↓ custom MCP app / developer mode
secure local/private MCP connection
   ↓
Dialogue MCP adapter on Matt's Mac
   ↓
Dialogue application/API + revisions
```

Dialogue's localhost web app should remain private. Use the supported secure connection/tunnel mechanism for the MCP server rather than exposing the local app directly to the public internet.

The exact setup steps should be checked against current OpenAI documentation immediately before configuration because developer-mode/MCP UI can change during beta.

The OpenAI API route remains a fallback if needed for provider-agnostic testing, but there is no reason to introduce separate API billing/key management for the next test while the Business custom-MCP route is available.

## Revision requests and activity

The planned prototype feedback UI should not depend on reproducing the provider's complete chat transcript or reasoning UI.

Dialogue should expose revision requests and capture a provider-neutral activity history around them. MCP or another provider adapter may contribute events such as:

- request acknowledged/claimed;
- project/revision context read;
- prototype files read;
- files changed;
- explicit assistant message or work summary when available;
- provider-supplied reasoning summary when available;
- revision published;
- error/retry state.

Dialogue should normalize those events into its own schema before rendering them. Raw provider payloads and raw private chain-of-thought are not part of the core Dialogue contract.

This lets the same Feedback/Activity panel work across ChatGPT, Claude, Kimi, Qwen or another connected LLM even when their conversation/reasoning APIs differ.

## Security stance

The first MCP bridge is deliberately local and narrow:

- Dialogue remains bound to localhost
- MCP server uses stdio, not a public listening port
- no destructive/delete tool exists
- `publish_revision` creates a new revision rather than mutating one
- editable paths are restricted to the selected revision directory
- only known text extensions can be read/edited by the bridge
- exact replacements must match once, reducing accidental broad edits

Remote ChatGPT access should use the supported secure MCP connection path rather than opening Dialogue's localhost server directly to the internet.

## Next milestone

1. design the Dialogue-side revision-request/activity schema
2. add MCP/API operations for reading/claiming revision requests and linking a resulting revision to its request
3. prototype anchored feedback from the prototype Share/review surface
4. surface provider-neutral activity in Dialogue without depending on provider-specific full chat output
5. dogfood the loop with more realistic model-authored UI revisions
6. refine the schema only where real use exposes missing context
