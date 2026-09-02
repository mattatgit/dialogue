# Dialogue — Context Loader

This file defines the standard context-loading workflow for ChatGPT conversations about Dialogue.

## Shortcut

When the user sends `/context`, load the current project context from this repository before continuing.

Do not ask the user to restate project history that is already recorded here.

## Load order

1. Read `docs/CURRENT.md` first. Treat it as the concise continuity record.
2. Read `README.md`.
3. Read the durable project documents:
   - `docs/PRODUCT.md`
   - `docs/ARCHITECTURE.md`
   - `docs/DESIGN.md`
   - `docs/DEVELOPMENT.md`
4. Inspect the current `develop` branch source relevant to the next task.
5. Check recent commits or branch state when necessary to understand changes made after the documentation was last updated.

## Ground rules

- GitHub is the source of truth for implementation files.
- Figma is the source of truth for intended visual design where a Figma design exists.
- `docs/CURRENT.md` should be updated when a meaningful milestone, decision, known issue or next step changes.
- Do not rely on chat memory as the primary project record.
- Do not invent missing project history. If the repository documentation does not support something, say so.
- Do not modify files merely because `/context` was invoked. Context loading is read-only unless the user also asks for a change.

## Response after loading

Reply concisely with:

- confirmation that context is loaded;
- the current implementation/state;
- the current next step recorded in `docs/CURRENT.md`;
- any important mismatch between documentation and the current repository state.

After that, continue normally with the user's request.
