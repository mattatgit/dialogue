# Shared-pilot workers: application and host contract

Application implementation: `codex/pilot-isolation`, based on `codex/accounts-shared-workspace`. Updated 2026-11-04.

Conversation follow-up: `codex/conversation-sidebar` builds on target-validated `ee3649f`. Its workspace removes the visible terminal client and adds native branch conversations. An agent may additionally mount only its selected `requests/.sessions/<branch-hash>` read-write, selected `requests/.attachments/<branch-hash>` read-only and current `requests/.replies/<request-id>.json` read-write. Other branches' conversation directories stay hidden. Final reply reads are bounded; snapshot attribution waits for verified scope cleanup. Legacy terminal endpoints retain their original limits for compatibility, but normal UI use does not start them.

**Setup handoff for this follow-up:** rerun the updated `scripts/check-workers.js` before deploying the new candidate. It now verifies these mounts, a read-only checkout, and real isolated OMP continuation/complete replies across disposable member homes with a local fake provider. Previous acceptance of `ee3649f` does not validate these additions. Back up and restore **all** `requests/.sessions` and `requests/.attachments` alongside request records and member homes; never exclude them as caches. They are covered by a complete data-root copy, but add them to recovery fixtures. `.replies` and `.activity` are transient. Existing infrastructure settings and backup services are not changed by this application branch.

The Dialogue Build chat owns this code, policy, tests and contract. **Setup & install** owns installation, systemd/AppArmor/cgroup configuration, service activation, backups and deployment on BinaryLane. This change does not connect to or modify the server. Preserve its configured DNS, HTTPS, Resend and encrypted infrastructure backups.

The latest setup handoff uses Ubuntu 24.04 LTS, Singapore, 2 vCPUs / 4 GB / 60 GB. The app is `https://build.idealogue.studio`; previews are `<token>.preview.idealogue.studio`. This supersedes the older `.io` preview namespace. These different hosts are same-site: keep host-only `__Host-` cookies and exact app-Origin checks. Public sharing remains unavailable.

## Implemented boundaries

Production and `NODE_ENV=production` require Linux isolation. `DIALOGUE_WORKER_MODE=direct` cannot override that. Before listening, the application verifies its unprivileged service identity, cgroup v2 controllers, bounded worker slice, actual namespace access restrictions and **kernel** memory/process/swap/CPU limits in a running test scope. A failed check stops startup. No environment variable is accepted as proof that a process is isolated, and launch failures never fall back to ordinary child processes.

The PID check compares the worker's kernel namespace identity with the app's captured identity, then confirms worker PID 1 belongs to that same private namespace. It does not infer isolation from process names or command-line text. The initial `8db78aa` target check failed because Bubblewrap's PID 1 argv contained the probe source, causing a false `systemd` substring match; re-stage the follow-up fix and rerun the complete acceptance check. Early probe failures include exit/signal and a bounded stderr tail for diagnosis.

`server/workers.js` wraps project-agent requests, preview setup agents, dependency installs, preview servers, ttyd/tmux/OMP terminals, model-provider probes/login/catalog RPC and Chromium. Each process tree runs in a transient systemd **user scope** plus a Bubblewrap mount/user/PID/IPC/UTS/cgroup namespace. It cannot see host `/home`, `/root`, application state, mail/backup credentials, other members' homes, host management sockets or cgroup control files. It has a private `/proc`, `/dev`, capped tmpfs `/tmp` and shared memory, no capabilities, no privilege escalation and no nested user namespaces. All descendants remain in its resource scope, including detached/background processes.

The only writable project mount is the selected linked working copy, including its subdirectories. An agent/control/terminal sees only its own member OMP home; this includes the owner, who does not inherit the app's service home or environment keys in production. Model credentials must be established through that member's normal sign-in. Dependency installers, preview servers and Chromium never receive provider homes. Environment variables use a fixed allowlist; SMTP/Figma/provider keys, SSH agents, loader overrides and service configuration are excluded. Install/preview caches persist under `workers/cache/<checkout-hash>` without granting access to other caches.

The small read-only `/etc` allowlist includes public account/group names for tmux/NSS, resolver/host information, CA certificates, timezone, loader cache and public alternatives. It excludes shadow/password hashes and private service configuration. Host account names are visible; their home directories and files are not mounted.

