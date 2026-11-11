# Dialogue — Design and Prototype Conventions

## Figma source

Primary design file:

[Dialogue](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue). The older Idealogue-WIP file is historical; use the current Dialogue file for visual changes.

Figma remains the source of truth for intended UI where a design exists.

## Settings V2 (2026-11-11)

Implemented from [Settings V2, `272:5040`](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=272-5040), main frame `289:5803`, with the supplied connected/disconnected provider, button and avatar component states. Use the existing Inter Tight webfont. The desktop content column is504px at x288/y128 on the1440px frame, with40px group gaps and48px rows. Exact Figma exports are in `assets/settings-v2/`; retain their intrinsic SVG sizes. Provider icons are32px, the connected dot8px, model/profile arrows24px, navigation glyphs16/16.5px in32px slots. The model arrow uses the design's vertical flip. The default128px avatar uses the exported Aristotle image; actual user photos remain dynamic.

Matt clarified: Username means display name (no unique handle); autosave profile/grid edits; email stays read-only; one LLM service per member at a time, green means connected. Preserve per-person provider/account boundaries. Avatar supports file picker and drag/drop; centre-crop locally to a256px PNG and persist through the normal account API. Sidebar, member cards and conversation use the current profile. Grid remains browser-local. The sidebar submenu scrolls to Account, Members, LLM connection and Grid and tracks the visible section. The workspace's existing Settings#agent-model link still focuses the model picker.

Disconnected rows reveal Connect on hover or keyboard focus; touch shows it directly. Connected model/Disconnect hover and press colors follow Figma. Temporary matching controls retain passkey management, owner invitations/removal, working-copy release, extra providers/connection details and local development switching in small expandable menus. Sign out is in the sidebar profile menu. These supporting menus may be polished later; no existing authorization is bypassed.

## Project/build flow review (2026-11-10)

Matt requested a rough working flow using existing Dialogue components before design polish. Projects has Create project / Import project; each project's gallery has one card per stable named build plus Create build / Import build. Branches/versions live inside the build. Both import entries use the same assessment/discussion, editable proposal, confirmation, progress/results and recovery surface. The current `projects.html`, `project.html`, `build.html` and `import.html` layouts are temporary functional UI, not a new visual source of truth. Retain existing fonts/icons/components and the designed conversation sidebar. Clearly label unavailable targets and distinguish configured previews from intended UI verification. Do not fabricate live-presence badges from worktree state. See the [approved handoff](ARCHITECTURE.md).

## Conversation sidebar (2026-11-04)

Matt approved [Commenting, `261:4651`](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=261-4651) as the replacement for the Activity rail and visible OMP console. It is implemented on `codex/conversation-sidebar`, based on the validated isolation branch. The main message frame is `261:4652`, attachment-menu frame `266:5518`, and historical-preview frame `266:5902`.

- Keep only Interact and Comment in the top switch. Comment opens a 312 px conversation rail, with the canvas beginning at x=344 on desktop.
- The Select/Area/Arrow toolbar uses unmodified Figma SVG exports in `assets/comment-tool-{select,area,arrow}.svg` from `23:1842` (icon layers `15:3535`, `20:1403`, `20:1466`), rather than the simplified legacy sprite symbols. Preserve their intrinsic dimensions/insets within 16 px slots; SVG alpha masks inherit the button's dark/white state colour.
- The composer remains at the bottom; messages fill from the bottom and scroll above. **Matt explicitly clarified standard chronological chat order:** user prompt above its reply; newest reply nearest the composer. The drawings' reversed timestamps/order must not override this decision.
- General prompts and Selection/Area/Arrow feedback share the same branch conversation. Keep author identity, timestamps, pale-blue user surfaces, white Dialogue responses, complete final prose and design/file chips. Names and model labels are dynamic; users without avatar uploads use initials.
- While a request is running, its Dialogue avatar reuses the existing `history-wait.svg` animation unchanged, with `history-wait-static.svg` for reduced motion. Keep the same 32 px pale background box and the 16 × 18 px mark at the static avatar's inset (7 px left/top). Retain the animation element through progress updates; completed/failed requests return to the static Dialogue avatar. Do not substitute a new animation.
- Selection, Area and Arrow retain their previous floating input boxes on the canvas, independently of the sidebar draft. Arrow's box remains connected to its starting point; Selection/Area boxes sit beside the selected region. Accepted submission clears the annotation and its box and adds the labelled message to the sidebar. Failed submission retains the annotation for retry. Enter sends; Shift+Enter inserts a line. Closing or changing tool/mode discards only the unsent annotation.
- The composer expands for multiline prompts (Enter sends, Shift+Enter inserts a line). The + menu supports bounded text/code/image files and Figma design links. Full replies render safe Markdown/code without exposing raw tool output or reasoning. In-progress work shows bounded status, with Stop available; scroll position is preserved while reading older messages.
- Response lists are rendered as semantic numbered/bulleted lists by `js/reply-markdown.mjs`, independently of OMP. Lists use 20 px line height (ordinary prose remains 16 px), a 6 px gap between items and an 8 px list inset plus 18 px marker gutter. Wrapped lines align with item text; nested lists, starting numbers and fenced code are preserved. Raw HTML remains escaped. Existing recorded replies receive the same rendering on refresh.
- The message textarea shows focus through its native blinking text caret only, without a blue outline or focus shadow, for both pointer and keyboard focus.
- Match the left-aligned attachment menu in `266:5518` (icon inset 16 px, 8 px icon/text gap). The + button and model label show a rounded `#f8f8f8` background on hover or keyboard focus; the model label links to and focuses Settings' model selector. User and Dialogue message headers both have a 12 px gap before their body, matching the avatar/badge-to-first-line spacing in `261:4748` and `264:5048`.
- Matt chose **inference from the message** for discussion versus requested edits. Do not introduce a discussion/edit mode toggle. Questions should be answered without edits; explicit requests can change files.
- Only a successful turn with an actual snapshot receives **View build**. Confirmed saved versions also remain accessible through Dialogue's saved-version messages, including versions without an attributed prompt. This button changes the canvas in place, not the conversation or working files. A green **Viewing build [name]** indicator, with its close action, returns to the current build. Historical previews are read-only; retain unsent composer text while they are open.
- **Save a version** now sits immediately before Share in the top-right toolbar (`266:6238`). It retains the existing explicit publication flow and Saving/Saved/error behavior. **Reload** is a 24 px icon control beside Grid at the canvas's top-left. These controls no longer live in Activity cards.

