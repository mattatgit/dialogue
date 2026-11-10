# Dialogue — Architecture

This document records the current architecture direction. It distinguishes the **lightweight development architecture being built now** from the likely **production architecture later**.

The private pilot targets BinaryLane Ubuntu 24.04 (2 vCPUs / 4 GB). Setup & install owns deployment; the application-side execution policy and host contract are in `docs/WORKERS.md`. The development architecture below remains useful for local work.

## Project/build structure and guided import — Dialogue Build handoff (2026-11-10)

### Objective and first deliverable

Matt approved the product direction below and asked Dialogue Build to start with
a rough UI, which Matt will polish after trying the flow. Prepare a working,
reviewable first slice using Dialogue's existing visual components and agent,
conversation and managed-runner machinery. Prioritize understandable navigation,
decisions, progress and recovery over finished visual design. Clearly label any
temporary fixture or unsupported action. This handoff is application work, not a
production deployment instruction. Continue from Build's current application
checkout; this architecture checkout contains older application code and shared,
uncommitted documentation/infra work that must be preserved.

### Product model

- **Project:** a named organisational container. It can start empty and contain
  several builds; creating one does not require a GitHub repository.
- **Build:** the stable named thing a person creates, imports, reviews and edits.
  Use this term instead of treating app/site/prototype as separate entity types.
  A build has a target, such as Web, macOS, iOS or NixOS. Web covers a UI shell,
  website or full web application; these do not require separate target types.
- Show one card per build. Branches, working copies, saved versions and history
  belong inside that build. A new branch or saved version does not create another
  build card. Keep the continuing conversation scoped to its build/branch.
- Example: Landline contains three builds: Web prototype, macOS and NixOS.
  Alternative branches of the Web prototype remain within that one build.
- Repository connections are distinct from project/build identity. A project can
  contain builds from different repositories; several builds may share a
  repository or use different application roots within it. Do not enforce the
  current one-project-per-repository URL/slug uniqueness rule at the wrong level.

Git branches still cover whole repositories. Build-level navigation does not
change Git's semantics or isolate shared files. Build must define the mapping
between a build, its source/root, branch and working copy, including shared paths,
write ownership and publication scope. Two builds sharing source must not
silently edit the same checkout or publish each other's pending work. Extend the
existing reservations, worktrees and safe publication checks; avoid project-wide
exclusive editing. Keep full merge-UI design separate from this first slice.

### Entry points

On the Projects page, provide **Create project** and **Import project**:

1. **Create project:** name an empty project, open its build gallery, and offer
   Create build / Import build.
2. **Import project:** connect a whole GitHub repository. The agent inspects the
   repository and proposes the project name and one or more builds, their source
   roots and targets. The user can revise the proposal and choose which builds
   to prepare. Preserve the repository as the connected source; a multi-app repo
   must not be flattened into one arbitrary preview or automatically turned into
   a build for every folder, branch or available platform.

Within an existing project, provide **Create build** and **Import build**:

1. **Create build:** name and target, then a prompt or prompt plus design using
   the existing attachment capabilities. Establish local Git working storage as
   needed and make any remote publication destination explicit. Do not silently
   create a remote repository or push scaffolding.
2. **Import build:** connect another GitHub repository or select an app/root from
   a repository already connected to the project. Inspect and propose the
   approach for that build, then prepare it after agreement.

These are two import entry points into one shared workflow, not two independent
import implementations. Initial import support can stay GitHub-based; ZIP,
arbitrary local-folder import and additional providers are separate work.

### Shared agent-guided import workflow

1. **Connect and inspect.** Read the resolved source commit and identify the
   frameworks, application roots, existing targets and scripts, dependencies,
   native/backend/hardware requirements and existing preview configuration.
   Analysis is read-only: fetching/checking out source is allowed, but do not
   install dependencies, run project scripts or modify project files before an
   approach has been agreed. Use the existing read-only agent/tool restrictions,
   rather than relying on prompt wording alone.
2. **Propose and discuss.** Show a plain-language report: what was found, whether
   existing code can run on the chosen target, what adaptation is needed, what
   will be simulated, limitations and any missing input. Let the user change the
   target/root/scope and ask follow-up questions. An unsupported target should
   produce an honest recommendation, not repeated speculative installs.
3. **Confirm and prepare.** Record the agreed plan and source revision before
   creating/changing the build's working copy. If the source or plan materially
   changes, surface that change before executing it. Reuse OMP and Dialogue's
   managed install/preview operations; long-running servers must remain owned
   and measured by the application, outside the agent worker.
4. **Verify and continue.** Distinguish source connected, preview configured and
   intended UI verified. HTTP readiness or a captured thumbnail alone does not
   establish that the intended UI works. Verify a representative interaction
   where possible; otherwise show the outstanding validation honestly. Continue
   into the same build/branch conversation with the assessment, approved plan,
   limitations, attachments and execution results available to the agent.

Persist import attempts and their decisions before a build exists. When one
project import produces several builds, each must retain the relevant assessment
and plan as context. Do not leave the setup reasoning in an inaccessible
one-shot background process or require the user to retype it after an error.

### Deui as the first real example

