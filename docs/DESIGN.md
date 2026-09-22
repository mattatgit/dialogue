# Dialogue — Design and Prototype Conventions

## Figma source

Primary design file:

`https://www.figma.com/design/mInH5kB39oFt2FEE7kEF8I/Idealogue-WIP`

Dialogue section/page references used during prototyping include the Dialogue App views and owner/project/settings/modal screens.

Figma remains the source of truth for intended UI where a design exists.

## Typography

Primary UI typeface: Inter Tight.

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

The lightweight functional build includes an **Import prototype** modal created by reusing the existing Dialogue modal/form visual language.

This remains deliberately temporary functional UI so the real import/revision workflow can be tested before the final create/import interaction is designed in Figma.

Current temporary behaviour:

- Landline page action uses **Import**
- modal fields are Prototype name, Revision and Prototype package
- package selection accepts ZIP files
- successful real imports replace the static fallback cards with data-driven revision tiles

The real Landline V22 package has been imported successfully through this UI. External API publishing then created V23, and the local MCP bridge created V24. The functional success of those flows does **not** make the current Import modal or developer launchers final product UI.

When Matt designs the final create/import/revision experience, the Figma design supersedes this temporary UI.

## Imported prototype viewer

The dynamic local owner viewer preserves the existing dark Dialogue owner shell and loads the actual imported prototype into its central stage instead of showing the static Landline PNG.

The current viewer has been verified with real Landline V22/V23/V24 runtime content.

The production viewer should retain the same design intent while providing the separate-origin security boundary described in `docs/ARCHITECTURE.md`.

## LLM/MCP development UI

`Start Dialogue.command`, `Publish API Test.command` and `Test MCP Bridge.command` are development/testing launchers only. They are not product-interface decisions and should not influence future Settings/Connections design.

Likewise, the first ChatGPT Business MCP connection should initially be treated as infrastructure/product validation. Final in-product connection management belongs in a designed Dialogue Settings/Connections experience after the workflow is understood.

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

Imported revisions currently reuse the existing Landline thumbnail PNG. Automatic screenshots/thumbnails are a later functional milestone.

## Prototype tile clipping

Rounded tile surfaces should keep radius/clipping on a dedicated inner surface, while scale/shadow transforms are applied to the outer wrapper. This avoids Safari/WebKit anti-aliasing seams and grey edge artifacts during scaling.

## Public Share shell

The prototype public Share shell is intentionally minimal and HTML/CSS-only. Do not add JavaScript to that shell unless the product/design decision changes.

## Fidelity principle

When implementation and screenshots differ, use Figma measurements/assets/typography as the primary visual reference.

Avoid inventing missing product UI unless a temporary interaction is specifically needed to prove functionality. Any such temporary UI must be clearly documented as temporary, as with the current Import prototype modal.
