# Dialogue — Design and Prototype Conventions

## Figma source

Primary design file:

`https://www.figma.com/design/mInH5kB39oFt2FEE7kEF8I/Idealogue-WIP`

Dialogue section/page references used during prototyping include the Dialogue App views and owner/project/settings/modal screens.

Figma remains the source of truth for intended UI where a design exists.

## Figma attachment inputs

The [Figma connection section](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=145-3744) defines two request-scoped attachment surfaces. The second field in **Create a prototype** turns a pasted design/file link into a Figma-icon chip with a shortened filename and remove control (`Create prototype from empty 3`). In the comment composer, pasting a link anywhere in the message extracts it into the same removable chip below the remaining prose (`Comment with Figma link`). The chip is a design reference attached to that request, not inline text or an automatically saved project-wide file.

## Typography

Primary UI typeface: Inter Tight. The terminal panel chrome also uses Inter Tight; the `omp` text grid uses Space Mono (see Terminal styling below).

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

### Git workspace

The integrated workspace keeps the designed review canvas, Activity rail, and Interact / Comment controls. Its on-demand `omp` terminal remains functional UI rather than the intended final conversation design. The terminal opens over the canvas in a 256 px column aligned with the Activity rail; in Comment mode, the canvas and terminal move alongside Activity. Tag/commit workspaces remain read-only without a terminal.

The designed Activity cards have three distinct meanings: **Draft** is the one live working prototype, **Edited** is an immutable local snapshot linked to a comment that changed files, and **Vn** is a numbered Version of the reviewed Draft confirmed on the remote repository. Draft coexists with all prior Edited and Version cards. Running agent work gets a compact card with the pulsing Dialogue mark and live status; when it finishes, the relevant Edited or completed-request card shows the comment and a short summary, not the verbose transcript. Direct terminal turns get the same transient status and short settled summary without fabricating an Edited snapshot. Selecting Draft with publishable changes reveals **Save a version** and Cancel; after a confirmed save it briefly says **Saved version** and Draft remains available for further edits. Selecting Edited or Version opens its read-only SHA preview; selecting Draft there returns to the source branch. A completed request without file changes is shown as activity, not mislabelled Edited. These card states follow the approved prototype; the on-demand terminal remains temporary functional UI.

### Creation Activity card — specified, not implemented

This describes the intended **initial prototype-creation card**, not the current integration behavior. Do not change the application to match it until the user explicitly asks to begin implementation.

- The first card in any session represents the prompt that created the prototype; truncate that prompt if it will not fit. While the LLM is still building the initial prototype and there are no other cards, this is the top card and its status label is green **Working**.
- In Working state, a grey status box at the bottom contains the animated Dialogue mark and a very short, pulsing, one-line agent-working detail where available. The animation and text must fit the limited space.
- Once the task is complete **and** there is something in the viewer for the user to comment on, the card changes from Working to **Draft**. Show the agent's icon (ChatGPT in the illustrated flow) and one short sentence about what it did. The bottom status bar changes to the special tick version of the Dialogue icon plus **Task completed**.

Figma source: [Working-state prototype](https://www.figma.com/proto/YXlBjYhWIS1sfu8cffH5un/Dialogue?page-id=0%3A1&node-id=112-4558&p=f&viewport=-3660%2C11526%2C1&t=iLPGyuoQmO4scS5C-1&scaling=scale-down-width&content-scaling=fixed&starting-point-node-id=112%3A4558), file `YXlBjYhWIS1sfu8cffH5un`, frame `112:4558` (**Draft Card working**). The **Working details** group `112:4563` contains **Waiting** instance `112:4565`, whose component set `111:4499` has four vector variants with timed Smart Animate transitions. The browser prototype link prompts for Figma login, but this project's configured Figma token successfully read those nodes and transition metadata through the Figma API. Figma's prototype is not itself an embeddable animated asset: use the actual vectors and timings rather than the current approximate `assets/dialogue-wait.svg`. If an original Rive, Lottie, or animated SVG export is supplied, prefer that for exact playback. No animation or UI implementation was started from this handoff.

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