Git mirror metadata is read-only, including the selected worktree's metadata and `.git` link. This prevents project code from installing hooks or rewriting other working copies through Git. `git status` and `git diff` remain available, with optional index refresh disabled; staging, commit, push and branch mutation belong to the trusted Dialogue APIs and **Save a version**. Raw Git publication from the production terminal is deliberately unavailable. Deploy keys stay with the trusted app and are never mounted in workers. The app owns its Git configuration; do not put project-controlled hooks, filters or global Git includes in the service home.

Only the current request's Figma snapshot is mounted read-only. Activity writers get a single sidecar file, not its parent directory. Terminals have individual IPC directories and tmux sockets; one member cannot attach to another through a shared tmux socket. Terminal sessions survive browser disconnects while their worker is alive, but **do not survive an app-service restart or the one-hour worker limit**. File changes remain on disk. Local direct-mode tmux behavior remains unchanged.

Recipe and manifest reads are bounded and confined to the selected checkout. On Linux, the app validates each opened file through `/proc/self/fd` before reading it, preventing symlink-replacement races. Static preview roots must remain inside the working copy, and static responses stream the verified open descriptor. HTML bridge injection is limited to 2 MiB. Screenshot output is confined to its temporary directory, bounded to 16 MiB and verified as PNG before publishing. Activity reads, readiness output, preview log lines and setup logs are bounded as well.

## Pilot resource policy

All process families share one admission budget. Reservations include queued work until the entire finished scope has been cleaned up; failed cleanup stops further admission. There is no privileged launcher or passwordless sudo path from the app.

| Worker | Maximum concurrent | Memory per scope | CPU quota | Tasks | Maximum lifetime |
| --- | ---: | ---: | ---: | ---: | ---: |
| Structured agent / setup agent / install | **1 total**, FIFO queue | 768 MiB | 100% | 96 | 660 / 600 seconds |
| Preview server | 2 | 256 MiB | 50% | 64 | 1 hour |
| Interactive terminal and its commands | 2 | 384 MiB | 75% | 96 | 1 hour |
| Provider probe/login/catalog | 2 | 128 MiB | 50% | 48 | 660 seconds |
| Chromium screenshot | 1 | 256 MiB | 75% | 96 | 40 seconds |

Admission reserves the per-scope memory ceilings, up to **2048 MiB total**. Two previews, two terminals and one heavy worker exactly fill this budget; other work waits for capacity. The queue holds at most eight jobs and waits at most 60 seconds. Preview/terminal capacity errors return immediately, except a replacement preview may join the bounded queue while an old preview scope is already closing. It cannot exceed the existing concurrency or memory limits. Errors ask the user to close an unused preview or retry. Queue cancellation, removed-member access and shutdown cancel the associated work. Expensive structured jobs/installers are serialized; arbitrary commands *inside* a terminal are bounded by that terminal's scope, rather than individually scheduled by the app.

Viewing a historical build releases that viewer's live-branch preview lease while retaining a conversation-only SSE subscription (`events?preview=0`). In production, and for read-only snapshots locally, the last viewer leaving stops the preview immediately and waits for verified worker cleanup; another active viewer retains it. Returning to the current build reacquires its preview. Hidden historical previews therefore cannot silently occupy the two-preview allowance.

Every scope has zero swap, a 256 MiB file-size ceiling, a 1024-file-descriptor ceiling and disabled core dumps. Private `/tmp` is capped at 256 MiB and `/dev/shm` at 64 MiB, charged to the worker's memory cgroup. Preview installs and servers have separate persistent cache homes to avoid putting package caches on the private tmpfs.

Before a worker starts, free storage must exceed 1 GiB. A two-second watchdog stops workers and closes admission if that reserve is exhausted. This is an emergency guard, **not a disk quota**: before launch, the host must monitor disk space and enforce quotas over worker-writable workspaces/caches/member homes, or use a bounded dedicated data filesystem so project writes cannot fill the OS volume. Logs and individual file sizes are bounded; many small project files can still consume space. Validate the configured storage boundary and low-space behavior on the target. Cleanup/retention and volume/quota provisioning belong to Setup & install.

These are initial small-host limits, not evidence that Snowpack or every framework fits 4 GB. Validate the real project and measure memory, queue delay, disk use and OOM events before calling capacity sufficient. A worker OOM/timeout is a failed job, never a successful edit; completed file changes remain available. Prefer resizing or deliberately reviewing the policy over removing resource controls.

## Requirements for Setup & install

