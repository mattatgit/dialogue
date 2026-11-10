# Project/build and guided import: Build → Setup, 10 November 2026

This is a reviewable application slice on `codex/build-guided-import`, stacked on `codex/managed-execution`/PR12. **No deployment is authorized by this handoff.** Setup owns guarded native validation, infrastructure backup changes and any later approved activation. Production is the previously accepted `e801b0daa593eef8b559048948487dc91553d155`, deployed9 November16:28 Melbourne. Preserve production data, profiles, private environment and current release pointer.

## Product behavior and limits

Projects can be empty named containers. Their gallery has one card per stable build, labelled Web/macOS/iOS/NixOS. A build contains its branches, working copies, conversation and versions. Repository connections are independent of names/identities; several sources may feed one project and several builds may share a source/root. Both import entry points use the same persisted workflow. Create build supports a prompt, uploaded files and an existing Figma reference. Nothing automatically creates a remote repository or pushes scaffolding.

Assessment fetches/checks out a pinned source commit, then starts actual OMP in an empty CWD outside the source. The source is separately mounted read-only; explicit extension hooks clamp read/grep/glob and block other tools, private paths and escapes. Discovery of project tools/extensions/rules/skills/LSP is disabled. Pinned OMP18.2.10 can re-add write after CLI `--tools`, so the CLI flag alone is insufficient. Source-controlled project scripts, installs and edits require explicit plan confirmation, not merely an assessment prompt.

The editable proposal records targets, roots, source/destination branches, approach/simulations, limitations and a representative safe UI check. Confirmation is bound to the current plan digest and source SHA. Remote source advancement before confirmation requires reassessment; it never silently rebases retained work. Native targets remain honestly unsupported. Web preparation is an ordinary branch agent request and uses Dialogue's managed runner, installer and browser after releasing the agent reservation. A real button click plus expected rendered text is required for “UI verified”; missing checks/tools yield “configured”, with outstanding validation. An edited/failed editing request invalidates the prior verification. The check records branch/tree/date; it does not validate hardware, Bluetooth, machine/scale data, iCloud or iOS packaging.

The first UI is deliberately rough and uses existing Dialogue components. It is for Matt's flow review and later design polish. Initial imports are GitHub-only. Remote creation for local builds, a merge UI, platform workers, arbitrary folder/ZIP import and a cross-platform synchronization engine are separate work.

## Storage, migration and publication

| State | Layout / preservation rule |
| --- | --- |
| Existing Git engine | `db.json` remains schema4. Existing mirrors, worktrees, refs/tags, recipes, keys, accounts, profiles, sessions and original file paths remain untouched. |
| Product catalog | `catalog.json` schema1 stores stable `project-*`, `source-*`, `build-*`, `import-*` identities, plans, status, source SHA, approval, attempts and per-build recipe fallback. Atomic writes and serialized logical mutations; corrupt/unknown stores fail closed. |
| Legacy mapping | Exactly one project and compatible Web build per old repository record. Deterministic IDs, original `storageSlug`, `.dialogue/preview.json` and all branches/history retained. Repeat startup/migration does not duplicate records or move Git metadata. `project.html?slug=<old-slug>` and old workspace URLs still resolve. |
| New import inspection | `repos/import-*.git` and `workspaces/import-*/<source-sha>/`, with durable branch-hashed request/session/attachment data. No product build exists until confirmation. Inspection adapters are **not** added to `db.json` or ordinary editable workspace APIs. |
| New build engine | Each build owns `repos/build-*.git` and `workspaces/build-*/<encoded-ref>/`. Adapters are synthesized from catalog, not inserted into legacy DB. Shared source connection/key does not mean shared mutable checkout. |
| Per-build recipe | `.dialogue/builds/<build-id>/preview.json`, with private catalog fallback for branches predating that file. Legacy recipe remains unchanged. |
| Local create publication | `local-origins/<build-id>.git` is a separate bare local origin. `setup/<build-id>/seed` bootstraps it. Save a version commits/pushes only to this local origin, with ordinary numbered tags; no remote GitHub destination is created. |
| Retained inputs | `build-inputs/<build-id>.json` and `import-inputs/<import-id>/<uuid>.json` retain prompt/design/upload originals privately for retry. Do not serve these directories as static files. |
| Context and evidence | Existing `requests/` records, `.sessions`, `.attachments` now include durable `figma-design.json` snapshots and inherited import references. Old source-revision discussions are retained. `workers/records` includes project/build/import/request/workspace attribution and separate source/CWD. UI evidence is under `workers/ui-checks/<uuid>/verified.png`. |

Build workers may edit shared paths across their own **whole repository checkout**; an application root is a preview root, not a write sandbox. Independent mirrors/copies prevent publishing another build's pending files. Git publication is still a whole branch, including shared files, with existing trusted atomic push/force-with-lease and tag conflict checks. A second build publishing to the same destination may encounter a retained safe conflict; this slice does not merge it. No project-wide editing lock is introduced. Guided preparation reserves the actual copy; ordinary workspace mutations are blocked while it is preparing/validating.

Failed/cancelled/interrupted imports retain source, plans, original inputs, sessions and partial edits. Retry uses the same IDs/copy and never force-resets it. Revising an approach/root/name/target requires fresh confirmation; once copies exist, source/destination branches and selected-build identity cannot silently be replaced. Continue in the build conversation, or start a separate import for a different source/selection. Changing to a newer source after an existing preparation is not an automatic merge/rebase operation.

## Backup and rollback gates

Back up the **entire canonical application data root**, SQLite consistently, plus existing infrastructure/private environment under the established encrypted procedure. In particular include `catalog.json`, `local-origins/`, retained inputs and existing Git/request/key/member state. Preserve absolute Git links and local-origin remote paths; restore at original paths or explicitly repair/verify links and origins. Original project worktrees must never be copied to an arbitrary new data root.

