# Dialogue — Design and Prototype Conventions

## Figma source

Primary design file:

`https://www.figma.com/design/mInH5kB39oFt2FEE7kEF8I/Idealogue-WIP`

Dialogue section/page references used during prototyping include the Dialogue App views and owner/project/settings/modal screens.

Figma remains the source of truth for intended UI where a design exists.

## Figma attachment inputs

The [Figma connection section](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=145-3744) defines two request-scoped attachment surfaces. The second field in **Create a prototype** turns a pasted design/file link into a Figma-icon chip with a shortened filename and remove control (`Create prototype from empty 3`). In the comment composer, pasting a link anywhere in the message extracts it into the same removable chip below the remaining prose (`Comment with Figma link`). The chip is a design reference attached to that request, not inline text or an automatically saved project-wide file.

## Typography

Primary UI typeface: Inter Tight. The history-card request and summary use Inter at 12 px / 16 px, while badge/time metadata use Inter Tight at 10 px / 16 px. Both are bundled as local web fonts in `assets/fonts/` and declared in `css/dialogue.css` (Inter includes its real italic face); the terminal panel chrome also uses Inter Tight. The `omp` text grid uses Space Mono (see Terminal styling below).

Use the actual intended weights rather than browser-synthesized approximations. For example, SemiBold should be `font-weight: 600`.

The browser prototype uses `font-synthesis: none` to avoid synthetic weights.

## Breadcrumbs

Figma uses the rightwards arrow character conceptually (`U+2192`, `→`). A font subset can omit that glyph and trigger a fallback font, so the current prototype renders the separator as a small inline SVG vector for visual consistency.

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

### Git workspace

The [top-switch design](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=186-3391) and [prototype starting in Interact](https://www.figma.com/proto/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=185-4570&p=f&viewport=-12738%2C15777%2C1&t=RT5Qi83PSaW9F77I-1&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=185%3A4570&page-id=0%3A1) define three mutually exclusive workspace modes. **Interact** shows the prototype across the full canvas. **Comment** opens the Activity rail and the Select / Area / Arrow tools. **LLM terminal** replaces Activity with the on-demand `omp` terminal in the left rail and hides annotation tools. The prototype remains in place as the canvas narrows. Switching away hides, but does not restart, the terminal session; read-only tag/commit workspaces have no terminal mode. The terminal switch icon is exported from the Figma component in grey and white variants.

The [switch-state components](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=142-4283) keep each segment at 112×32 px: no hover scaling or hover background. Unselected text and icon change from `#9ea39e` to `#6b6b6b` on hover; the selected segment stays `#323232` with white text and icon even when hovered. Hover icon SVGs are exported from the Figma variants; other Dialogue buttons retain their own scale interactions.

The [history-card board](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=207-4644) defines **Working** during an agent request, **Created** for the initial build request, **Edited** for a comment that changed the build, **Commented** for a successful no-change comment, and **Vn** after publishing a numbered version. The initial request remains Created in history; the stray Prompt label on an earlier board iteration was removed. Failed runs stay distinct from Commented. Each completed request shows its truncated prompt/comment, a short final agent summary, the selected model's icon or identifiable fallback, and a friendly timestamp; Working omits the time and shows one short live detail in a grey status strip. The transition briefly replaces that detail with the exported tick glyph and **Task completed**.

The current build uses a green `#17b239` tag; previous states use dark `#171717` at 80% opacity, or a blue `#426bc9` tag at full opacity when selected for read-only preview. A no-change Commented card does not create a preview or displace the current build. Selecting the current draft with publishable changes expands **Cancel** and **Save a version**; during publication the button reads **Saving…**. Only a confirmed remote save changes the card to **Vn**, briefly displays disabled **Saved a version** controls, and automatically closes the accordion. Prior Edited snapshots remain local and reopenable. If the current worktree or published version does not exactly match an agent snapshot, a generic Draft or Version card avoids attributing manual changes to a comment. Direct terminal turns retain separate Activity cards.

History request boxes have an 8 px corner radius and 8 px internal padding; short prompts are vertically centred and longer ones clamp to three lines with an ellipsis. Agent summaries render escaped inline Markdown (emphasis, strong, code, strikethrough and HTTP(S) links) and clamp to three visible lines with an ellipsis rather than clipping at the card edge. A Working request is the first card and suppresses the generic Draft card while it runs; after its completion transition, that same request card becomes Created, Edited or Commented as appropriate. A generic Draft still represents independent manual changes when no request is active.

The waiting artwork came from Matt's `Dialogue_waiting animation.svg`. It contains one intermediate frame (a fully visible top stroke and a nearly invisible second stroke), not embedded animation instructions. `assets/history-wait.svg` uses that silhouette and the Figma Waiting component set `111:4499`: three strokes reveal through four variants with 10 ms delays and 100 ms ease-out Smart Animate transitions, hold the completed frame for 500 ms, then reset in 100 ms. The unmodified supplied frame is `assets/history-wait-static.svg`, selected by `<picture>` for reduced motion. The completed tick is `assets/history-complete.svg`; Figma's OpenAI tile is `assets/history-model.svg`. Anthropic, Qwen and Kimi icons are bundled separately; unsupported models display an identifying initial instead of an unrelated logo. The status-text pulse also stops under reduced motion.

### Terminal styling

The terminal panel uses a locally bundled Inter Tight font (OFL) for its 32 px white rounded session strip, including the selected model and current branch. The pane and xterm background are `#f8f8f8`; the xterm and `omp` palettes use dark text, white sent-prompt and status surfaces, and restrained syntax colours. The text grid uses locally bundled Space Mono (OFL) at 12 px / 1.5: xterm assigns one fixed-width cell per character, so proportional Inter Tight visibly breaks spacing and clips the agent transcript.

The terminal itself is still an `omp` TUI. Its prompt blocks and native status line are painted as rows of character cells, not DOM cards; the theme can set their colours but cannot give each prompt a 16 px corner radius or rearrange its messages. The rounded session strip is Dialogue chrome, not a replacement for the native status line. A later custom conversation view can implement those details without compromising the working terminal; direct console access remains available for advanced use.

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
