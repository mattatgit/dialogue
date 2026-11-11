# Preview runtime memory correction — 11 November 2026

Dialogue Build owns this application correction; Setup & install owns native acceptance and deployment. The Settings rollout remains authorized after its required gates pass. This document does not accept capacity or propose a ceiling increase.

## Failure evidence

Exact `8191ffb` passed195 Linux tests, native workers and guided import10, then failed Deui after7/13 gates. Cold second-viewer scope `dialogue-worker-804772a1-e031-4308-93ea-426577472922.scope` reached768MiB and was OOM-killed. Its last pre-kill sample: anon749.05MiB, file6.57MiB, kernel12.19MiB. During that phase maximum sampled slice current was1785.72MiB and minimum host available2151.07MiB. This is an individual preview-tree failure, not whole-host exhaustion or a browser timeout.

The scope contained one npm/Node/esbuild tree. Runner, worker policy, browser driver and Deui harness bytes match previously accepted `bfec90a`; that earlier cold second preview already peaked767.5MiB with no OOM. Prior success therefore did not establish dependable margin. Preserve both outcomes rather than retrying until a pass.

Sealed failure: `/root/dialogue-acceptance/2026-11-11-050238Z-8191ffb-guided.tar.gz`, SHA256 `78e57b4b060156c23938e0b458ccf518c02ccdbc432cccf584f18a2f0154757f`. Supplement: `/root/dialogue-diagnostics/2026-11-11-8191ffb-second-preview.json`, SHA256 `a2c209b8b2cf43d7c136f5d31d3b0ce4623f64bb32c42a969dd1af59ee2155ef`. Shared `infra/binarylane/pilot/SETTINGS_ACCEPTANCE_BLOCKED.json` holds the comparison. Production remains `e801b0d`.

## Application correction

Only isolated **preview** workers receive these fixed application-owned hints at the existing768MiB ceiling:

```ini
NODE_OPTIONS=--max-old-space-size=256 --max-semi-space-size=4
GOMEMLIMIT=128MiB
GOGC=50
GOMAXPROCS=1
```

Old space scales as `max(64,floor(previewMiB/3))`; the Go target as `max(32,floor(previewMiB/6))MiB`. Generic256MiB previews use85MiB old space and42MiB Go target. Project runtime environment overrides are excluded. Existing Bun hints and other worker classes are unchanged.

npm, Node/V8, external buffers, Go/esbuild, mappings and kernel charges all share **one** scope. These hints are not independent reservations or hard per-process limits. [V8 young generations use three times the semi-space size](https://nodejs.org/api/cli.html#--max-semi-space-sizesize-in-mib); [Go's target is soft and excludes some external/OS memory](https://go.dev/doc/gc-guide#Memory_limit). Kernel enforcement and aggregate headroom remain authoritative. One Go execution thread matches the existing half-core preview quota without raising CPU/tasks.

The Deui harness now repeats three cold optimizer loads of the second working copy, retaining the first preview. Between attempts it fully stops the second runner and removes only its disposable `node_modules/.vite` cache. OS file cache is retained and labelled. `report.coldSecondPreview` records each attempt, worker ID and timestamps. All three must pass Water Level → Show → Pressure. All editing, conversation, Version, concurrency/cancellation/reclamation checks remain; there are still13 overall gates. Runner crashes surface their recorded error immediately instead of waiting for a generic UI deadline; no deadline increases.

## Local profiling (not Linux capacity)

Pinned source-only Deui `c3396e14ed2e7193b71b2a92df710a615c18e8be`, Vite5.4.21/esbuild0.21.5, was installed once into a disposable managed-runner copy. Each variant cleared optimizer cache and passed three real UI interactions/reloads. No personal credentials/project data or real remote publication were used.

| Local variant | Max sampled summed process RSS | First interaction after HTTP ready |
| --- | ---: | ---: |
| Prior460MiB old space |922.5MiB |1.7s |
|256MiB old space +4MiB semi-space, default Go |782.7–848.2MiB |2.0s |
| Same Node bounds, Go192MiB/GOGC50 |716.4MiB |2.2s |
| Same Node bounds, Go128MiB/GOGC50 |636.0–681.9MiB |2.5–2.7s |
| Same Node/Go128 bounds, GOMAXPROCS1 |653.3MiB |5.5s |

macOS RSS sums can double-count shared mappings and omit kernel/cache charges. They justify testing the correction, not accepting a Linux ceiling. Node tuning alone did not control esbuild; the Go target did not act as a hard RSS cap. Raw reports/Node samples remain under `/private/tmp/dialogue-preview-memory-evidence`; scripts/logs are `/private/tmp/dialogue-preview-memory*.cjs` and `.log`.

Local validation: all196 tests pass, zero failed/cancelled/skipped; Nix packaging passes. The expanded Deui harness passes all13 gates and three cold second-preview attempts in47.9s, with actual native OMP/Git/browser and a scripted local provider; report `/private/tmp/dialogue-preview-acceptance/deui-dej1sw/report.json`. This direct-mode harness validates the changed flow, not the isolated launch hints or cgroup capacity (`native:false`, `capacityAccepted:false`). The profiling variants above explicitly supplied the candidate hints; Linux must apply them through the real isolated launcher.

## Required Setup checks

Use Build's corrected committed SHA, root-owned/hash-verified source/dependencies and existing guarded disposable services. Expected full suite is **196 tests**, zero failed/cancelled/skipped. The new worker regression rejects inherited runtime overrides and executes real Node to verify effective heap bounds; it does not replace native measurement.

Run full Linux suite, direct-Node native workers, guided import10 and expanded Deui13. Require `coldSecondPreview.length===3`, every attempt passed, three attributed preview scopes with no workload OOM/task kill, `native:true`, `workflowAccepted:true`, `capacityAccepted:true`. Retain complete-tree peaks,100ms anon/file/current/CPU series, actual concurrent slice current and minimum host available, plus setup/steady-state/other-viewer/queued-agent outcomes. Report repeated cold peaks, margin below768MiB and latency; a lucky single run at the ceiling is insufficient. Do not flush host caches or alter real Deui work.

**No installed setting changes:** preview768, agent/provider1280, install768, browser256/control128, admission2048, slice high/max2048/2304, app512. Keep one heavy job, two previews, own-preview pause and other-member preview retained. Keep CPU/task/swap/disk policy, screenshot60s/browser120s and existing UI deadline. No new mounts, input grants, provider/runtime upgrade, credentials or backup root are required. If it still fails, preserve evidence and report unmet capacity before recommending another policy or hardware change.

After native acceptance, finish catalog/local-origin/context/avatar/selection/disconnect recovery and the real Safari/physical passkey gate. Keep consistent backups/current profiles and the Disconnect-aware rollback requirements in `ACCOUNTS.md`: older source may rediscover retained credentials. Deployment and rollback remain with Setup & install.
