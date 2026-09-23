# Dialogue — Context Loader

This file defines the standard context-loading workflow for ChatGPT conversations about Dialogue.

## Shortcut

When the user's entire message is `Load project context`, load the current project context from this repository before continuing.

Do not ask the user to restate project history that is already recorded here.

## Load order

1. Read `docs/CURRENT.md` first. Treat it as the concise continuity record.
2. Read `README.md`.
3. Read the durable project documents:
   - `docs/PRODUCT.md`
   - `docs/ARCHITECTURE.md`
   - `docs/DESIGN.md`
   - `docs/DEVELOPMENT.md`
   - `docs/LOCAL_BUILD.md` when local functional work is active
   - `docs/API.md` when server/API work is active
   - `docs/superpowers/specs/2026-09-23-git-workspaces-web-terminal-design.md` when touching workspaces, the terminal or the preview
4. Inspect the current `develop` branch and any active feature branch named in `docs/CURRENT.md` or otherwise relevant to the next task.
5. Check recent commits/PR state when necessary to understand changes made after the documentation was last updated.

## Ground rules

- GitHub is the source of truth for Dialogue implementation files and durable project context.
- Figma is the source of truth for intended visual design where a Figma design exists.
- `docs/CURRENT.md` must be updated when a meaningful milestone, architecture decision, UI status, known issue or next step changes.
- Other durable docs should be updated when their subject changes; do not put every long-term decision only in `CURRENT.md`.
- `.dialogue-data/` (cloned repos, worktrees, the VM home directory) is runtime data, not Dialogue source, and should not be committed.
- Do not rely on chat memory as the primary project record.
- Do not invent missing project history. If repository documentation does not support something, say so.
- Do not modify files merely because `Load project context` was invoked. Context loading is read-only unless the user also asks for a change.

## Response after loading

Reply concisely with:

- confirmation that context is loaded;
- current implementation/state;
- active branch/milestone if relevant;
- current next step from `docs/CURRENT.md`;
- any important mismatch between documentation and repository state.

Then continue normally with the user's request.
