# Prototype feedback UI - review branch

Status: first review build, not merged into main. Branch: `feature/prototype-feedback-ui`.

This is the Figma-driven UI track, separate from the easier LLM connection being developed by Matt's colleague. The current app's import/storage/MCP pipeline is retained. No new provider integration is claimed.

Design source: Dialogue Figma file `YXlBjYhWIS1sfu8cffH5un`, section `1:283`; viewer `16:2255`, grid-on `26:4944`, settings `15:2536`.

## Implemented surfaces

- Prototype Test/Comment switch, Select/Area/Arrow tools, anchored composer, activity/history rail, and explicit Load/Cancel for history navigation.
- Only Reload and Share at the top right. Grid control is 24px, inside the canvas at its top left.
- Reload's arrow is green when a later revision/labelled demo result is available. Without an update, Reload restarts the currently loaded prototype. `R` is supported outside editable fields.
- A version badge names the OUTPUT of a completed request, never its base. Pending/failed requests have status labels rather than invented output versions.
- Rewinding scrolls the active card to the top. Chronological order is retained; newer cards remain above the viewport and can be scrolled back into view. Loading is explicit, not triggered by clicking a card alone.
- Grid colour, point size and opacity preferences in Settings; defaults `#BAE6FF`, 8 design pixels, 50%. Here "pt" is the design-system spacing label, not the browser's typographic `pt` unit.
- Grid origin follows the prototype UI's top-left; grid spacing scales with the preview. It overlays the canvas without capturing pointer input.
- Shared hover rules: <=24px controls scale to 110%; normal >=32px controls scale to 105%; 100ms ease-out in both directions. Intermediate sizes use the normal 105% rule. Reduced-motion preference disables the scale animation.
- Design systems navigation and its empty-state placeholder. Import is explicitly disabled pending the later design-system milestone.
- Projects read the real project list. Empty and connection-error states are distinct. `projects.html?empty=1` previews the empty design without changing data. Existing New Project/Profile UI remains prototype-only; project creation is clearly labelled as not saved.
- Local Share dialog copies a local revision link only. It does not claim public sharing or project-wide permission changes.

## What is real and what is simulated

Real: reading saved revisions, loading them in the existing sandbox, resetting their runtime state, annotation coordinates/element metadata, history navigation, preference storage and import behavior.

Simulated: LLM acceptance/work/results. `MockReviewAdapter` creates labelled `Demo N` outcomes which replay the unchanged base revision. It never calls a provider, posts to the import API, changes `.dialogue-data`, or edits prototype files. The explicit "Simulated connection" control also allows testing a connection failure. Retry and cancellation preserve the request text.

Simulation requests live in browser localStorage, scoped to the prototype ID, with a 100-request limit. They are not server-side, team-shared or production task records. Interrupted requests are marked failed on reopening. A provider adapter must replace this simulation before real feedback execution is advertised.

## Integration boundary

`js/review-adapter.mjs` is the replacement point. The viewer consumes:

- `createRequest({base, feedback, anchor, scenario})` (`scenario` is simulation-only)
- `subscribe(listener)`, `listRequests()`, `listRevisions()`
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

Designer review: stop existing Dialogue/tunnel processes, switch the SAME checkout to this branch, then use `Start Dialogue.command`. A tunnel is not required for this simulated feedback UI. Open an existing revision, switch to Comment, try each annotation type and submit. A demo result should leave the current prototype visible until Reload. Rewind via a history card, then scroll upward to retrieve newer versions. Check Settings, grid registration, and the failure/retry controls.

## Remaining before merge

- Matt/Saori review of the real browser interactions and Figma fidelity.
- Final empty-state illustration pass: layouts currently use line-icon placeholders, not the clay raster illustrations. Core Reload/Share/Grid/Dialogue icons use exported Figma geometry; other small utility icons are provisional.
- End-to-end Safari/Chromium checks, including actual Landline selectors, nested scrolling, viewport resizing, keyboard access and draft handling.
- Easier live LLM connector integration; real request persistence/progress and publishing are not implemented by the mock.
- Design-system import, public sharing, team permissions and production authentication remain deferred.