The earlier three-mode switch, terminal styling and card-to-preview sections below describe the superseded interface. They remain historical reference, not the current workspace implementation. The isolated worker boundary remains required; this UI work does not authorize deployment.

## Figma attachment inputs

The [Figma connection section](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=145-3744) defines two request-scoped attachment surfaces. The second field in **Create a prototype** turns a pasted design/file link into a Figma-icon chip with a shortened filename and remove control (`Create prototype from empty 3`). In the comment composer, pasting a link anywhere in the message extracts it into the same removable chip below the remaining prose (`Comment with Figma link`). The chip is a design reference attached to that request, not inline text or an automatically saved project-wide file.

## Typography

Primary UI typeface: Inter Tight. The history-card request and summary use Inter at 12 px / 16 px, while badge/time metadata use Inter Tight at 10 px / 16 px. Both are bundled as local web fonts in `assets/fonts/` and declared in `css/dialogue.css` (Inter includes its real italic face); the terminal panel chrome also uses Inter Tight. The `omp` text grid uses Space Mono (see Terminal styling below).

Use the actual intended weights rather than browser-synthesized approximations. For example, SemiBold should be `font-weight: 600`.

The browser prototype uses `font-synthesis: none` to avoid synthetic weights.

## Breadcrumbs

Figma uses the rightwards arrow character conceptually (`U+2192`, `→`). A font subset can omit that glyph and trigger a fallback font, so the current prototype renders the separator as a small inline SVG vector for visual consistency.

Breadcrumb links remain un-underlined; hover/focus/active states use colour changes.

## Main sidebar states

