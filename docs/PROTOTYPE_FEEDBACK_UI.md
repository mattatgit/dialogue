# Prototype feedback UI - review branch

Status: first review build, not merged into main. Branch: `feature/prototype-feedback-ui`.

This is the Figma-driven UI track, separate from the easier LLM connection being developed by Matt's colleague. The current app's import/storage/MCP pipeline is retained. No new provider integration is claimed.

Design source: Dialogue Figma file `YXlBjYhWIS1sfu8cffH5un`, section `1:283`; viewer `16:2255`, arrow-comment reference `16:3477`, updated mode switch/comment components `33:3592`, Draft → Version prototype `51:3452`, grid-on `26:4944`, settings `15:2536`.

## Implemented surfaces

- Prototype Interact/Comment switch, Select/Area/Arrow tools, anchored composer, and Activity/history rail with direct navigation between every successful checkpoint.
- The Interact/Comment switch matches Figma node `33:3592`: 200×48px overall, 8px outer padding, two equal 88×32px segments separated by 8px, with 6px between each 12px icon and label. It uses the exact exported Figma switch icons: `interact-grey.svg`, `interact-white.svg`, `comment-grey.svg`, and `comment-white.svg`. The user-facing Test label is now **Interact**; the internal mode key remains `test` to avoid unnecessary behavioral churn during this review branch.
- Prototype display is clipped to the measured UI root (including its reported corner radii), so an imported page's outer backdrop/gutter is not presented as part of the prototype. The bridge prefers an explicit `data-dialogue-root`; for Landline it recognizes the actual `.stage > .landline` structure and selects `.landline` before the generic full-page `main.stage` wrapper.
- Arrow starts are canvas-wide rather than prototype-bounded: press where the comment should connect, drag to the target, release to place the arrowhead. The comment composer sits at the start point with the Figma-style red terminal ball. Select and Area remain bounded to the prototype viewport.
- Comment composer states follow Figma node `33:3592`: Default = Dust border; Focused / Typing = Summer Sky border. New comments keep the existing autofocus behavior, so they normally open Focused; empty blur returns Default and entered text is Typing.
- Comment close states use exact exported SVGs: transparent + Granite X by default, Dust + Main Text X on hover/focus, Cloud + Main Text X while clicked.
- Unsent comments are deliberately disposable: closing the composer or leaving the current comment flow discards draft text without a browser confirmation. The submit control has no native hover tooltip; its Figma label is **Send**, while the Enter key remains the submit shortcut.
- Send button states use exact exported SVGs and the Figma prototype timings: Default small Granite icon; Hover after 50ms ease-out = 32×24 Dust background plus larger Main Text icon; after 300ms dwell, Long hover expands to 69×24 and reveals “Send” over 100ms ease-out; Clicked uses Cloud with the full label/icon state. Mouse leave returns over 50ms ease-out.
- Interact/Comment switching keeps the top mode control and prototype fixed in screen space. Comment mode makes room for history by shrinking the white canvas from the left rather than recentring the prototype; the canvas transition is 100ms ease-out (and respects reduced-motion). The Comment toolbar is positioned from the measured prototype centre rather than the resized canvas centre, so it remains directly underneath the prototype.
- Only Restart and Share at the top right. Grid control is 24px, inside the canvas at its top left. Restart resets the currently viewed prototype state to its initial runtime state; `R` is supported outside editable fields.
- Successful simulated outputs use Activity semantics rather than an automatic version number: newest unsaved output = **Draft**, earlier unsaved checkpoints = **Edited**, explicit save = numbered **Vn**. Pending/failed requests retain status labels.
- Every successful Activity card is directly navigable by click. Rewinding is non-destructive: newer cards remain above in chronological order, and clicking the Draft returns to the latest working state.
- When the current Draft is already being viewed, clicking its card expands it from 256px to 304px and reveals **Cancel** + **Save version**. Cancel collapses without changing state. Save shows **Saved version** for 2 seconds, then promotes that same card to the next numbered Version and collapses it.
- Grid colour, point size and opacity preferences in Settings; defaults `#BAE6FF`, 8 design pixels, 50%. Here "pt" is the design-system spacing label, not the browser's typographic `pt` unit.
- Grid origin follows the prototype UI's top-left; grid spacing scales with the preview. It overlays the canvas without capturing pointer input.
- Shared hover rules: <=24px controls scale to 110%; normal >=32px controls scale to 105%; 100ms ease-out in both directions. Intermediate sizes use the normal 105% rule. Reduced-motion preference disables the scale animation.
- Design systems navigation and its empty-state placeholder. Import is explicitly disabled pending the later design-system milestone.
- Projects read the real project list. Empty and connection-error states are distinct. `projects.html?empty=1` previews the empty design without changing data. Existing New Project/Profile UI remains prototype-only; project creation is clearly labelled as not saved.
- Local Share dialog copies a local revision link only. It does not claim public sharing or project-wide permission changes.

## What is real and what is simulated

Real: reading saved revisions, loading them in the existing sandbox, resetting their runtime state, annotation coordinates/element metadata, history navigation, preference storage and import behavior.

Simulated: LLM acceptance/work/results. `MockReviewAdapter` creates browser-local Draft/Edited checkpoints which replay the unchanged base revision; its Save version action promotes the current Draft to a simulated numbered Version without writing project files or server data. It never calls a provider, posts to the import API, changes `.dialogue-data`, or edits prototype files. The explicit "Simulated connection" control also allows testing a connection failure. Retry and cancellation preserve the request text.

Simulation requests live in browser localStorage, scoped to the prototype ID, with a 100-request limit. They are not server-side, team-shared or production task records. Interrupted requests are marked failed on reopening. A provider adapter must replace this simulation before real feedback execution is advertised.

## Integration boundary

