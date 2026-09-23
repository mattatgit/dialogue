# Dialogue — Design and Prototype Conventions

## Figma source

Primary design file:

`https://www.figma.com/design/mInH5kB39oFt2FEE7kEF8I/Idealogue-WIP`

Dialogue section/page references used during prototyping include the Dialogue App views and owner/project/settings/modal screens.

Figma remains the source of truth for intended UI where a design exists.

## Typography

Primary UI typeface: Inter Tight. The workspace terminal pane uses JetBrains Mono (see Terminal styling below); it is the only monospace surface in the product.

Use the actual intended weights rather than browser-synthesized approximations. For example, SemiBold should be `font-weight: 600`.

The browser prototype uses `font-synthesis: none` to avoid synthetic weights.

## Breadcrumbs

Figma uses the rightwards arrow character conceptually (`U+2192`, `→`). Because some Google Fonts CSS subsets can omit that glyph and trigger a fallback font, the current prototype renders the separator as a small inline SVG vector for visual consistency.

Breadcrumb links remain un-underlined; hover/focus/active states use colour changes.

## Interaction conventions

Current prototype behaviors that should be preserved unless designs change:

- primary buttons such as Create/Share scale to 105% on pointer hover
- project/prototype tiles scale to 102% on pointer hover
- project/prototype tiles also receive a soft lift/shadow
- prototype tile title and edited date/time are stacked on separate lines
- meatball menu remains independently aligned at the right edge
- Copy in the Share modal changes to `Copied!` for 3 seconds, then returns to `Copy`
- New Project and Profile modals use 100ms ease-out motion
- opening motion moves the modal 16px upward into position
- closing motion moves it 16px downward while fading out
- clicking the modal backdrop closes it
- close buttons close the modal
- reduced-motion preferences disable modal animation

## Temporary functional UI

The lightweight functional build adds two pieces of UI that have not been designed in Figma. Both are deliberately temporary so the real branch → agent → preview workflow can be tested before the final experience is designed.

### Branch and tag tiles

The Landline project page replaces the static fallback cards with a **Branches** group and, when non-empty, a **Tags** group. Tiles reuse the existing `.proto-tile` visual language: ref name, short sha, commit subject, relative commit date, and a small dot when a workspace is already open. A failed fetch renders as a one-line note above the grid.

This is functional UI. When Matt designs how projects, branches and history are presented, the Figma design supersedes it.

### Split-screen workspace

`workspace.html` keeps the existing dark owner-viewer shell, crumbs (`Projects › Landline › <ref>`) and the 370×722 sandboxed prototype stage with Restart / `R`, and adds a status chip (`<sha7> · clean` / `· uncommitted changes`) and a terminal pane on the left (`minmax(420px, 44%)`). Tag/commit workspaces show the stage full-width without a terminal.

The two-column layout is temporary functional UI. It exists to prove that a designer can ask for a change and see it land without leaving Dialogue.

### Terminal styling

The terminal pane's look (`css/terminal.css`) is a deliberate designer-facing choice rather than a default: JetBrains Mono (OFL, `assets/fonts/`) at 13 px / 1.45, 24 px pane padding, hidden scrollbar chrome, non-blinking block cursor, and one palette shared by the xterm theme and the omp theme (`omp/dialogue-theme.json`) — background `#171717`, foreground `#f8f8f8`, muted `#9ea39e`, borders `#272727`/`#3a3a3a`, accent `#ccff00`, success `#17b239`, error `#e5484d`, warning `#f5a623`, selection `rgba(204,255,0,.25)`, restrained syntax tints.

The pane itself, however, is a raw agent TUI. It will be superseded by a designed conversation UI once the workflow shows what the designer actually needs to say and see. Final in-product agent/connection management belongs in a designed Dialogue Settings/Connections experience after that.

## Prototype preview

The workspace preview loads the actual checked-out prototype from the branch's worktree into the central stage instead of showing the static Landline PNG, and reloads it on every file change.

The production viewer should retain the same design intent while providing the separate-origin security boundary described in `docs/ARCHITECTURE.md`.

## Development launchers

`Start Dialogue.command` is a development launcher only, not a product-interface decision.

## Assets

Use supplied/exported Figma SVG and PNG assets where available rather than recreating them in CSS.

Current examples include:

- Dialogue wordmark
- project badges
- sidebar icons
- save heart
- upload control
- New badge
- profile arrow
- meatball menu
- Landline prototype thumbnail PNG
- Landline full-size prototype PNG

Branch and tag tiles currently reuse the existing Landline thumbnail PNG. Automatic screenshots/thumbnails are a later functional milestone.

## Prototype tile clipping

Rounded tile surfaces should keep radius/clipping on a dedicated inner surface, while scale/shadow transforms are applied to the outer wrapper. This avoids Safari/WebKit anti-aliasing seams and grey edge artifacts during scaling.

## Public Share shell

The prototype public Share shell is intentionally minimal and HTML/CSS-only. Do not add JavaScript to that shell unless the product/design decision changes.

## Fidelity principle

When implementation and screenshots differ, use Figma measurements/assets/typography as the primary visual reference.

Avoid inventing missing product UI unless a temporary interaction is specifically needed to prove functionality. Any such temporary UI must be clearly documented as temporary, as with the current branch/tag tiles and split-screen workspace.