Projects, Design systems and Settings use `#9ea39e` for both label and icon by default, changing together to `#6b6b6b` on pointer hover or keyboard focus. The selected destination stays `#171717` with its existing selected background, including on hover. This follows the hover variants referenced by the [first prototype frame](https://www.figma.com/proto/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=1-455): Projects `1:185` and Settings `1:207`. Hover changes colour only, without scaling or adding a background.

The shared styles use the existing 32 × 32 local SVGs as masks inheriting the link's colour; the default and selected SVG geometry is identical. This preserves the original artwork and keeps icon/label states synchronized across Projects, project detail, Design systems and Settings. The compact sidebar retains the icons while hiding the text labels.

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

The project page displays branch cards without a visible **Branches** heading or count; their section retains an accessible label. When non-empty, a **Tags** group follows. Their visual styling follows the [project gallery](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=15-835), including card `15:845`: 320 × 280 px, 16 px outer corners, a 208 px preview and a 72 px `#f8f8f8` footer. The name uses bundled Inter Tight SemiBold at 14 px / 17 px in `#171717`; the date uses Inter Tight Medium at 12 px / 15 px in `#9ea39e`, with a 5 px gap. The footer has 16 px horizontal padding and 18 px top padding; the existing padded 32 px meatball asset sits 16 px from the right and 20 px from the bottom. Desktop surface padding is 40 px. The first card row starts 40 px below the white surface's top, matching the Projects view; the empty-state panel contributes spacing only when visible.

The yellow `#ccff00` badge has 8 px corners, sits 8 px from the top and left, and uses 12 px SemiBold text in a 24 px height. Its current **Open** label means a persistent local Git working copy exists; it does not mean an editor is present, a preview is running, or a branch is unmerged. The tooltip explains this distinction. This functional status differs from the design's sample **New** label.

Matt's subsequent direction (2026-10-21) is to replace **Open** with a user badge/avatar identifying who is working on the app, website or prototype. This belongs to the unit-first gallery and requires actual account/session editing state. Do not infer the active user from commit authorship or the existence of a working copy. Last-editor attribution should be separately labelled; exact badge artwork and placement still need design.

The card face has only the name and a **Saved** timestamp derived from the last commit, rather than claiming to know the last unsaved edit. The independent details control preserves the full ref name, commit hash/message, commit time and working-copy status. It opens without navigating, closes on outside click or Escape, and allows only one panel open at a time. A failed fetch renders as a one-line note above the grid.

This is functional UI. When Matt designs how projects, branches and history are presented, the Figma design supersedes it.

### Git workspace

The [top-switch design](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=186-3391) and [prototype starting in Interact](https://www.figma.com/proto/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=185-4570&p=f&viewport=-12738%2C15777%2C1&t=RT5Qi83PSaW9F77I-1&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=185%3A4570&page-id=0%3A1) define three mutually exclusive workspace modes. **Interact** shows the prototype across the full canvas. **Comment** opens the Activity rail and the Select / Area / Arrow tools. **LLM terminal** replaces Activity with the on-demand `omp` terminal in the left rail and hides annotation tools. The prototype remains in place as the canvas narrows. Switching away hides, but does not restart, the terminal session; read-only tag/commit workspaces have no terminal mode. The terminal switch icon is exported from the Figma component in grey and white variants.

The [switch-state components](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=142-4283) keep each segment at 112×32 px: no hover scaling or hover background. Unselected text and icon change from `#9ea39e` to `#6b6b6b` on hover; the selected segment stays `#323232` with white text and icon even when hovered. Hover icon SVGs are exported from the Figma variants; other Dialogue buttons retain their own scale interactions.

The [history-card board](https://www.figma.com/design/YXlBjYhWIS1sfu8cffH5un/Dialogue?node-id=207-4644) defines **Working** during an agent request, **Created** for the initial build request, **Edited** for a comment that changed the build, **Commented** for a successful no-change comment, and **Vn** after publishing a numbered version. The initial request remains Created in history; the stray Prompt label on an earlier board iteration was removed. Failed runs stay distinct from Commented. Each completed request shows its truncated prompt/comment, a short final agent summary, the selected model's icon or identifiable fallback, and a friendly timestamp; Working omits the time and shows one short live detail in a grey status strip. The transition briefly replaces that detail with the exported tick glyph and **Task completed**.

The current build uses a green `#17b239` tag; previous states use dark `#171717` at 80% opacity, or a blue `#426bc9` tag at full opacity when selected for read-only preview. A no-change Commented card does not create a preview or displace the current build. Selecting the current draft with publishable changes expands **Cancel** and **Save a version**; during publication the button reads **Saving…**. Only a confirmed remote save changes the card to **Vn**, briefly displays disabled **Saved a version** controls, and automatically closes the accordion. Prior Edited snapshots remain local and reopenable. If the current worktree or published version does not exactly match an agent snapshot, a generic Draft or Version card avoids attributing manual changes to a comment. Direct terminal turns retain separate Activity cards.

Selecting a historical card keeps the workspace on **Comment** while showing its read-only preview; **Interact** remains a manual choice. The current-build card links back to the live branch from a historical preview, also in Comment mode. Blue indicates only a selected historical build; returning to the live current build restores its green tag (including a published Vn), rather than opening that card as another historical snapshot.

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

Branch and tag tiles use runtime screenshots of their commits. When a commit has no screenshot, the server may return the default-branch image, labelled **from main** on the card. That label describes the image source, not branch ancestry or merge status. Empty or failed screenshots show the existing empty-preview state.

## Prototype tile clipping

Rounded tile surfaces should keep radius/clipping on a dedicated inner surface, while scale/shadow transforms are applied to the outer wrapper. This avoids Safari/WebKit anti-aliasing seams and grey edge artifacts during scaling.

## Public Share shell

The prototype public Share shell is intentionally minimal and HTML/CSS-only. Do not add JavaScript to that shell unless the product/design decision changes.

## Fidelity principle

When implementation and screenshots differ, use Figma measurements/assets/typography as the primary visual reference.

Avoid inventing missing product UI unless a temporary interaction is specifically needed to prove functionality. Any such temporary UI must be clearly documented as temporary, as with the current branch/tag tiles and split-screen workspace.

## Account screens (2026-10-21)

The accounts branch adds functional passkey/email-code sign-in, account/member settings and explicit local development identity buttons using the bundled fonts and existing Dialogue colours. These are temporary functional surfaces awaiting dedicated Figma designs; implementation does not establish a new visual source of truth. The unit gallery and live user badges remain separate design work.