1. Provide an unprivileged, dedicated service account with a lingering systemd **user manager** and delegated cgroup v2 `cpu`, `memory` and `pids` controllers. Run Node directly in a user service named `dialogue.service` (`Type=exec` or `simple`, not an npm parent or a notify service waiting on this self-test). Keep its listener on loopback behind the existing nginx configuration. `DIALOGUE_WORKER_PARENT_UNIT` may name another `dialogue-*.service` when deliberately configured; its MainPID must be the Node process. Worker scopes bind to that parent, so an app crash/restart also stops its workers.
2. Install root-owned, namespace-compatible Node >=22.13, Bubblewrap with `--disable-userns`, util-linux `prlimit`, Git/OpenSSH, OMP, ttyd, tmux and a **non-Snap** Chromium/headless-shell. Public runtime trees `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64` and `/nix/store` are mounted read-only when present. Extra trusted tool installations may be listed in `DIALOGUE_WORKER_TOOL_ROOTS`, colon-separated, under separate `/opt/<tool>` directories. Do not grant `/`, `/home`, `/etc`, `/run`, the release root or the data root as tool directories. No credentials belong in tool installations. Verify actual OMP/ttyd/tmux/Chromium execution in the namespace; a shell wrapper that needs Snap's host services is unsuitable.
3. Preserve AppArmor and host protections. Ubuntu's policy must permit the trusted Bubblewrap binary to create the required unprivileged namespaces. Scope any required AppArmor exception to that binary/service; do not disable AppArmor or unprivileged-namespace restrictions globally. Keep the app unprivileged, with no Docker socket, sudo capability or broad service-manager permission. Do not impose `RestrictNamespaces=yes` or a syscall rule that prevents the required namespaces and then work around the resulting failure by disabling isolation.
4. Install a user `dialogue-workers.slice` with these resource properties (a deployment reference, **not installed by this branch**):

   ```ini
   [Slice]
   MemoryAccounting=yes
   MemoryHigh=2048M
   MemoryMax=2304M
   MemorySwapMax=256M
   TasksAccounting=yes
   TasksMax=384
   CPUAccounting=yes
   CPUQuota=150%
   ```

   The app is outside that slice; apply its own reviewed memory/task limit (512 MiB is a starting ceiling) and leave room for nginx, ACME-DNS, backups, SSH and the OS. Verify the resulting hierarchy and kernel files; unit-property readback alone does not prove enforcement. Ensure that other limits on the account/user manager do not silently put the app inside the worker budget. The old NixOS system-service module does not provide this new user-manager contract and must not be treated as a ready production unit.
5. Set `DIALOGUE_MODE=production`, `NODE_ENV=production`, `DIALOGUE_ORIGIN=https://build.idealogue.studio`, `DIALOGUE_PREVIEW_DOMAIN=preview.idealogue.studio`, a canonical absolute `DIALOGUE_DATA` (for example `/var/lib/dialogue`), the member bootstrap settings and the already prepared private SMTP environment. Keep releases root-owned and do not place `.env` in the release. The app captures/removes SMTP/Figma secrets before launching workers. Keep `PATH` limited to the public tool installations. The user-manager environment must expose its normal `XDG_RUNTIME_DIR`/`DBUS_SESSION_BUS_ADDRESS` to the trusted launcher, not to workers. Do not load root mail/backup credentials into the user manager's global environment.

   A user service cannot read the existing root-only `/etc/dialogue/mail.env`. Preserve that file's permissions and provision a separate **application-only** `EnvironmentFile`, for example `/etc/dialogue-app/environment` owned `root:dialogue`, mode `0640`, in a `root:dialogue` directory of mode `0750`. Include only the app's SMTP and application settings, never backup or DNS credentials. Point only `dialogue.service` at it; do not import it into the manager's global environment. Workers do not mount that directory. Include this file, the user units and their ownership/permissions in encrypted infrastructure recovery. Setup & install owns provisioning it; this branch neither reads nor copies production secrets.