The inspected `euanlake/deui-app` source at
`c3396e14ed2e7193b71b2a92df710a615c18e8be` already contains React/TypeScript/Vite
UI and Capacitor iOS packaging, including `build:web` and iOS scripts. Recommend
reusing the shared UI for a Web review build. Assess browser behaviour for
Bluetooth, machine/scale data and iCloud; propose explicit simulations/adapters
where required. Do not assume that rendering the UI proves native integrations.
See the [source architecture](https://github.com/euanlake/deui-app/blob/c3396e14ed2e7193b71b2a92df710a615c18e8be/README.md#architecture)
and [build scripts](https://github.com/euanlake/deui-app/blob/c3396e14ed2e7193b71b2a92df710a615c18e8be/package.json).

Keep source/provenance and the destination branch visible enough to understand
how approved Web changes can contribute to the iOS app. For shared UI, these can
be ordinary approved source changes on a branch of the existing repository;
there is no need to duplicate the interface or translate it into another
language. Explicit Save/version/push behaviour remains distinct from approving
an import plan. Do not implement an automatic cross-platform synchronization
engine in this first slice. iOS packaging, hardware and device validation remain
separate requirements; the hosted Linux preview does not establish those.

### Rough UI and recovery states

Provide the Projects actions, an empty-project state, a build gallery with one
card per build and target label, Create build inputs, and a shared import surface
containing source, assessment/discussion, proposed build(s), confirmation, progress
and results. Keep branch selection and saved-version navigation within the build.
Make Web work first; other targets can be represented honestly with their
execution availability explained. This does not promise native platform workers.

Represent connecting/queued/inspecting, needs input or AI/repository access,
awaiting plan confirmation, preparing, validating, ready, failed and cancelled as
appropriate. Distinguish an empty project from an imported-but-unready build.
Explain failures and what survived; offer relevant retry/resume, change-plan,
cancel and diagnostic-detail actions. Preserve prior attempts and bound/sanitize
logs. OOM, timeout, cancellation, access failure and unsupported platform should
not collapse into an unexplained SIGKILL message. A retry must resume or create a
recorded attempt without duplicating projects/builds or overwriting local work.

### Model changes, migration and acceptance

Use stable project/build identities independent of names, repository slugs and
Git refs. Model source connections, build target/root/ref/preview configuration,
and import attempts/approved plans explicitly. Exact schema is Build's choice.
Make recipes addressable per build; two builds in one repository must not
overwrite a single global recipe. Scope requests, conversations, attachments,
history/version operations, worker attribution, preview capabilities and editor
reservations to the correct build/working copy, retaining authorization checks.

Migrate existing project/repository records conservatively to a project and a
compatible build representing the existing workflow. Preserve all branch refs,
versions/tags, deploy keys, conversations, attachments, preview recipes and
unpublished work; do not infer additional builds from branches. Keep legacy URLs
resolvable where practical. Test repeat migration/restart and interrupted import.
Do not rename/move existing Git worktrees without repairing and validating their
linked metadata. Document backup-scope/recovery changes for Setup & install.

First review should demonstrate both entry points, empty-project creation,
prompt/design build creation, multiple builds sharing one repository, builds
using different repositories, read-only assessment and editable plan confirmation,
actual Deui Web UI/interaction, continued conversation, and recovery from access,
agent, preparation and cancellation failures without losing local work. Verify
that another branch/version does not add gallery cards and publishing one build
does not unintentionally include another build's edits. Use disposable sources
and refs; never overwrite or publish real Deui work for acceptance. Run the
repository-required full suite and relevant migration/authorization/native
checks, reporting what was actually validated. Return a rough working UI for
Matt's polish pass, implementation/validation notes and remaining limitations;
leave production rollout to Setup & install.

## Project/build implementation (2026-11-10)

The first slice is implemented on `codex/build-guided-import` using existing Dialogue UI, account, conversation and managed-runner components. Its temporary functional layout is for Matt's flow review, not a replacement visual baseline. The full storage, native acceptance and rollback contract is in [BUILD_IMPORT_HANDOFF.md](BUILD_IMPORT_HANDOFF.md).

`catalog.json` schema1 adds named projects, source connections, builds and persisted import attempts. Legacy `db.json` remains schema4. Each old repository record maps deterministically to one project and one compatible Web build, retaining its exact storage slug, paths, refs, recipe and private data. No builds are inferred from branches. New builds use separate mirrors and worktrees even when sharing a source connection; they can edit repository-wide shared paths, but never share mutable files with another build. Publication remains a whole branch, with existing atomic Git/lease/conflict checks. New local builds publish Versions only to their private `local-origins/<build-id>.git`; creating or confirming never creates a GitHub repository or pushes source remotely.

Both import entry points use one persisted connect → read-only assessment/discussion → revision/source-bound plan confirmation → preparation → UI-check workflow. Assessment starts OMP outside the source tree, with source mounted read-only, public read/search tools clamped by an explicit extension, and ambient project configuration discovery disabled. Pinned OMP's `--tools` alone can re-add write, so both execution hooks and native adversarial checks are required. Preparation uses normal branch requests and Dialogue-managed install/preview operations. It releases the agent reservation before runner/browser work. A real representative click and expected rendered text can establish UI verification for a recorded draft; HTTP readiness alone yields “configured”. Later edited/failed editing requests invalidate the verified status.

Plans, source SHA, attempts, failures, original inputs, attachments, durable design snapshots and request results survive retries/restart. Branch conversations inherit the import assessment/approved approach and original references. A revised preparation plan reuses allocated IDs and existing files; it cannot silently replace an existing working copy's source/destination branch. Unsupported native targets are representable but do not execute on hosted Linux. Initial import is GitHub-only; merge UI, remote creation for local builds, platform workers and hardware validation are separate work.

## Hosted execution handoff (2026-11-09)

Matt chose to keep Dialogue hosted. The next application task is to make real project import, editing and previews reliable through better execution ownership, measured resource policy and scheduling. A local companion, desktop wrapper and new worker-host platform are outside this handoff.

Setup reports the web service at about 45 MB at its observation point, a Deui preview killed at its 256 MiB limit, and an OMP worker containing Vite/Node/esbuild killed within its shared 1280 MiB limit. The model runs remotely. Verify project/request attribution for agent OOMs; an earlier Setup inspection could not associate every agent kill with Deui. The 2048 MiB admission budget and 2304 MiB worker-slice ceiling also constrain overlap. Prior Linux acceptance proves isolation/recovery behavior, not real-project capacity. Preserve the retained setup/application/kernel evidence before retries replace the setup log; distinguish the earlier GitHub SSH failure from memory failures.

1. **Managed preview lifecycle.** Inspect `server/setup.js`, `server/runner.js`, `server/requests.js`, `server/workers.js` and the OMP setup/repair prompts and integrations. The agent should inspect/edit the recipe and use bounded, authorized application operations to install, start, inspect, restart and stop the preview. Reuse the existing runner and prevent accidental duplicate long-running servers for the same working copy. Agent-owned shell children must remain accounted for; prompt wording alone is insufficient to establish ownership. Preserve useful short-lived validation commands and the existing filesystem/credential boundaries.
2. **Coordinated resource policy.** Measure agents, installs/builds, previews and screenshots separately and in the combinations the product needs. Revise per-class profiles, admission reservations, concurrency, queue behavior and required host limits together. Installed cgroup ceilings and application policy must agree. Retain headroom for the app, OS and infrastructure; process separation does not reduce the combined demand by itself. Propose values from measurements rather than assuming the current 4 GB host will fit or prescribing a RAM upgrade in advance.
3. **Scheduling and cleanup.** Bound expensive overlap, reclaim unused previews and clean up all descendants on cancellation, completion and restart. Explicitly handle an agent requesting managed runner work while it already holds a heavy-job reservation, so nested requests cannot deadlock the queue. Preserve active work when capacity is unavailable and report a clear queued/busy state.
4. **Diagnostics and import state.** Capture peak memory for whole worker trees, the applicable individual/parent limits, concurrent worker classes and evidence for OOM versus timeout/cancellation/other signals. Expose bounded plain-language errors without credentials. Distinguish source connection from setup readiness and a verified, currently running UI. A server-ready line or saved `ready` status alone does not establish that the intended app works. A substantial guided-import UI remains a separate design task.
5. **Real acceptance.** Use a disposable Deui working copy and preserve existing project data. Verify clean import/setup, the actual intended UI and a basic interaction, preview updates after an agent edit, discussion without file edits, version publication using disposable test refs, and repeated use/restart/cancellation. Measure setup and steady-state peaks and test or explicitly characterize two-member concurrency. Run the repository-required full suite and updated native Linux worker checks. Report exactly which checks ran, failures and remaining user-dependent checks; do not present synthetic acceptance as capacity evidence.

Dialogue Build owns application implementation, tests, reviewed commits/PR and the updated worker/deployment contract. Setup & install owns host service/resource changes, any approved capacity experiment, backups/recovery and deployment of an exact tested candidate. Prepare its handoff with required values, acceptance steps and rollback implications. If safe execution cannot fit 4 GB, report the measured demand and supported workload/concurrency; purchasing capacity and changing the server are separate user decisions. Update `docs/CURRENT.md`, the worker contract and hosting notes as findings change.

**Outcome (9 November):** exact `e801b0daa593eef8b559048948487dc91553d155` implements this handoff and passed168 local/Linux tests, complete native worker acceptance and13 actual disposable Deui workflow checks. The measured two-member policy uses768 MiB previews with one1280 MiB heavy worker, its own preview paused and another viewed preview retained; the second agent queues. Admission2048/slice2304/app512 and existing isolation remain. Max measured slice current2007.1 MiB/min host available2042.3 MiB support this bounded4 GB pilot; they do not establish parallel-agent or arbitrary-project capacity. Actual UI interaction, edit/render, continuing history, disposable Version save and cancellation/reclamation passed with actual OMP and a scripted local provider. The [execution handoff](EXECUTION_HANDOFF.md) pins settings/evidence/limitations and rollback. Setup deployed `e801b0d` on 9 November after native/backup gates. The 10 November guided-import slice above is separate, not deployed by this Build work.

## Continuing branch conversations (2026-11-04)

The visible console is replaced by the designed conversation sidebar. OMP remains the execution engine; neither a React migration nor a replacement LLM backend is required. Nix remains optional tooling, Ubuntu the production target, and the older NixOS packaging/demo are optional rather than product requirements.

`server/requests.js` still serializes observed agent jobs and records real Git edit snapshots. Each repository/ref workspace now owns a private native OMP session under `requests/.sessions/<sha256(workspace-id)>`. A new worker resumes that directory with `--continue --session-dir`; OMP's native conversation/context compaction survives process exits and service restarts. Different branches have different sessions. A member handoff resumes the branch session using the receiving member's own model home. Required session data disappearing is an error, never a silent fresh conversation. Existing pre-conversation request records are imported as a bounded legacy recap on the first native turn; old one-line summaries cannot be reconstructed into full replies or terminal discussions that were never recorded.

The ordinary request record stores author, full prompt, visual anchor/design reference, attachment metadata, complete user-facing reply, snapshot SHA and observed outcome. `omp/conversation.js` exports only final assistant text into a request-specific reply sidecar; raw tool results and thinking do not become replies. Long replies are bounded at 32,768 characters with an explicit truncation indicator. The prior 180-character activity sidecar remains progress/legacy-summary data, not the conversation transcript. Interrupted/failed turns do not advertise successful edits or completed replies.

Uploaded files live under `requests/.attachments/<sha256(workspace-id)>/<request-id>/`. Workers mount only their selected branch's attachment directory read-only, their selected session directory read-write and their current reply file. This permits reopening earlier references after compaction or member handoff without sharing another member's credential/blob home. Native image caches can be user-specific; prompts point back to durable source attachments when a cached image is omitted. Figma API capabilities remain request-scoped; historical designs are not granted permanent API access.

Natural-language prompts ask the agent to discuss questions without editing and to implement only explicit change requests, as Matt requested. This automatic intent decision is agent behavior, not a guaranteed read-only sandbox. The API's explicit `intent: discuss` additionally uses read/search tools and a read-only checkout, but no extra mode toggle appears in the UI. Worker/session limits, cancellation, authorization and actual-file-change attribution apply in either case. Snapshot attribution waits for verified scope cleanup so detached descendants cannot continue changing a supposedly finished build.

The public conversation is fetched through the existing authenticated activity/request API and refreshed via SSE/polling; complete final replies settle at job completion. Viewing a snapshot swaps the preview runner in place while the live branch continues to supply conversation events. The working branch and unsent draft remain unchanged; returning to current re-enables editing. Version publication retains the trusted Git API and the new toolbar button. Legacy terminal endpoints remain for compatibility, but the workspace no longer loads xterm/ttyd client code or opens terminal connections. Preview repair now submits an ordinary conversation request instead of typing into tmux.

## Architectural principles that remain stable

Regardless of hosting/provider choices:

- Dialogue owns project state and knows where each project's source lives.
- Git is the revision model: a prototype's history is its repository's history, and changes land as commits on branches rather than as separately stored packages.
- Prior work is never destructively overwritten; a new state is a new commit or a new branch.
- GitHub is the source of truth for the Dialogue application, not for runtime clones/worktrees of user projects.
- untrusted checked-out/generated prototype code must not share the trusted authenticated Dialogue browser origin; the local build already serves every preview from its own origin.
- the agent is a replaceable component running against the checkout; Dialogue does not embed provider-specific model calls.
- application code interacts with storage through a boundary (`server/git.js`, `server/terminal.js`, `server/watch.js`) so the on-disk layout can change without changing the product workflow.

## Current lightweight development architecture

### Intended project and unit model

The 10 November model supersedes the earlier repo-as-project naming: Project is a named container, Build is a stable named target, and repository connections are separate. Branches and saved versions belong inside a build. The additive implementation and legacy preservation rules are described above; the repository/ref engine below remains the execution/storage adapter.

### Account implementation

The accounts branch adds a transactional SQLite identity store (`server/accounts.js`), HTTP account routes, passkey verification through pinned SimpleWebAuthn, and SMTP delivery through pinned Nodemailer. It provides invitation-only accounts, one shared workspace, hashed persistent sessions and same-origin authorization. Browser preview capabilities are session-bound. OMP model selection, member credential homes and tmux servers are routed per person; the owner retains the existing profile only in local direct mode. Temporary per-working-copy reservations protect shared editable state and terminal sessions, without claiming live presence or implementing named units. See `docs/ACCOUNTS.md` for configuration, security boundaries and test fixtures.

### Production worker boundary

`server/workers.js` is the common launcher for structured agents, setup, installs, preview servers, provider RPC, terminals and screenshots. Production startup proves a real Bubblewrap namespace and kernel cgroup limits before listening. Each worker sees its selected working copy and public tools, with read-only Git metadata; only agent/provider/terminal workers receive their member's private model home. The trusted app performs Git publication. A bounded FIFO admission queue reserves at most 2048 MiB across workers, with per-class concurrency, memory, CPU, task and lifetime ceilings. Worker scopes bind to the app user service, and shutdown/cancellation stops descendants before capacity is released.

`server/project-files.js` verifies opened Linux descriptors and bounds reads when the app handles project-controlled files. Static previews stream verified descriptors. Worker networking remains shared with the host; this is a process/filesystem boundary, not network isolation. Development uses direct processes, while production has no direct fallback. See `docs/WORKERS.md` for precise mounts, limits, terminal lifetime/Git differences, disk controls, backup requirements and required Linux validation.

### Existing implementation

The current milestone runs locally on one machine (or in the NixOS demo VM) and requires no production hosting services:

```text
Browser
  ├── HTTP: Dialogue UI, /api/*
  ├── SSE:  /api/workspaces/:id/events  (change / runner → reload or status)
  ├── WS:   /ws/terminal/:id            (xterm.js ↔ ttyd, byte-for-byte)
  └── HTTP+WS: <token>.preview.localhost:<port>   preview origin per workspace (iframe)
        ↓
Dialogue Node server (server.js)
  ├── server/git.js           bare repos, refs, worktrees, Draft/Edited/Version commits, push check
  ├── server/deploy-key.js    per-project SSH deploy key, push URL, known_hosts
  ├── server/watch.js         fs.watch on worktree + git dirs → SSE fan-out
  ├── server/recipe.js        parses .dialogue/preview.json
  ├── server/runner.js        install + dev server per workspace (Runner, RunnerPool)
  ├── server/preview-proxy.js preview origins: proxy to dev server / serve static root
  ├── server/live-preview.js  runner + proxy + SSE `runner` events + branch screenshots
  ├── server/setup.js         preview setup pipeline (omp -p → recipe → validate → commit)
  ├── server/preview.js       headless-Chromium screenshots of a preview URL, cached
  ├── server/agent-auth.js    AI model readiness, model choice, web sign-in
  ├── server/figma.js         bounded read-only Figma file/node API, server-only token
  ├── server/requests.js      persisted comments, agent runs, local edit snapshots
  └── server/terminal.js      ttyd lifecycle per branch workspace, prompt injection
        ↓
.dialogue-data/
  ├── db.json                       projects (schemaVersion 4), see server/projects.js
  ├── repos/<slug>.git              bare mirror, git fetch --prune origin
  ├── workspaces/<slug>/<ref>/      one git worktree per opened ref
  ├── requests/<slug>/*.json       durable per-workspace comment/run records
  ├── requests/.figma-snapshots/  temporary design JSON for an active agent run
  ├── keys/<slug>, <slug>.pub       deploy key per project; keys/known_hosts
  ├── previews/<slug>/<sha>.png     screenshots per commit, plus main.png
  ├── setup/<slug>/                 preview setup: log.txt, tree/ (detached worktree), stamps/, shot.png
  ├── stamps/<slug>/<ref>/          install stamp per workspace (install.sha)
  ├── agent.json                    selected model
  └── home/                         omp profile + credentials (VM only)

per branch workspace:
  ttyd (UNIX socket) → omp/attach.sh
    └── tmux -L dialogue new-session -A -s dialogue-<hash>-<checksum> -c <worktree>
          └── omp --config omp/config.yml --append-system-prompt omp/system-prompt.md

per viewed workspace with a server recipe:
  /bin/sh -c "<start>"   own process group, PORT=<free port> HOST=127.0.0.1
```

This deliberately avoids an early framework/database/hosting migration while the product behaviour is still being discovered.

### Git store

`db.json` (schemaVersion 4, `server/projects.js`) holds projects only: `{ slug, createdAt, repo: { url, host, owner, repo }, previewSetup: { status, attempt, error, finishedAt } }`. The slug is `<owner>-<repo>` so it is unique per repository and stable for the `repos/`, `workspaces/`, `keys/` and `setup/` paths; the display name is computed at read time (`repo`, or `owner/repo` when two projects share a repo name). `previewSetup.status` is `queued`, `running`, `waiting-for-agent`, `ready` or `failed` (see [Preview setup pipeline](#preview-setup-pipeline)). Schema-2 and schema-3 files are migrated in place by rebuilding each record from its URL: v3's detected `prototypePath` is dropped and every migrated project gets its preview setup queued. Nothing is hardcoded: projects are added from the Projects page by pasting a repository URL (HTTPS or SSH), and `DIALOGUE_SEED` names a JSON list of `{ url }` entries (`seed.json` in the repo lists Landline; the NixOS module writes one from `services.dialogue.seedProjects`) that is merged in on every start for entries not present yet. Adding a project clones the mirror synchronously so a wrong address fails in the dialog, then queues the preview setup. An SSH URL is used for fetching as well as pushing, so a private repository shows the connect panel on its project page until the deploy key is registered (its setup starts once the mirror exists); an HTTPS URL to a private repository fails with a hint to use the SSH address instead.

Per project, `server/git.js` maintains a bare clone at `repos/<slug>.git`, fetched on demand when refs are listed. Fetch failure is not fatal: the last local refs are returned together with a `fetchError` so the UI keeps working offline. A bare clone leaves a clone-time copy of every branch under `refs/heads`; such a copy is not treated as local work. Opening a branch whose local ref has nothing that origin lacks fast-forwards it to origin first, so a workspace starts current.

### Preview recipe

Dialogue does not guess where a prototype lives. Each repository describes its own live preview in a committed recipe, `.dialogue/preview.json` (parsed by `server/recipe.js`):

```text
{
  "version": 1,
  "kind": "static" | "server",
  "root": ".",
  "install": "npm ci",
  "start": "npm run dev -- --host 127.0.0.1 --port $PORT",
  "entry": "/",
  "reload": "dialogue" | "self",
  "readyTimeoutSeconds": 120
}
```

`static` serves plain files from `root` (`entry` `/` means `index.html`) with no process; `server` runs `install` (optional) and a `start` command that must listen on `$PORT`. `reload` is `self` when the dev server reloads the page itself (Vite, Next, webpack dev server), else `dialogue`, meaning Dialogue reloads the iframe on file changes. `readyTimeoutSeconds` (1–1800, default 120) bounds startup. `ProjectRepo.readRecipe()` picks the recipe for a workspace: the worktree's own file (even uncommitted) wins; otherwise the local default branch's when it carries commits origin lacks (the unpushed recipe commit); otherwise origin's default branch.

### Preview setup pipeline

`server/setup.js` (`PreviewSetup`) produces the recipe with the agent and proves it works. A setup job runs after a project is added, at server start for projects whose setup is `queued`, `running` or `waiting-for-agent`, and on Retry. Jobs run one at a time (installs are heavy).

1. **Workplace.** The job works in the open default-branch workspace if there is one (so its branch is not moved underneath it), else in a persistent detached worktree at `setup/<slug>/tree`, checked out at the local default branch when it has local work, else at `origin/<default>`. The tree is kept between runs so ignored files such as `node_modules` survive and repeat installs are cheap.
2. **Existing recipe.** A recipe already in the repository is validated before any agent run; if it works, setup succeeds without the agent.
3. **Plain HTML fast path.** With no recipe and no `package.json` anywhere, `guessStaticRecipe` (`server/recipe.js`) proposes a static recipe for `prototypes/app`, else the shallowest `index.html`. If it validates, setup succeeds in seconds without the agent or a connected model.
4. **Agent gate.** Only now is `AgentAuth` asked for readiness. Not ready → status `waiting-for-agent` with the reason; the job resumes when `AgentAuth` emits `ready` (after a sign-in).
5. **Agent run.** `omp -p --approval-mode yolo --config omp/config.yml <model args> <omp/preview-setup-prompt.md>` in the workplace, 10 min timeout, with the repository's `.env` moved aside while it runs (omp loads `.env` from its cwd and a client key there must not override the connected model). The prompt describes the recipe format and forbids other changes and commits.
6. **Validation.** Dialogue parses the recipe, starts it with a `Runner` exactly as a workspace would, and screenshots it through a temporary preview origin, then stops it. A failure is `{ step, exitCode, message, log }` with step `recipe`, `install`, `start`, `ready`, `screenshot` or `agent`.
7. **Retry.** Up to 3 attempts; each retry prompt carries the failed step, exit code, the recipe as written and the tail of the output. If the agent itself exits non-zero and a forced readiness re-check says the model is gone, the job parks as `waiting-for-agent` without consuming the attempt. After the last failed attempt the status is `failed` with a one-line reason.
8. **Success.** `git commit -- .dialogue/preview.json` with the message "Add Dialogue preview recipe". In the setup tree the local default branch is then moved to that commit with a compare-and-swap `update-ref` and its upstream set to origin, so the recipe goes out with the user's next COMMIT/PUSH; nothing is pushed by the pipeline. The validation screenshot is copied to the origin sha, the local sha and `main.png`. Status `ready`, and `PreviewSetup` emits `ready` so workspaces opened during the setup start their preview. The project and workspace pages poll/say "setting up" meanwhile.

Everything the job and its runners print is appended to `setup/<slug>/log.txt` (`GET /api/projects/:slug/setup/log`). A failed card offers Retry, **Fix with agent** (opens the default-branch workspace and types `omp/preview-fix-prompt.md` — failure, log path, recipe format — into its terminal; the setup is marked `ready` as soon as that workspace's preview reaches `ready`) and Show log.

`refresh(slug)` keeps the project card current without the agent: when origin's default branch has moved to a commit without an image, the setup tree is checked out there (with the local recipe copied in if origin does not have it yet), validated and screenshotted.

### Live preview

`server/runner.js` runs one workspace's recipe. `static` starts no process; the proxy serves `root` directly. `server` runs `install` only when the stamp changes — a sha256 over the install command and whichever of `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock(b)`, `requirements.txt`, `Gemfile.lock` exist, stored as `stamps/<slug>/<ref>/install.sha` — then `start` through `/bin/sh` in its own process group with `PORT` (a free port), `HOST=127.0.0.1`, `BROWSER=none`, `CI=1`. Readiness polls `entry` on both `127.0.0.1` and `::1` with `Host: localhost:<port>` until it answers below 400 or `readyTimeoutSeconds` passes. States: `installing`, `starting`, `ready`, `crashed`, `stopped`; the last 500 output lines are kept. Stopping sends SIGTERM to the group, then SIGKILL after 5 s. `RunnerPool` keys runners by workspace id and stops one 10 min after its last viewer (SSE client) leaves; shutdown stops all.

`server/preview-proxy.js` gives every workspace its own browser origin: `http://<16-hex token>.preview.localhost:<port>/`, or `<token>.<DIALOGUE_PREVIEW_DOMAIN>` behind a real hostname (scheme from `X-Forwarded-Proto`). Requests are routed by their Host header before any Dialogue route is consulted. For a server target, HTTP and WebSocket upgrades (dev-server HMR) are proxied with `Host`/`Origin`/`Referer` rewritten to `localhost:<port>` and `Location` redirects rewritten back to the preview origin; a static target is served from its root with realpath checks so nothing outside it is reachable; otherwise a small auto-refreshing pending or failed page (with the log tail) is shown.

`server/live-preview.js` (`LivePreviews`) ties them together. A workspace SSE client opens the preview: the recipe is read, the runner started or reused, and every state change is sent as an SSE `runner` event `{ state, message, reload, log?, restarted? }`. A missing or invalid recipe is reported the same way (`no-recipe` / `crashed`). A changed recipe restarts the runner; `POST /api/workspaces/:id/preview/restart` does so by hand. Branch screenshots are taken through the preview origin 5 s after the runner becomes ready and 30 s after the last file change, stored under the worktree's HEAD sha (the default branch also writes `main.png`).

### Screenshots

Project cards show the default branch and branch tiles show their commit, as screenshots from `server/preview.js`: `capture(url, files)` runs headless Chromium (`--screenshot`, 370×722, `--virtual-time-budget=5000`) against a running preview URL, one render at a time, and writes the image to every listed file under `previews/<slug>/`. `lookup(slug, sha)` returns the commit's own image, else `main.png` (the latest default-branch image) marked as not exact. `GET /api/projects/:slug/preview/:sha.png` serves an exact image with immutable cache headers and the fallback with `no-cache`; refs carry `previewUrl` and `previewExact`, and tiles without an exact image carry a "from main" label. Listing projects triggers a background `refresh` when origin's default branch has no exact image. Images come from the setup pipeline, from open workspaces and from refresh — never from a checkout of an arbitrary commit — so a branch nobody has opened shows the main image. Cached shas no longer referenced are pruned after each refs listing. Chromium comes from `DIALOGUE_CHROMIUM`, `PUPPETEER_EXECUTABLE_PATH`, PATH, or the macOS Chrome bundle; without one, previews still run but cards show the initials badge and tiles a blank device. The devshell and the NixOS module provide `pkgs.chromium`.

### Worktree per ref

A workspace is a git worktree at `workspaces/<slug>/<encodeURIComponent(ref)>/`. Its id is `<slug>/<encoded ref>`. `git worktree list --porcelain` on the bare repo is the source of truth; there is no workspace table.

- Branch: `git worktree add <dir> <branch>`, with a local tracking branch created from `origin/<branch>` on first open. Writable; gets a terminal.
- Tag or commit: `git worktree add --detach <dir> <sha>`. Read-only preview; no terminal.

Deleting a workspace stops its terminal and preview server and runs `git worktree remove --force`. Creating one is idempotent.

### Terminal process

One ttyd per branch workspace, started lazily by `server/terminal.js` on the first WebSocket client. ttyd listens on a UNIX socket under the system temp directory, so no TCP port is ever opened. ttyd runs `omp/attach.sh` for every client; the script checksums the `omp/*` overlay files, kills stale sessions for the workspace, then `tmux -L dialogue new-session -A -s dialogue-<workspace>-<checksum>` attaches to the existing session or creates one in the worktree running `omp`. Editing anything under `omp/` and reconnecting therefore starts a fresh omp with the new settings. tmux therefore keeps the agent session alive across tab closes, reconnects and Dialogue restarts; ttyd itself is a child of Dialogue and is killed on shutdown.

Before spawning, `omp/dialogue-theme.json` is copied into the active omp profile's themes directory (`~/.omp/agent/themes`, or `~/.omp/profiles/<OMP_PROFILE>/agent/themes`) when missing or changed, so the developer's own omp credentials and settings are used. Binaries come from PATH, overridable with `DIALOGUE_OMP`, `DIALOGUE_TTYD`, `DIALOGUE_TMUX`, `DIALOGUE_GIT`. A missing binary, or a ttyd that exits before its socket accepts connections, closes the WebSocket with code 1011 and a `{ error }` JSON reason that the UI shows in the pane.

### Watcher and SSE

`ProjectRepo.watchRoots()` decides what to watch: the worktree's top level (non-recursive), every top-level directory that is neither a dot directory nor git-ignored (recursively; `.dialogue` is kept so a rewritten recipe is noticed), the worktree's git dir and the mirror's remote-tracking refs. Ignored directories such as `node_modules` and build output are therefore never walked. `server/watch.js` runs those `fs.watch`es, debounced 150 ms, and fans out a `change` event with `{ head, dirty, ahead, files }` to every SSE client of that workspace; `files` is `false` when only git state moved. The workspace page updates the status chip on each event and reloads the iframe on file changes only when the recipe's `reload` is `dialogue` (a `self` dev server reloads the page itself). File changes also go to `LivePreviews`, which restarts the runner when the recipe changed and otherwise schedules the branch screenshot. The same SSE stream carries the `runner` events described above.

### WebSocket proxy

`server.js` handles the HTTP upgrade for `/ws/terminal/:id`, ensures the workspace's ttyd is running, and proxies the socket byte-for-byte to its UNIX socket. The browser never talks to ttyd directly. Upgrades addressed to a preview origin are handed to the preview proxy first (dev-server HMR). In the VM nginx proxies WebSockets to the Node port with buffering off and a 1 h read timeout, passes the browser's `Host` (`$http_host`) and `X-Forwarded-Proto`, and lists `*.preview.localhost` (plus `*.<previewDomain>`) as server aliases so preview origins reach Node.

## Data model direction

Core concepts remain:

- users
- projects (with git source)
- workspaces (branch/tag/commit checkouts)
- share links
- agent connections
- Figma design references
- comments/review annotations
- revision requests

The local build implements projects, workspaces, persisted review requests, private Edited snapshots and numbered Versions. A "prototype variant" is a branch. Git commits identify immutable snapshots and published versions; the current Draft stays in the writable worktree.

## Publishing

Saving a Version snapshots the current Draft, pushes the branch commit and a numbered tag to the remote (GitHub or any git host), then exposes the Version in Activity. A pull request remains the external review artifact. Earlier Edited snapshots stay local unless their file changes are included in the Draft being saved.

### Deploy keys

Fetching keeps using the project's HTTPS URL so browsing a public repository needs no setup. Pushing goes over SSH: `server/deploy-key.js` generates an ed25519 key per project on first use (`keys/<slug>`), records the host's SSH key with `ssh-keyscan` in `keys/known_hosts`, and `ProjectRepo.ensure()` sets `remote.origin.pushurl` (`git@host:owner/repo.git`) and `core.sshCommand` (`ssh -i <key> -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=<known_hosts>`) on the bare mirror. Worktrees inherit both, so `git push` works for the agent in the terminal as soon as the public key is registered as a deploy key with write access. GitHub allows one deploy key per repository, which is why the key is per project. The bare repo also gets a fallback `user.name`/`user.email` when no global identity exists (VM).

### Activity and Save version

Each completed comment run that changed files writes an immutable commit from a disposable Git index and keeps it at `refs/dialogue/edits/<branch>/<requestId>` in the local bare mirror. Its feedback, anchor, timestamp and SHA are persisted in `requests/<slug>/*.json`; no-change and failed runs remain execution records only. The Draft is the live branch/worktree. Clicking Edited or Version opens its SHA in a read-only worktree, with Activity still sourced from the branch and Draft returning to the live workspace.

`POST /api/workspaces/:id/versions` checks the deploy key with `git ls-remote <pushurl>` (success cached 60 s); an unregistered key opens the connect panel. Dialogue assembles a commit for the current Draft without staging into the user's index or publishing private edit refs. It pushes the commit to `refs/heads/<branch>` and the new `refs/tags/dialogue/<branch>/Vn` atomically with a remote-head lease. Only a confirmed remote branch/tag creates a visible Version. A rejected push retains a private pending ref for retry; if the Draft changes before retry, the pending commit is replaced with the current tree. After success the local branch/upstream advance, but earlier Edited snapshots remain private. Git hosts without atomic pushes cannot publish a Version through this route.

`design comment → private Edited snapshot + live Draft → reviewed Draft → numbered Version on remote → PR`

## Prototype isolation

### Local development

Each workspace's preview runs on its own browser origin (`<token>.preview.localhost:<port>`, or `<token>.<DIALOGUE_PREVIEW_DOMAIN>`), served by `server/preview-proxy.js`, so prototype JavaScript cannot read Dialogue's cookies, storage or DOM. Preview hosts never reach Dialogue's own routes. Because the origin already differs, the iframe sandbox includes `allow-same-origin` (with `allow-scripts`, `allow-forms`, `allow-modals`, `allow-popups`, `allow-downloads`) so dev servers, storage and HMR work normally. `*.localhost` names resolve to loopback in browsers without DNS setup; a real deployment needs wildcard DNS (and a wildcard certificate for HTTPS) for `previewDomain`.

The remaining gap is process isolation: preview servers, installs and the agent all run with the same privileges as the Dialogue process. That is acceptable only on a single developer's machine or the single-user VM.

### Production requirement

Checked-out/generated prototype JavaScript must execute on a separate origin from authenticated Dialogue. Matt selected `https://build.idealogue.studio` for the app on 2026-10-21. `preview.idealogue.io` is the planned namespace for future public prototypes, with separate origins such as `<share-id>.preview.idealogue.io`; it is not yet a configured preview deployment. Matt manages DNS at iwantmyname; wildcard certificate automation still needs validation or delegated ACME DNS validation. The existing `services.dialogue.previewDomain` setting supports per-token preview subdomains and needs wildcard DNS/TLS. Live working previews and published public shares have different lifecycles and authorization; setting this option alone does not implement public sharing.

The local preview origins already follow the separate-origin shape. Production additionally needs the preview processes and the agent sandboxed away from Dialogue's data directory and credentials.

## Public Share shell

The existing product direction remains to keep the public Share shell HTML/CSS-only where practical, while the prototype framed inside it may contain JavaScript.

Public sharing is not part of the current lightweight local milestone.

## Agent integration

The agent (`omp`) runs inside the branch checkout with an ordinary shell, git and the repository's own tooling. Dialogue supplies the working directory, a profile, a config, an appended system prompt (`omp/system-prompt.md`) and a theme; it does not mediate the agent's file access. This replaces the earlier model where an external LLM connected to Dialogue through a tool layer and Dialogue re-packaged the result.

Structured Create and review-comment requests can attach a Figma design/file URL. `server/figma.js` reads the actual file outline or selected node with a server-only token before the request starts; `server/requests.js` stages bounded JSON outside the checkout for the agent and offers capability-scoped, short-lived reads of deeper nodes in the same file. Nodes with SVG/PNG `exportSettings` in the supplied or inspected data can be rendered and downloaded by the agent while the request runs. The render URL is restricted to Figma's asset hosts and the binary is bounded before delivery; the agent chooses whether to add an asset to the checkout. The capability stays in the agent prompt, not the durable request record or SSE. The Figma token is removed from the server's process environment before any Git hook, terminal, agent or preview subprocess can inherit it.

Richer context such as design/prototype screenshot crops and direct annotation on a Figma canvas remains future work. The agent remains replaceable: anything that can run against a branch checkout fits.

### Agent sign-in

omp needs a signed-in model provider before it can do anything, and a designer must be able to get there without a terminal. `server/agent-auth.js` (`AgentAuth`, one instance in `server.js`) owns three things. **Readiness:** `check()` runs `omp token <provider>` for the selected model's provider (stored credential or environment key), then a live `omp -p --config omp/config.yml … "Reply with exactly: OK"` from an empty temporary directory (omp auto-loads `.env` from its cwd, so the probe must not run in a project) with a 60 s timeout; ready iff exit 0 and the answer contains `OK`. Failures are classified from omp's output into `not-connected`, `rejected`, `quota`, `unreachable` or `unknown`; success is cached 10 min, failure never, concurrent callers share one probe, and the `ready` event fires when the state flips: the preview setup pipeline checks readiness before every job, parks projects as `waiting-for-agent` while no model works, and resumes them on that event. A check runs at server start and after every sign-in. **Model selection:** `<data>/agent.json` `{ model }`, default `omp/config.yml`'s `modelRoles.default`; `ompArgs()`/`ompEnv()` are what every omp spawn must include, and `server/terminal.js` passes them to `omp/attach.sh` as `DIALOGUE_OMP_ARGS`, which is part of the tmux session checksum so a model change rotates the session. **Web sign-in:** `POST /api/agent/login` spawns `omp --mode rpc` and sends omp's own `login` command, i.e. exactly what `/login` does, so credentials land in `~/.omp/agent/agent.db`. omp's `open_url` / `notify` / `input` UI requests become SSE events and the pasted redirect address or code is answered with an `extension_ui_response`. Because omp refuses to start rpc mode with no usable model — precisely the state before the first sign-in — rpc children load `omp/bootstrap-provider.js` with `-e`, an extension registering a placeholder provider on a closed port; nothing is written to the user's `models.yml`. After signing in to a provider that cannot serve the current model, the first sensible chat model of that provider (`get_available_models`) becomes the selection; Settings lets the designer change it.

The browser side is `js/agent-connect.js`: the Settings page's "AI model" section (status, provider list with a curated top five, sign-in steps, always-visible paste box, model picker, "Check again") and a "Connect an AI model to continue" banner that opens the same flow in a modal on the Projects page. The provider's page opens in a new tab from `url` (never `launchUrl`, which is a localhost shortcut valid only on the server's machine); when the browser runs on another machine the OAuth redirect to `localhost:<port>` fails and the designer pastes the address they land on, which is the path the end-to-end test drives. Plain API-key providers go through the same two steps in omp 18.2.10 (`open_url` to the provider's docs, then an `input` prompt for the key); only prompts omp marks `secret` are refused by its rpc mode, and that error is shown verbatim.

## Development path

Completed and superseded:

1. Landline V22 imported through Dialogue's UI and run
2. the same ingestion path exercised by an external API client (V23)
3. an external-agent adapter proved reads plus additive publishing (V24)

Current:

4. git-backed workspaces with an embedded omp terminal and live preview
5. first real designer-driven change: open a Landline branch, ask omp, watch the preview reload, commit, push, PR
6. use observed friction to decide what context the agent and the designer need

Only after this loop is useful should production hosting/database/auth/storage decisions be finalized.

## Design/prototype review context

Dialogue should eventually act as a context broker between the designer, Figma, the rendered prototype and the connected agent.

A review annotation may include:

- Figma file/node IDs
- project ID
- branch and commit
- DOM selector or stable element reference
- coordinates
- viewport width/height
- screenshot/render crop
- comment text
- surrounding project metadata

The side-by-side comparison surface is therefore both a visual viewer and a structured context-capture surface.

## Intended closed loop

Long term:

1. Dialogue displays a Figma design beside a live prototype branch.
2. The designer comments on a specific design/prototype element.
3. Dialogue captures the comment plus structured context.
4. Dialogue hands that request to the agent working in the branch.
5. The agent reads additional project context as needed.
6. The agent commits the change; the preview reloads.
7. The designer reviews and pushes / opens a PR.
8. Earlier commits and branches remain available for history/rollback.

## Current production direction

The original managed proposal — Vercel + Supabase + Cloudflare R2 — remains technically valid, but after reviewing the expected real scale with Idealogue's lead developer it is no longer the default recommendation for this version.

Dialogue is expected primarily to serve Matt, Saori and a small number of clients. There is no requirement to future-proof this web application for thousands of users.

On 2026-11-02 Matt chose BinaryLane and its smaller Standard plan (2 vCPUs, 4 GB RAM, 60 GB storage) for the initial private pilot, with Melbourne proposed as the location. DigitalOcean was rejected because of signup CAPTCHA friction. This is a hosting choice, not a completed deployment or a validated capacity measurement.

The implementation route remains a small self-hosted host running the NixOS module (`nix/module.nix`): a systemd unit with data in `/var/lib/dialogue`, nginx in front, `omp` from the `llm-agents` flake input. Postgres only if a real multi-user need appears; the git store is already durable on disk.

Important production details:

- production and testing data should still be separated sufficiently to avoid accidental destructive testing
- protect the app from build/agent resource exhaustion on the 4 GB pilot using global concurrency limits and per-worker resource limits; measure real workloads before claiming the size is sufficient
- validate the Linux package/service and preview tools on the target OS; a successful macOS package build does not establish target compatibility
- prototype runtime uses a separate origin: set `services.dialogue.previewDomain` with wildcard DNS and certificate so previews work from other machines (`*.preview.localhost` only works when the browser is on the host or reaches it through a forwarded localhost port)
- preview servers run each project's own `install`/`start` commands (arbitrary code from the repository and its dependencies) as the Dialogue user; they need the same sandboxing as the agent
- account membership now protects the terminal upgrade; process/filesystem isolation for agents and preview code still needs deployment work
- repos/worktrees/home live on the host filesystem; storage calls should remain behind `server/git.js` so the layout can move
- automated off-server backups are mandatory if the data lives on one host
- agent credentials (`/login`) live in the service home directory; git push uses the per-project deploy key under `keys/`, which is unencrypted on disk and readable by the agent process, so the data directory must be treated as secret

The final production choice should be revisited after the branch → agent → preview → PR loop has been dogfooded.