`js/review-adapter.mjs` is the replacement point. The viewer consumes:

- `createRequest({base, feedback, anchor, scenario})` (`scenario` is simulation-only)
- `subscribe(listener)`, `listRequests()`, `listRevisions()`, `saveVersion(resultId, version)`
- `isBusy`, `cancel(requestId)`, `retry(requestId)`, `dispose()`

A request records its ID, timestamp, base revision, feedback, typed anchor, lifecycle status, normalized activity events, optional result revision, and error. Events have IDs, types, timestamps and human-readable messages. A real adapter must expose only observed activity and real completed outputs; do not fabricate tool logs or summaries.

Anchors include the source revision ID, viewport, coordinate space and UI origin. Selection adds a bounded selector/tag/text snippet; Area stores a rectangle; Arrow stores endpoints. Screenshot capture, code-source mapping and reliable selection inside nested/cross-origin frames or canvas content are not included yet. Use Area/Arrow when element inspection is unavailable.

Before integrating the colleague's connector, agree on task initiation, progress/error delivery, cancellation semantics, and output-revision correlation. This branch does not assume that an MCP server can initiate arbitrary work in a hosted chat application.

## Sandboxed selection and data safety

The iframe keeps its existing sandbox flags; `allow-same-origin` has NOT been added. The server injects a small inspection script only into HTML responses carrying a validated, per-load `reviewChannel`. Injection happens in the response buffer, not in the stored revision files. Relative assets retain their original URLs.

The child reports layout/selection via postMessage. Parent checks the iframe window, per-load channel and bounded payloads; child checks the parent window/origin/channel. These checks correlate messages, not authenticate untrusted prototype code. No message from a prototype can publish a revision or start a provider request: a user must submit the parent-owned form.

Prefer an explicit `data-dialogue-root` on the prototype UI wrapper for accurate grid registration. Otherwise the bridge tries common app roots, the sole visible body child, then viewport origin. A restrictive prototype CSP can disable inspection; Area/Arrow remain usable. The legacy 370x722 iframe viewport is preserved; generalized viewport/zoom controls remain future work.

No migration, reset, re-import, or cleanup of runtime data is performed by this branch. Existing metadata backup and revision manifest behavior is unchanged.

## Tests and review

Run the dependency-free checks with Node 22+ and the existing zip/unzip tools:

```sh
node --test tests/review-model.test.mjs tests/review-server.test.mjs
```

Twelve checks passed in the implementation environment: grid geometry/defaults/bounds, rectangle/selection validation, decimal revision ordering, simulation success/failure/retry/cancel/storage handling, plus real isolated HTTP import, response-only instrumentation, manifest/backup creation, duplicate rejection, restart persistence and missing-metadata refusal. All HTTP tests use disposable server copies, never a developer's actual `.dialogue-data`.

An optional Playwright browser smoke test is in `tests/review-browser.py`. It requires Python Playwright and a Chromium executable (`CHROMIUM_PATH`). It was NOT completed end-to-end in this environment: browser network navigation is administratively blocked. An offline visual check of the viewer shell was rendered at 1440x1024, including its 110% grid-button hover. Safari testing against the real imported prototype is still required.

Designer review: stop existing Dialogue/tunnel processes, switch the SAME checkout to this branch, then use `Start Dialogue.command`. A tunnel is not required for this simulated feedback UI. Open an existing revision, switch to Comment, try each annotation type and submit. A successful simulated result should appear directly as the current Draft. Click older cards to navigate, click Draft to return, click the active Draft again to test Cancel / Save version / Saved version promotion, and use Restart to reset runtime state. Check Settings, grid registration, and the failure/retry controls.

## Figma asset preflight

Before any future build or fidelity pass sourced from Figma, first re-check the target Figma node and verify the intended SVG/PNG assets are exportable. Do not assume asset export settings from an earlier session are still complete.

Re-checked 2026-09-24: the Folder and Suitcase clay empty-state illustrations are now available as PNG exports; Dialogue, Grid, Share and Reload expose SVG exports. The current first-review commit was created before those exports were available, so its line-icon empty-state placeholders remain a known fidelity gap to replace/verify after the first local interaction review.

## Activity timeline / version model

For the intended post-simulation integration, Activity remains both the work log and the primary non-destructive navigation surface. Every successful agent step is navigable, but only explicit saves become numbered versions.

- **Draft** badge: the newest unsaved working state.
- **Edited** badge: an intermediate successful activity checkpoint that can be revisited without being promoted to a saved version.
- **Vn** badge: an explicitly saved version/checkpoint.
- Draft, Edited and Version cards all use consistent friendly timestamps.
- Browsing an Edited checkpoint or older Version must not destroy or silently replace the current Draft.
- Default cards should use a consistent fixed height for easier scanning. Overflowing content is truncated at rest and expands on hover.
- The top-right control is now **Restart**, which resets/restarts the currently viewed prototype state; successful simulated Draft changes appear directly without requiring Reload.
- Saori's Figma prototype at `51:3452` defines the implemented save flow: current Draft click → expanded Cancel / Save version; Cancel returns to Draft; Save version → Saved version confirmation for 2 seconds → same card becomes the next numbered Version.

## Remaining before merge

- Matt/Saori review of the real browser interactions and Figma fidelity.
- Final empty-state illustration pass: layouts currently use line-icon placeholders, not the clay raster illustrations. Core Reload/Share/Grid/Dialogue icons use exported Figma geometry; other small utility icons are provisional.
- End-to-end Safari/Chromium checks, including actual Landline selectors, nested scrolling, viewport resizing, keyboard access and draft handling.
- Easier live LLM connector integration; real request persistence/progress and publishing are not implemented by the mock.
- Design-system import, public sharing, team permissions and production authentication remain deferred.
