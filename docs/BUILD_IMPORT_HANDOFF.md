# Project/build and guided import: Build → Setup, 10 November 2026

This is a reviewable application slice on `codex/build-guided-import`, stacked on `codex/managed-execution`/PR12. **No deployment is authorized by this handoff.** Setup owns guarded native validation, infrastructure backup changes and any later approved activation. Production is the previously accepted `e801b0daa593eef8b559048948487dc91553d155`, deployed9 November16:28 Melbourne. Preserve production data, profiles, private environment and current release pointer.

## Native acceptance outcome

Accepted **application `bfec90a978cde227e2ac973d8c6d8e8f792d9479`**, [PR13](https://github.com/mattatgit/dialogue/pull/13):187 local and187 actual Linux tests passed, zero failures/cancelled/skipped; updated direct-Node native worker checks passed; all10 guided-import checks and all13 Deui regression/concurrency checks passed. Source/dependencies were root-owned and hash-verified. Nix package passed locally. Documentation-only followups do not change this tested application pin. Existing production e801b0d was restored, with unchanged private environment and empty worker scopes; no activation occurred. Build independently checked hosted health200/private projects401 and local review200.

The successful guided run includes the previously failing verifier → editor handoff, real UI edits, continuing conversation/member-home handoff, local-only Version, grouping and cancellation. Both suites use a scripted local provider and actual native OMP/Git/browser against disposable Deui source, not a personal account or real remote publication. The final concurrency check characterizes the bounded two-person/one-heavy-job policy; it is not arbitrary-project or simultaneous-agent capacity. Existing settings remain unchanged. Setup still owns the new local-origin Git validator/recovery fixture before any later activation.

### Measured capacity and evidence receipt

| Observed complete-tree/current metric | Guided import10 | Deui regression13 |
| --- | ---: | ---: |
| Duration (scripted provider) |80.263s |203.177s |
| Agent peak |1280.0MiB |1280.0MiB |
| Install peak |768.1MiB |768.3MiB |
| Preview peak |768.0MiB |767.5MiB |
| Browser peak |227.0MiB |256.0MiB |
| App peak |73.5MiB |65.4MiB |
| Maximum actual slice current (external100ms samples) |1788.9MiB |1868.4MiB |
| Minimum host MemAvailable (same sampler) |2445.8MiB |2035.7MiB |
| External samples |776 |1964 |

These are separate peak/minimum observations, not simultaneous values to add together. The guided control peak was10.1MiB; the Deui readiness control probe was intentionally signalled and unmeasured (null, not zero demand). Worker-record running minima2446.2/2035.8MiB differ slightly from external samples; retain both provenance. No workload OOM kill occurred. Intentional cancellation/lifecycle stops are separate from the worker gate's intentional OOM containment test. Individual agent/install/preview/browser ceilings were touched: this supports the bounded existing4GB/one-heavy-job pilot, not comfortable uncapped demand, simultaneous-agent or arbitrary-project capacity. No upgrade or limit increase is proposed from these results. Real-provider quality/latency, physical integrations and full hosted member/auth/proxy/HMR review remain outside these scripted checks.

Exact source archive SHA256 `f29e8bf97d6df390a8c119f0a7064b59bc68f14ea227bdb46263857af3c0b911`: all222 tracked files and1458 unchanged Linux dependency files verified. All4 actual units exited0 with PID/executable/CWD proof. Evidence root `/root/dialogue-acceptance/2026-11-10-050254Z-bfec90a-guided/`; verified sealed archive `.tar.gz`, SHA256 `439f3f243d0baf011a73664434052d69dbcc7971cdcba62c9a2c848cefbbda23`,45,749,196bytes/8746 file-link artifacts. It includes raw logs,100ms cgroup/host/CPU/PSI/task samples, executed guard, phase timestamps, source/Git/catalog/plans/sessions/attachments/profile evidence; declared regenerable caches/dependencies/runtime endpoints are omitted with native cache hashes retained. No production private environment is in that archive.

- Guided report `/srv/dialogue/checks/2026-11-10-050254Z-import/build-import-HeZBCL/report.json`, SHA256 `814b9dca7c9acdabf009ccca9feb298d47579cdf3bfc9a70cc1497da77f1885e`: native/workflowAccepted/accepted=true, all10 checks,14 actual read-only rejection results and unchanged canaries.
- Concurrency report `/srv/dialogue/checks/2026-11-10-050254Z-deui/deui-RQHINK/report.json`, SHA256 `55fe61a271ddafa6ee007b35c5ec736c913856f04bd16419edb4577108110202`: native/workflowAccepted/capacityAccepted=true, all13 checks.
- Final host/acceptance receipt `/root/dialogue-acceptance/2026-11-10-bfec90a-final-handoff.json`, SHA256 `199c2d43e7ef11025fa9e01e3153daf378f79ffa39c43ac6fe4052617a6bcdfb`.

Fresh consistent encrypted snapshot `2605cac2bea457b9358bc79a9546b7b2eace0338905d6d6f7ec54198c399d154` passed full isolated restore; reuse required it to remain newest, under1h old, with matching recovery tools/config/policy/private-environment hashes. This restores existing production, not the still-required new catalog/local-origin fixture. After evidence sealing, Setup removed only16 declared regenerable cache directories from completed disposable checks, retaining source/refs/profiles/sessions/reports; data free recovered from2819.9 to7620.6MiB. Production data remained untouched, e801b0d enabled/healthy, private environment byte-identical and worker slice empty. External home/health200, projects401, unknown preview404. No feature activation occurred.

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

Local full suite: **187 tests, zero failed/cancelled/skipped**. Coverage includes authenticated HTTP and actual browser entry flows, prompt/file creation, local Version publication, source/plan consent, multi-source identity and same-source separate builds, conflicting publication, repeat migration, retained bytes/keys/sessions/attachments, corrupt-store failure, source advancement/reassessment, revised-plan copy preservation, connecting cancellation and native tool-hook policy. Figma snapshot retention uses disposable API data; no personal token or sign-in email is used.

Initial Linux progression: exact8c64c0f ran185 tests,184 passed/1 failed, zero skipped/cancelled. The new browser test wrote screenshots under macOS-only `/private/tmp`; its outputs now use the fixture-owned portable temporary directory. Setup retained failure/unit evidence at `/root/dialogue-acceptance/2026-11-10-044505Z-8c64c0f-guided` and restored e801b0d without changing settings. Fresh2605cac2 passed full isolated restore; remaining native gates were not run. A local rerun also exposed a fast-confirmation race, now fixed by atomic assessment/plan/revision state and waiting for final assessment cleanup. The corrected186-test suite passes locally; all four exact-source Linux gates remain required.

Further native progression: a3083d9 passed all186 Linux tests and updated native workers (direct Node). Guided import passed its first5 gates, including actual policy rejections and approved Show → Pressure, then found a release/close/reopen ownership race. RunnerPool now retains complete per-workspace stop promises after removing active entries; close and replacement starts await them. The new delayed-cleanup regression preserves strict single ownership. Failed report: `/srv/dialogue/checks/2026-11-10-045604Z-import/build-import-E9hCYC/report.json`, SHA256285538897766668b3fdb44a0f51cf885964603bc57e3729023c0b33ed4388b51. Agent/install/preview/browser/app peaks1186.1/768.3/719.3/227.1/54.0MiB, no workload OOM. This is not full workflow/capacity acceptance; Setup restored e801b0d and retained all evidence before retry.

Actual pinned OMP18.2.10 + source-only Deui `c3396e14ed2e7193b71b2a92df710a615c18e8be` passed all10 guided-flow checks locally, including restricted reads, **actual attempted write/edit/project script/install rejection**, Show → Pressure, rendered UI edit, manager reload/member-home conversation continuation, local-only V1, branch grouping and cancellation. Retained local report: `/private/tmp/dialogue-import-checks/build-import-LBnD7w/report.json`. The fixture adds explicitly recorded project/tool/install canaries to a disposable local source; it never pushes to real Deui. The provider is scripted/local, the OMP/runtime/Git/UI are real. macOS direct mode proves workflow functionality only.

Setup must test the exact committed SHA and expected count from its pinned root-owned staged source/dependencies, using its existing disposable guarded service and production namespace/slice/tool policy:

1. Full `npm test`:187 passing, no skipped/failed/cancelled. Verify actual executable/CWD/hash manifest, not a test against an older release.
2. Run the `check:workers` payload directly: `<trusted-node> <staged-release>/scripts/check-workers.js` as the configured service MainPID, **not** through npm as the service process. `Workers.assertReady` deliberately verifies MainPID equals Node; do not weaken that protection for a wrapper. Require **ALL LINUX WORKER CHECKS PASSED**, including empty read-only execution CWD + separate selected source mount, cross-project/private-data denial, native continuation, listener denial, OOM/cancel/cleanup/task/browser boundaries. A benign inspection or advertised tool list alone is not the adversarial import gate.
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
