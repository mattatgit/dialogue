# Hosted Deui execution: accepted application and Setup handoff — 9 November 2026

Application owner: Dialogue Build. Host/settings, evidence retention, staged tests and rollback: Setup & install. **Accepted application: `e801b0daa593eef8b559048948487dc91553d155`**, branch `codex/managed-execution`, [PR #12](https://github.com/mattatgit/dialogue/pull/12), stacked on #11. Documentation-only commits after this SHA do not change tested application code. **Not deployed:** current live release stays `a516d7a0eab6dc897f699759d5d288c102245e2d`. Existing production data, provider profiles and project refs remain untouched. Setup owns any subsequent activation.

## Accepted settings and capacity

The exact source passed **168 local tests, 168 Linux tests (zero failed/cancelled/skipped), ALL LINUX WORKER CHECKS PASSED, and all 13 actual Deui workflow checks**. Nix packaging passed locally. Setup verified all201 staged tracked file hashes against the source archive, SHA256 `38ee3450784257716c8a1e9d58c658aa6c23cc6e3b267ade544fe3c54e8cf66e`. Native checks used production isolation/tools in disposable services, without production credentials. Deui source was pinned to `c3396e14ed2e7193b71b2a92df710a615c18e8be`.

Required host environment for this Deui policy:

```ini
DIALOGUE_WORKER_PREVIEW_MB=768
DIALOGUE_WORKER_BUDGET_MB=2048
DIALOGUE_WORKER_SLICE_MB=2304
DIALOGUE_WORKER_BROWSER_SECONDS=120
DIALOGUE_SCREENSHOT_TIMEOUT_MS=60000
```

`DIALOGUE_ACCEPTANCE_UI_TIMEOUT_MS=90000` was used by the acceptance harness only. It is not a production UI setting. Generic code defaults remain256 MiB preview,20s screenshot and40s browser; those values are **not** the accepted Deui configuration. Screenshot deadlines must leave at least5s within the browser lifetime.

| Boundary | Required tested policy |
| --- | --- |
| Agent / provider / legacy terminal |1280 MiB per complete worker tree |
| Dependency install |768 MiB |
| Managed preview |768 MiB, maximum two |
| Browser / tiny control |256 /128 MiB |
| Admission / installed worker slice |2048 MiB admission; MemoryHigh2048 / MemoryMax2304 MiB |
| App service |MemoryMax512 MiB, CPU50%, TasksMax128, swap0 |
| Worker slice |CPU150%, TasksMax384, MemorySwapMax256 MiB; every child scope swap0 |
| Scheduling |One shared heavy job (agent/provider/install), browser1, terminal1, control2; queue maximum8/wait60s |
| Host reserve |At least1536 MiB physical capacity outside the worker slice for app/OS/infrastructure |

Preserve existing per-class CPU/task limits, namespace/AppArmor/mount boundaries, bounded storage, low-disk guard, DNS/TLS/origin/auth controls and backup/alert schedule. Worker records must match the installed profile ceilings; raising environment values alone cannot raise the host slice. No privileged helper or new host platform is required.

The supported workload is **two viewed Deui working copies, one native agent at a time with its own preview paused and the other member's preview retained; the second agent queues**.1280+768 exactly fills admission. A browser waits for an agent to leave; two previews plus a browser fit. An unused preview is reclaimed. This is a bounded two-person pilot, not simultaneous AI workers or an arbitrary-framework capacity claim. The queue can return busy after60s; work/source/conversation must survive rejection.

Accepted run04:05:04.474–04:08:30.991 UTC (206.5s), report `/srv/dialogue/checks/capacity/deui-5PvxJ5/report.json`. Its `native`, `workflowAccepted` and `capacityAccepted` flags are true, with13 checks and no error. Evidence root: `/root/dialogue-acceptance/2026-11-09-040503Z-e801b0d-capacity/`.

| Whole-cgroup measurement | Accepted result (MiB) |
| --- | ---: |
| Setup agent maximum kernel memory.peak |1221.1 |
| Later completed agent maximum (8 agent scopes total) |1280.0 |
| Install maximum (3 scopes) |768.1 |
| Preview maximum (12 scopes) |768.0 |
| Later preview restarts without reinstall |446.8 |
| Browser maximum (5 scopes) |247.5 |
| Maximum sampled worker-slice **current** |2007.1 |
| Minimum host MemAvailable (worker-record samples / external series) |2042.3 /2045.0 |
| Physical host RAM / swap |3915 /0 |
| Disposable app/check coordinator peak |66.0 |

These include descendants/cache charged by the kernel, not sums of process RSS.100ms sampling can miss short aggregate peaks; retained long-lived slice peak is not substituted for concurrent demand. The two MemAvailable minima come from separate sampling series. No accepted worker had an OOM kill or task denial. One running agent cancellation, one queued cancellation without dispatch,12 preview stops and a terminated unmeasured readiness probe were deliberate cleanup, not OOM/timeout. Some individual trees reached their caps; installation reclaim/file cache and transient page accounting matter. Do not describe them as having ample individual margin. The coordinator measurement is not a full production-traffic benchmark. The measured workload fits the4 GB host without demonstrating a need for an upgrade; it does not establish capacity for parallel agents or larger projects.

"Cold" here means after a fresh managed dependency install; the harness repeats `npm ci` in setup and the main copy. Kernel file cache was not flushed. Restarts without reinstall had a lower observed preview peak (446.8 MiB); this does not justify lowering its ceiling for the next install. The first thumbnail completed in25.137s, which explains why the earlier20s deadline was insufficient. Interactive browser phases peaked222.6–233.0 MiB; the setup thumbnail peaked247.5 MiB.

| Across all scopes of class | Agent | Install | Preview | Browser |
| --- | ---: | ---: | ---: | ---: |
| Maximum sampled pids |23 |26 |38 |90 |
| CPU usage counters, seconds |17.244 |54.367 |61.014 |9.394 |
| CPU throttled counters, seconds |5.168 |18.883 |124.921 |5.941 |
| Sampled memory.events.max sums |13 |1781 |125 |0 |

CPU counters sum across scopes, not wall-clock wait time. `memory.events.max` indicates pressure/reclaim at a ceiling, not an OOM; all workload OOM/oom_kill counters were zero. Preserve the existing CPU limits: the short test is not a sustained responsiveness guarantee.

Single-run timings: source imported→actual interactive UI97.7s (98.6s from test start); real agent edit→rendered verification18.8s; conversation/member continuation4.2s; local Version publication0.3s; restart→verified UI16.0s. Preparing/interacting with the second copy took45.4s. These include real native OMP, Vite/Node/esbuild and Chrome with a **scripted local model**; actual provider inference latency, model quality and long-running two-user load remain unmeasured.

## Actual workflow evidence

All13 checks passed: source import; managed recipe/install/preview/screenshot; actual Water Level UI and Show→Pressure/Flow charts; native agent edit and deferred managed restart with rendered change; unchanged-file discussion and native conversation reload/member-home handoff; actual VersionV1 publication to a disposable local bare origin; restart retaining edited UI; two independently UI-tested running previews; agent overlap with another member's preview; queued second agent with both completed; running cancellation/descendant cleanup/resume; queued cancellation preserving active work; unused-preview reclamation. Chrome interactions exercised the real Deui UI, not a placeholder or HTTP readiness alone.

The source-only copy excluded `.git`, dependencies and `.env` files. No existing account DB/provider home/project data was copied and no remote Deui/Snowpack ref was pushed. Actual personal-provider operation and hardware/Bluetooth/iOS/iCloud/Visualizer behavior remain user/device checks. Existing account sign-in remains separate from execution acceptance; no account reconnect or unsolicited email was required. A substantial import wizard remains separate design work.

The post-success controller encountered an already-collected systemd unit while tidying up. Its original summary/failure log and executed script are retained; the reviewed receipt confirms child exit0/all13 checks, an empty worker slice and restoration of live `a516d7a`. Future controller cleanup tolerates already-collected units. This was infrastructure bookkeeping, not a failed application workflow, and required no application rerun. Setup confirmed backend health, successful encrypted-backup health and8718.6 MiB data-volume availability after removing only reproducible dependency/addon caches from completed disposable fixtures. Retained evidence/source/Git/sessions/profiles remain; dependency reinstall may be needed to reuse a fixture.

Root-only sealed evidence, with every manifest hash verified:

- Native suite/worker gates: `/root/dialogue-acceptance/2026-11-09-040258Z-e801b0d.tar.gz`, SHA256 `07c592e9f6c08ba23349814bec1223a177f7f9a21a1a62864f16fd1b40594fed` (98 artifacts).
- Real Deui/capacity: `/root/dialogue-acceptance/2026-11-09-040503Z-e801b0d-capacity.tar.gz`, SHA256 `3efdfa1bbcc9dde1cccae33a629f596cee36d4b04196286247a4b63ddd3dbb1c` (109 artifacts), including `capacity-analysis.json`, `review-receipt.json`, report/worker records, timeline, CPU/PSI/pids and screenshots. The reviewed screenshot is the intended Charts shell with expected uninitialized BLE debug state; no machine telemetry was claimed.

Build independently rechecked public health/home200 and unauthenticated project API401. This acceptance does not claim a full real-user hosted HTTP/auth/proxy workflow, real-provider answer quality, hardware interaction or a sustained load benchmark.

## Preserved incident evidence

Setup is preserving the Deui setup/application/kernel/process evidence before any retry. The 6 November GitHub public-key error is separate from 7 November memory kills. One Deui preview reached 256 MiB; the 1280 MiB agent scope contained OMP and project Node/Vite/esbuild processes. Individual scope/request attribution must use cgroup/PID/workspace/timestamp evidence; temporal proximity alone is insufficient. The retained raw material is root-only. Archive: `/root/dialogue-evidence/2026-11-09-deui-030008Z/`. Complete long journal records correlate all four retained 1280 MiB agent scopes to Deui working directories: 7 November Melbourne 14:04:03/14:05:00 setup tree (`5e2aa439`/`9d6f5d91`), 15:53:57/16:32:12 main (`4737edd6`/`af950abf`). Main scopes additionally match request-sidecar intervals/PIDs: `4737edd6`→request `8895fbf6-647c-4353-a41f-91db96cbe069`/PID85635, `af950abf`→`b114603a-6386-4243-8749-d916897c51c6`/PID86944. Setup scopes have no request record. The sealed archive (41 verified evidence hashes) is `/root/dialogue-evidence/2026-11-09-deui-030008Z.tar.gz`, SHA256 `b5019e3c6b84b852695cfd668d636f8051da49b32197b3ed5b77b4f56f8a036b`. Historical complete-tree peaks/PPID edges are unavailable; kernel usage-at-kill/task tables are retained and shared RSS must not be summed. Installed physical memory3915 MiB; observed idle MemAvailable3352 MiB, no swap. Neither idle value establishes workload capacity.

## Rejected native candidate (historical)

`7a0378d` passed164 Linux tests, then failed actual OMP transcript durability (code1, whole-tree peak1068.1 MiB, no kernel OOM). [Pinned native locking code](https://github.com/can1357/oh-my-pi/blob/v18.2.10/crates/pi-natives/src/file_lock/linux.rs) uses an abstract Unix datagram bind. The accepted follow-up allows bind and denies listen (HTTP servers cannot accept connections); memory limits are unchanged. Native transcript durability and normal-parent-exit/descendant cleanup now pass. Original failure bundle: `/root/dialogue-acceptance/2026-11-09-032950Z-7a0378d.tar.gz`, SHA256 `81f48b4b4327ed9d0bded623a358dad3691284b5a6436aa96ff80f900339c7bc`. Snapshot `7667b53ca1a751d72842ee5f6bd00a8b5f2dd35284281850805e7de3f1f546ac` passed isolated restore after infrastructure fixed transient socket IPC exclusions while retaining regular profiles/conversations and `workers/records`. FIFO/device entries remain rejected. Live `a516d7a` was restored.

## Installed contract and experiment design (historical)

The 4 GB /2 vCPU pilot currently has an app ceiling of 512 MiB and worker MemoryHigh/Max 2048/2304 MiB, swap max256, tasks384, CPU150%. The candidate verifies the declared slice, app and ancestor limits before starting. Retain at least 1536 MiB physical space outside the worker slice for app + OS/infrastructure. Do not change namespaces, mounts, credential boundaries, aggregate limits or disk reserve to make a check pass.

The **defaults are not a recommended Deui capacity policy**. Measure cold dependency install, cold first browser interaction, warm interaction/HMR, native OMP editing, discussion, screenshots and each supported overlap. Start an isolated disposable check service with the same installed slice/CPU/tasks and no production environment/credentials. Sweep only explicit preview profile values (256 baseline, then 512/768 if baseline fails) while retaining admission2048/slice2304 and a single heavy job. Select values only from complete-tree kernel peaks, outcome events and end-to-end checks. A 768 preview +1280 agent consumes the entire 2048 reservation; screenshot work must wait until the agent exits. Two 768 previews cannot coexist with that agent. A member's own preview is paused during their edit; measure another member’s preview concurrently. Raise install/browser limits only if their own measured evidence requires it, and recompute admission combinations. Busy states are a supported limit, not a failed request disguised as success.

## Measured failure progression (historical)

Exact706ef47 passed165 Linux tests and complete native gates. Deui preview256/512 hit their respective hard caps with OOM kills before the actual UI passed. Preview768 stayed below its cap (kernel peak707,784,704 bytes, anon~627 MiB at the largest sample) but the20s initial screenshot deadline prevented later acceptance. Do **not** infer host exhaustion or a working UI: min host MemAvailable remained2469–2478 MiB, max slice current1382–1563 MiB across attempts, installed slice2304. Install peaks near768 MiB included substantial file cache; agent setup peaks approached1280 without OOM. Later edit/history/concurrency peaks are still unknown. Raw per-scope reports and100ms joined samples are retained at `/root/dialogue-acceptance/2026-11-09-034301Z-706ef47-capacity/`.

The final accepted run used preview768 and unchanged admission2048/slice2304/app512/CPU/task/swap with the paired timing values above. No memory increase followed768. A healthy HTTP preview may retain configuration after optional thumbnail failure; its image is removed, warning retained and `uiVerified:false`. Preview death still fails. Source-import/configured-preview labels never claim that this verifies a working UI. The actual UI/Charts/edit/continuity/version/two-member/cancel gates remained unchanged and subsequently passed. The driver retains bounded JavaScript/network failure events and phase timestamps; incidental Chrome DBus/Floss warnings were not established as causal.

## Harness invocation

`scripts/check-deui.js` passed its full disposable workflow on macOS and the native Linux host. Local functional evidence alone is not Linux capacity acceptance; the final measured Linux run above supplies that evidence. Earlier fixture errors (shell quoting and missing declarative discussion-model catalog) are fixed. Save Version after a local recipe commit is fixed in application code, with unseen-remote-update regression coverage.

Provide a source-only Deui archive and a fresh root, for example:

```sh
DIALOGUE_DEUI_SOURCE=/srv/dialogue/checks/sources/deui-c3396e14 \
DIALOGUE_ACCEPTANCE_ROOT=/srv/dialogue/checks/capacity/ \
DIALOGUE_WORKER_PARENT_UNIT=dialogue-deui-check.service \
DIALOGUE_WORKER_PREVIEW_MB=768 \
DIALOGUE_WORKER_BUDGET_MB=2048 \
DIALOGUE_WORKER_SLICE_MB=2304 \
DIALOGUE_WORKER_BROWSER_SECONDS=120 \
DIALOGUE_SCREENSHOT_TIMEOUT_MS=60000 \
DIALOGUE_ACCEPTANCE_UI_TIMEOUT_MS=90000 node scripts/check-deui.js
```

The check service/environment supplies isolated mode and the existing pinned binaries. Do not source production credentials. The script retains `report.json`, worker records and UI PNGs; it never pushes to Deui and it does not remove evidence on failure. Check `native`, `capacityAccepted`, every actual check and per-class kernel measurements, not merely exit code. A successful run characterizes only the workload/source/profile values in that report.256/512 baselines already failed and their evidence is retained; the invocation above reproduces the accepted settings.

## Native acceptance gates

1. Pin the exact candidate and verify executable, working directory, source revision and expected complete-suite count. Use only disposable data/identities. Run the full suite and updated `npm run check:workers`; it now proves agent listener denial, actual native OMP outbound traffic and persisted OOM evidence in addition to existing boundaries. macOS tests do not prove seccomp/cgroup behavior.
2. Pin Deui source `c3396e14ed2e7193b71b2a92df710a615c18e8be` from the hosted mirror in a **separate** disposable origin/mirror/worktree. Never copy the production app account DB, provider homes or absolute linked-worktree metadata. The source is private; acquire it read-only through authorized existing Git access. No credential may be emitted into evidence. Dependency installs must execute in managed install scopes.
3. Verify source import separately from a configured recipe, HTTP readiness and rendered UI. The intended web UI is the React espresso control interface, not a directory listing or placeholder. Open its desktop controls (Water Level/Charts), click Show to enter charts and verify Pressure/Flow labels; return/reload. Native Bluetooth/espresso machine, iOS/iCloud and external Visualizer operations are not hosted browser acceptance and remain user/device-dependent.
4. Use actual native OMP in its agent scope with disposable local model endpoints for deterministic read/edit/runner-tool calls. Edit a real UI label, verify the intended rendered label after managed preview resume/HMR, reload, preserve conversation through a new manager/member home, and discuss without changing the Git tree. Record this explicitly as a scripted local model; do not claim real-provider answer quality or arbitrary prompt capacity. A personal-provider smoke test requires user participation and must not reconnect a working account.
5. Save a version through Dialogue’s actual publication path into a **local disposable bare origin**, verifying the commit and numbered tag. No push to Deui/Snowpack or production project refs. Exercise cancellation during queued and running work, restart, repeated use and last-viewer reclamation. Retain failed attempt logs and worker records before any retry.
6. Characterize two-member workload: one editing/one viewing, two viewed workspaces, a second queued agent, and release/restart. Report which combinations actually succeed, queue or fail and their durations. Keep source/conversation state through capacity rejection. Capture 100ms whole-worker cgroup peaks, OOM events, installed ancestors, slice **current** time series, app memory and system MemAvailable/swap. Retained memory.peak of a long-lived slice is historical, not proof of concurrent demand. Include Chrome/Node/esbuild descendants. Avoid interpreting single-process RSS as worker capacity.
7. Record each failed/successful setting and source/candidate SHA, cold/warm state, actual checks, peaks, headroom and supported concurrency. No upgrade recommendation before these measurements. If minimum dependable workload does not fit, report its measured aggregate +required headroom and what 4GB can support; purchasing/changing capacity is Matt’s decision.

## Rollout and rollback

No schema or credential migration is needed. Durable additions are private worker records, per-runner logs and archived setup logs. Runner request mailboxes are ephemeral: recovery must not replay one as a new operation. Loaded requests already mark interrupted runs failed. Preserve existing project repos/worktrees, accounts, member/provider homes, native sessions and original conversation attachments. The app archives prior setup logs before retry and reads failed cgroup evidence before cleanup.

For a Setup-owned rollout: pin exact tested source and installed policy above, verify the recorded168-test/native13-check evidence and source hashes, drain active jobs, take a fresh consistent encrypted backup and record the old release/environment pointer. Keep the proved backup helper behavior: retain `workers/records`, profiles and conversation state; exclude transient Unix sockets/caches while rejecting FIFOs/devices. Recovery snapshot `7667b53c` passed full isolated restore; source-only disposable retries did not require a new data migration. Confirm no residual check scopes and acceptable disk space, then apply the accepted environment and start through the normal fail-closed isolation startup verification. Check public health, unauthenticated private API/development-login denial, exact preview-origin/auth behavior and logs/limits. No personal provider reconnect or production test publication is required. Keep nightly03:00 Melbourne backups,27-hour freshness/failure alerts and current HTTPS/DNS/mail unchanged.

On startup/health/isolation failure, restore release **`a516d7a0eab6dc897f699759d5d288c102245e2d` and its recorded policy environment together**, clean verified descendants and retain new diagnostics/user data. Prefer source/config rollback without replacing live data; restore a consistent encrypted snapshot only for actual data recovery. Do not overwrite newer projects/credentials with test fixtures. Returning to the old256 MiB policy also withdraws Deui capacity acceptance; the failed workflow must not be advertised as supported. Retain the prior release and all failed/accepted evidence. Deployment remains in Setup & install.