Setup reports its backup helper currently discovers Git validators only under `repos/*.git`. **Before production use, extend its recovery discovery and fixtures to `local-origins/*.git`.** Prove local-only Version tag recovery, catalog identity/source mappings, interrupted attempt recovery, per-build recipes, native session/attachment/design continuation and unpublished edits at canonical paths. Merely including files in an archive is not recovery acceptance. Keep regular OMP state; exclude only transient sockets according to the existing tested policy. This application branch does not change the host backup helper.

Before any later activation: stop/drain jobs using the existing guarded procedure; preserve logs/evidence; take the required fresh consistent encrypted snapshot and prove recovery; pin/hash source and dependencies. Do not run separate admission pools concurrently in the shared production worker slice. Native staging must restore e801b0d traffic in a failure-safe finally path and must not change the production pointer.

**Source rollback:** stop the candidate and its scopes, restore the prior root-owned e801b0d release/environment and restart. No old worktree/DB rename is needed. e801b0d ignores the additive catalog and new adapters (they are not legacy DB records), so old projects remain available. New projects/builds are hidden in old UI; retain all new catalog/data for forward recovery. Do not delete new state to make rollback appear complete. A point-in-time data rollback must restore the entire consistent matching snapshot and explicitly account for work after it; never combine old catalog with newer mirrors/sessions. Rollback/restore remains Setup's operation.

## Validation and unchanged host contract

Local full suite: **185 tests, zero failed/cancelled/skipped**. Coverage includes authenticated HTTP and actual browser entry flows, prompt/file creation, local Version publication, source/plan consent, multi-source identity and same-source separate builds, conflicting publication, repeat migration, retained bytes/keys/sessions/attachments, corrupt-store failure, source advancement/reassessment, revised-plan copy preservation, connecting cancellation and native tool-hook policy. Figma snapshot retention uses disposable API data; no personal token or sign-in email is used.

Actual pinned OMP18.2.10 + source-only Deui `c3396e14ed2e7193b71b2a92df710a615c18e8be` passed all10 guided-flow checks locally, including restricted reads, **actual attempted write/edit/project script/install rejection**, Show → Pressure, rendered UI edit, manager reload/member-home conversation continuation, local-only V1, branch grouping and cancellation. Retained local report: `/private/tmp/dialogue-import-checks/build-import-ZZFLEm/report.json`. The fixture adds explicitly recorded project/tool/install canaries to a disposable local source; it never pushes to real Deui. The provider is scripted/local, the OMP/runtime/Git/UI are real. macOS direct mode proves workflow functionality only.

Setup must test the exact committed SHA and expected count from its pinned root-owned staged source/dependencies, using its existing disposable guarded service and production namespace/slice/tool policy:

1. Full `npm test`:185 passing, no skipped/failed/cancelled. Verify actual executable/CWD/hash manifest, not a test against an older release.
2. `npm run check:workers`: **ALL LINUX WORKER CHECKS PASSED**, including empty read-only execution CWD + separate selected source mount, cross-project/private-data denial, native continuation, listener denial, OOM/cancel/cleanup/task/browser boundaries. A benign inspection or advertised tool list alone is not the adversarial import gate.
3. `node scripts/check-build-import.js`: provide a source-only pinned Deui directory through `DIALOGUE_DEUI_SOURCE` and a fresh disposable `/srv/dialogue/checks/...` base through `DIALOGUE_ACCEPTANCE_ROOT`. Require10 checks, `native:true`, `workflowAccepted:true`, `accepted:true`, actual rejected write/edit/script/install results, unchanged source canaries and measured agent/install/preview/browser whole-tree peaks. It uses the production GuidedImports, WorkspaceRequests and UI verifier, real OMP and actual browser interactions. Local fixtures/providers only; no real member credentials or remote publication.
4. `node scripts/check-deui.js` with the same isolated fixture policy: rerun the existing13 workflow/concurrency checks to cover the changed discussion policy and two-person overlap. Require native/capacity acceptance, recorded complete-tree peaks and cleanup. Preserve both reports and phase timestamps, not just a pass marker.

Retain the **existing measured pilot settings**, without raising limits:

```ini
DIALOGUE_WORKER_PREVIEW_MB=768
DIALOGUE_WORKER_BUDGET_MB=2048
DIALOGUE_WORKER_SLICE_MB=2304
DIALOGUE_WORKER_BROWSER_SECONDS=120
DIALOGUE_SCREENSHOT_TIMEOUT_MS=60000
```

The harness may use `DIALOGUE_ACCEPTANCE_UI_TIMEOUT_MS=90000`. Keep native worker parent-unit/tool environment, app512MiB/CPU50/tasks128, slice high/max2048/2304MiB/CPU150/tasks384, child swap0, storage guard and system headroom. Agent/provider1280, install768, browser256, control128; one heavy at a time/two previews/queued second agent with own-preview pause. No new DNS, SMTP, TLS, provider migration, privileged helper or hosting platform is needed. Existing auth/preview capabilities and credentials remain unchanged.

Previously accepted e801b0d observed max slice current2007.1MiB and min host MemAvailable2042.3MiB on3915MiB/no-swap host. These are **historical**, not new-flow capacity measurements. Record fresh individual/slice peaks, actual max slice current and minimum host available by phase, app peak, OOM/timeout/cancellation outcome, remaining storage and empty-scope cleanup for this candidate. The guided flow adds assessment turns and a separate verification browser, so isolation success alone cannot establish capacity. If it fails, preserve evidence and report the failed phase/limits and supported workload before proposing hardware/limit changes. Real-provider quality/latency, Matt/Saori acceptance, physical/native integration and final visual design remain outside scripted acceptance.