6. Required writable data includes `accounts.sqlite`, `db.json`, mirrors, worktrees, requests, activity, preview/setup/stamp state, deploy keys and `users/<id>/{agent.json,home/}`. All member homes and the new owner model settings must be covered by application recovery. The app's own service home is separate and never mounted in workers. `workers/` is cache/ephemeral state and may be excluded from backups; clear stale worker IPC/probe/browser directories only after confirming no worker scopes remain. Existing model homes are not automatically migrated into production: users sign in on the server.
7. Extend the infrastructure backup workflow **before populating production app data**. Its current guard against nonempty `/var/lib/dialogue` must be replaced with tested, consistent app coverage. The safest initial procedure is to stop the app user service, verify its worker scopes have stopped, back up SQLite consistently plus repositories/worktrees/requests/profiles/keys at their canonical absolute paths, and restart in a `finally`/failure-safe procedure. Preserve working copies' absolute Git links on restore, or explicitly repair and verify them. An infra-only snapshot or a live copy of `accounts.sqlite` is not an application restore test. Coordinate backup pauses, alerts, encryption and retention in Setup & install; this branch does not change those services.
8. Worker network access is intentionally shared with the host for preview loopback, model endpoints, package registries and request-scoped Figma reads. This is **filesystem/process isolation, not a private worker network or outbound firewall**. Local management endpoints must require authentication and no credential-bearing service may rely on loopback reachability alone. Keep Git deploy keys in the trusted app. Check GitHub SSH reachability/approved port routing separately in Setup & install; do not expose an SSH agent to project code as a workaround.

Environment tuning is bounded: `DIALOGUE_WORKER_BUDGET_MB` (768–2304, default 2048), `DIALOGUE_WORKER_QUEUE` (1–32, default 8), `DIALOGUE_WORKER_WAIT_MS` (100–120000, default 60000), and `DIALOGUE_WORKER_DISK_FLOOR_MB` (256–8192, default 1024). The aggregate slice's hard memory ceiling must be at least the admission budget and no greater than 2304 MiB. Executable overrides `DIALOGUE_BWRAP`, `DIALOGUE_SYSTEMD_RUN`, `DIALOGUE_SYSTEMCTL`, `DIALOGUE_PRLIMIT` are deployment-controlled absolute binaries. Per-class ceilings live in the reviewed application policy, not project recipes.

## Target acceptance and launch gate

The local `npm test` suite covers policy/configuration, path exposure, queue/cancellation, isolation-required failures, production identity separation, project-file boundaries and existing product behavior. **macOS direct-mode tests are not Linux isolation validation.** The local Docker installation is incompatible with this Mac; no target claims should be inferred from it.

Setup & install must run the supplied `scripts/check-workers.js` in a disposable user service, with the **same account, slice, public tools and namespace policy** intended for the app. It creates only temporary fixtures, no real accounts/model credentials or email. For example, adapt paths to the chosen release/tools:

```sh
systemd-run --user --unit=dialogue-isolation-check --collect --wait --pipe \
  --property=Type=exec \
  --setenv=DIALOGUE_WORKER_PARENT_UNIT=dialogue-isolation-check.service \
  --setenv=DIALOGUE_WORKER_TOOL_ROOTS=/opt/dialogue-tools \
  --setenv=DIALOGUE_CHROMIUM=/opt/dialogue-tools/bin/chrome-headless-shell \
  /opt/dialogue-tools/bin/node /opt/dialogue/current/scripts/check-workers.js
```

This is a required target check, not an instruction for the Build chat to deploy. It verifies the real namespace/kernel limits, writable selected files, denial of app/other-user data and Git writes, separate preview homes, tool execution, cancellation of detached descendants, worker OOM containment, task limits, and a real Chromium screenshot. It must print `ALL LINUX WORKER CHECKS PASSED` and return zero. Failure blocks launch; do not suppress failures or use direct mode. Keep the test fixture separate from the guarded production app data directory.

Also verify that killing/restarting the app/check parent service leaves no associated worker scopes, and that the app recovers after low-disk/worker-cleanup failure with an explicit restart. Test both actual members signing in to their own provider, structured edits in separate copies, live preview/HMR, terminal reconnect, read-only handoff, version publication, service restart, and a consistent encrypted **application** restore. Local success, infrastructure backups and a TLS-ready setup page do not replace these checks.

## References

- [Bubblewrap policy and namespace options](https://github.com/containers/bubblewrap/blob/main/bwrap.xml)
- [systemd 255 transient scopes](https://github.com/systemd/systemd/blob/v255/man/systemd-run.xml)
- [scope lifetime and OOM behavior](https://github.com/systemd/systemd/blob/v255/man/systemd.scope.xml)
- [kernel control-group v2 limits](https://docs.kernel.org/admin-guide/cgroup-v2.html)
