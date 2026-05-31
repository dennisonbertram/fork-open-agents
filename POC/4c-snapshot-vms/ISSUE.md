<!-- TITLE: feat: persistent/snapshottable sessions — hibernate & resume where you left off -->

## Why this matters

Sandboxes are ephemeral with idle teardown today, so any session that goes idle loses its environment and cold-rebuilds from scratch: the installed toolchain, the running dev server, build caches, and — most painfully — uncommitted/untracked work in the git working tree all vanish. Three groups feel it: anyone returning to a paused task (a cold rebuild, and any in-flight uncommitted state gone), long/multi-day tasks (a large refactor or migration simply can't persist between bursts), and the expensive-setup profiles from 4b (Rust ~4 min, Docker minutes) that are the worst to rebuild on every teardown. POC 4c (PR #90) burned down the feared-hard part: **Vercel persistent sandboxes are GA**, `persistent: true` is the default, stopping auto-snapshots the filesystem, resuming boots a new session from it, and restore is **sub-second on cache hit** (p75 40s → sub-second). The remaining work is **orchestration** — driving the lifecycle state machine and relaunching services on resume — which the POC proved sound (30/30 eval assertions, byte-exact filesystem restore including the git working tree, correct `relaunchOnResume` contract, a multi-day task surviving two hibernate/resume cycles). This issue scopes the production build: the resume path in `evaluateSandboxLifecycle`, service relaunch via the `onResume`/`afterStart` hook, transparent "resume where you left off" UX with lifecycle/hibernation indicators, retention governance, and the gated real-sandbox proof.

## User/operator path protected

The pause-and-resume and multi-day-task path: a user steps away from a session (toolchain installed, dev server running, uncommitted edits in the working tree); the session hibernates (snapshots its filesystem, tears down the live sandbox to stop compute billing); on the user's next request it resumes from the most recent snapshot — files, git working tree (staged/unstaged/untracked), and caches byte-identical, `relaunchOnResume=true` services relaunched with a fresh pid, `relaunchOnResume=false` services left stopped. Operators must be able to attribute every hibernate/resume to `userId`/`sessionId`/`sandboxName`/`snapshotId`, see the lifecycle transition trail, confirm retention/GC behavior, and know when a long-idle session was GC'd (cold-rebuild expected, not a silent surprise).

## Behavior contract

- Given an active session whose idle deadline passes with no active workflow stream, When `evaluateSandboxLifecycle` runs, Then it transitions `active → hibernating → hibernated`, snapshots the filesystem via `session.snapshot()`, and stops the live sandbox.
- Given a hibernated session, When the user's next request arrives, Then it transitions `hibernated → restoring → active`, boots a new session from the most recent snapshot by durable name, and `buildActiveLifecycleUpdate` writes `lifecycleState = active`.
- Given a resumed session, When restore completes, Then the filesystem (including the git working tree: staged, unstaged, and untracked changes) is byte-identical to pre-hibernation.
- Given services existed at hibernation, When the session resumes, Then every `sandboxServices` row with `relaunchOnResume = true` is relaunched with a new pid, and every row with `relaunchOnResume = false` stays `stopped` with `pid = null`.
- Given a multi-day task, When it spans more than one ≤5h burst, Then it is modeled as N sessions over one durable sandbox name with hibernate between bursts, and working state carries forward across each resume.
- Given an active stream arrives mid-hibernation, When the abort edge fires, Then `restoreActiveLifecycleState` returns the session to `active` and hibernation is skipped (per the existing `active-workflow` guard).
- Given a discarded or retention-expired snapshot, When a resume is attempted, Then the resume is rejected and the session cold-rebuilds from a fresh sandbox (the lifecycle machine rejects resuming a discarded snapshot).
- Given an illegal lifecycle transition (e.g. `active → hibernated`, or any move out of terminal `archived`), When attempted, Then the lifecycle machine throws rather than silently transitioning.

## Product and design spec

### UX — how users use it & how it's exposed

Mostly **invisible** — the point is that resume "just works." The surfacing is lightweight **session lifecycle indicators**: a session in the list shows **Active / Hibernating / Hibernated / Restoring**; reopening a hibernated session shows a brief "Resuming where you left off…" instead of a cold start. Settings expose **retention controls** (how long hibernated sessions are kept) and, for multi-day work, the session communicates that it checkpoints and hibernates between ≤5h bursts. The transparency principle is that the user never wonders whether their work survived — the hibernated badge reassures ("resumes instantly, last active 2h ago"), and the expiry case is communicated ("Session expired — will rebuild fresh on reopen") so a cold rebuild after retention is expected, not a silent surprise.

### UX — how the feature demonstrates & explains its value to the user

The value is made obvious by **resuming a multi-day task instantly**: the user steps away mid-task with uncommitted edits and a running dev server, comes back hours (or days) later, and the environment is intact — dev server up, caches warm, uncommitted edits preserved — instead of a cold rebuild and lost work. On expensive profiles (4b's Rust/Docker) the payoff is dramatic: a ~4 min cold start becomes a sub-second resume. The "Resuming where you left off…" affordance on reopen, and the "Day 2 — resumed from yesterday" marker on a long task, make the otherwise-invisible persistence legible exactly at the moment the user would otherwise expect to lose their work.

### UX — how it's clear what the feature is doing (states & feedback)

Every lifecycle state is surfaced:

- **Active** — normal running session.
- **Hibernating** — brief transient ("Saving your session…") as the snapshot is taken on idle; the user can leave.
- **Hibernated** — in the session list, a "Hibernated — resumes instantly" badge with last-active time and (optionally) "expires in N days" from the retention policy.
- **Restoring** — on reopen, "Resuming where you left off…" with the service-relaunch step visible if it takes a beat ("Restoring files ✓ · Relaunching dev server…"); on a cache hit this is sub-second and barely shown.
- **Active (resumed)** — back to work; files and git working tree byte-identical, `relaunchOnResume` services back up with fresh process state.
- **Multi-day / checkpointed** — a long task shows it has hibernated and resumed across bursts ("Day 2 — resumed from yesterday"), making the ≤5h-per-burst reality legible.
- **Expired / GC'd** — a long-idle hibernated session past retention shows "Session expired — will rebuild fresh on reopen."

### UX — how to test the UX, including regressions

Concrete plan:

- **Hibernate→resume continuity smoke**: with a session holding a mixed git working tree (committed + staged + unstaged + untracked + executable-mode + binary) and two services (`dev_server` with `relaunchOnResume=true`, `code_editor` with `relaunchOnResume=false`), drive hibernate then resume and assert the working tree is byte-identical (`git status --porcelain` unchanged), the `dev_server` is relaunched with a new pid, and the `code_editor` stays stopped (`pid = null`) — mirroring the POC's 30/30 eval.
- **Lifecycle indicator smoke**: assert the session list renders the correct badge per state (Active/Hibernating/Hibernated/Restoring) and that reopening a hibernated session shows "Resuming where you left off…".
- **UX regressions to lock down (fail-before/pass-after)**: (1) an illegal transition (e.g. `active → hibernated`) must throw, not silently succeed — add a failing guard test; (2) resuming a discarded/expired snapshot must surface the "rebuild fresh" path rather than appear to resume — assert the expired-snapshot copy; (3) a `relaunchOnResume=false` service must never be silently relaunched on resume — assert it stays stopped.

## Integration spec

- **Native persistence, not a custom provider**: `packages/sandbox/vercel/sandbox.ts` already passes `persistent: true` and implements `snapshot()` via `session.snapshot()` (`:1031`, which "automatically stops the sandbox"); `packages/sandbox/interface.ts` declares `snapshot(): Promise<SnapshotResult>` (`:166`) returning a native `{ snapshotId }`. Adopt the v2 `getOrCreate` / `get({ name })` + `onResume` model for resume.
- **Lifecycle orchestration**: `apps/web/lib/sandbox/lifecycle.ts` `evaluateSandboxLifecycle` (`:170`) already drives `active → hibernating → hibernated` via `sandbox.stop()`. Add the **resume path** (`hibernated → restoring → active`) on the next user request, using `buildActiveLifecycleUpdate` (`:94`) to write `lifecycleState = active`; the `active-workflow` abort edge (`restoreActiveLifecycleState`, `:153`) is preserved. The `SandboxLifecycleState` union (`:19`) is exactly `provisioning | active | hibernating | hibernated | restoring | archived | failed`.
- **Session lifecycle fields (no schema change for the core path)**: `apps/web/lib/db/schema.ts` already has `lifecycleState` (`:263`), `lifecycleVersion` (`:274`), `lastActivityAt` (`:275`), `sandboxExpiresAt` (`:276`), `hibernateAfter` (`:277`), `sandboxState` JSONB durable name (`:249`), and `snapshotUrl`/`snapshotCreatedAt`/`snapshotSizeBytes` (`:289`–`:291`). (Optional: a `currentSnapshotId` column if rolling back to a specific snapshot via `sandbox.update({ currentSnapshotId })` is desired.)
- **Service relaunch**: on resume, query `sandboxServices` for the session (`apps/web/lib/sandbox/runtime/service-records.ts`) and relaunch rows with `relaunchOnResume = true` (`schema.ts:355`) using the existing launcher (`apps/web/lib/sandbox/runtime/service-launch.ts`, which sets `relaunchOnResume: true` at `:689`). Wire this into the Vercel `onResume` hook (or the existing `afterStart` hook in `packages/sandbox/interface.ts`). Rows with `relaunchOnResume = false` stay `stopped`.
- **Retention / GC**: set `keepLastSnapshots: { count: 1 }` and a sensible `snapshotExpiration` so storage stays flat; a long-idle session GC'd by the 30-day-from-last-use default cold-rebuilds and the UX communicates expiry.
- **Flush before stop**: use the existing `beforeStop` hook in `packages/sandbox/interface.ts` to flush in-memory/unflushed state to disk before hibernation, since only the filesystem survives.

## In scope

- Add the resume path (`hibernated → restoring → active`) to `evaluateSandboxLifecycle`, adopting `getOrCreate`/`get({ name })` + `onResume`.
- Service relaunch on resume for `relaunchOnResume = true` rows via the existing launcher and the `onResume`/`afterStart` hook; leave `false` rows stopped.
- Session lifecycle indicators + the "Resuming where you left off…" affordance + retention controls in settings.
- Retention/GC governance (`keepLastSnapshots: { count: 1 }`, `snapshotExpiration`) and the expired-session UX.
- `beforeStop` flush-to-disk wiring for state that must survive hibernation.
- The gated **real-sandbox** hibernate/resume proof per the Managed Runtime Proof Standard.
- Regression harness: hibernate→resume continuity smoke, lifecycle-indicator smoke, illegal-transition guard, expired-snapshot path, `relaunchOnResume=false`-stays-stopped.

## Out of scope

- The agent-runtime work to make the agent loop fully checkpointable/resumable across mid-task hibernation — a real, separate workstream this issue depends on but does not own (the lifecycle plumbing here tolerates it; the agent loop must be made resumable elsewhere).
- A custom reconstruct-from-archive provider — kept only as the documented degraded fallback (the POC's `fake-provider.ts` already prototypes it); the production path is native persistence.
- Multi-region persistence — `iad1`-only is a known platform constraint, not addressed here.
- Surviving running processes / in-memory state — structurally impossible (only the filesystem is snapshotted); services must be idempotent on relaunch.
- Snapshot rollback UI (`currentSnapshotId` history) beyond the optional column note.
- 4a desktop resume and 4b install amortization are compounding benefits realized by their own slices; this issue only provides the resume primitive they ride.

## Research and context sources

- POC PR #90 and the `POC/4c-snapshot-vms/` folder (this branch): `README.md`, `PRODUCT-BRIEF.md`, `src/{lifecycle,provider,fake-provider,service-records,orchestrator,fidelity,eval}.ts`, `src/lifecycle.test.ts`.
- POC eval evidence (30/30 assertions + 6/6 guard tests): `evidence/00-eval-output.txt`, `01-lifecycle-transitions.json` (the full `provisioning → active → hibernating → hibernated → restoring → active → … ` trail across two cycles), `02-fs-manifest-pre-snapshot.txt` / `03-fs-manifest-post-resume.txt` (byte-exact `rootHash` match), `04-git-working-state.txt` (staged/unstaged/untracked intact), `05-snapshot-cost.json`, `06-state-machine-guards.txt` (illegal transitions + discarded-snapshot rejected).
- README findings (cited): **Vercel Sandbox snapshot is GA** — native filesystem snapshot, `persistent: true` default, automatic resume, **sub-second on cache hit** (p75 40s → sub-second, p95 50s → 5s), snapshots 200MB–few GB, retention default 30 days from last use (`keepLastSnapshots` 1–10), 5h per-session cap on Pro/Enterprise (45 min Hobby), `iad1`-only, `onResume` hook exists explicitly to restart background services (sources: vercel.com/blog/optimizing-vercel-sandbox-snapshots, vercel.com/docs/sandbox/concepts/persistent-sandboxes, vercel.com/docs/sandbox/pricing, the 5h changelog).
- Codebase seams: `packages/sandbox/interface.ts` (`snapshot()`, `onResume`/`afterStart`/`beforeStop`), `packages/sandbox/vercel/sandbox.ts` (`session.snapshot()`), `apps/web/lib/sandbox/lifecycle.ts` (`evaluateSandboxLifecycle`, the state union), `apps/web/lib/db/schema.ts` (lifecycle fields, `sandboxServices.relaunchOnResume` `:355`), `apps/web/lib/sandbox/runtime/{service-records,service-launch}.ts`.
- `docs/process/managed-runtime-proof-standard.md`, `docs/process/feature-ticket-format.md`.

## Agent todo checklist

- [ ] Read `apps/web/lib/sandbox/lifecycle.ts` (`evaluateSandboxLifecycle`, `buildActiveLifecycleUpdate`, `restoreActiveLifecycleState`) and the `onResume`/`afterStart`/`beforeStop` hooks in `packages/sandbox/interface.ts`.
- [ ] Write the failing tests first: hibernate→resume continuity (working tree byte-exact + service relaunch contract), illegal-transition guard, expired/discarded-snapshot rejection, `relaunchOnResume=false`-stays-stopped, lifecycle-indicator rendering.
- [ ] Confirm red on all.
- [ ] Implement the resume path (`hibernated → restoring → active`) in `evaluateSandboxLifecycle` using `getOrCreate`/`get({ name })` + `onResume`.
- [ ] Relaunch `relaunchOnResume = true` services on resume via the existing launcher; leave `false` rows stopped.
- [ ] Wire `beforeStop` flush-to-disk for state that must survive hibernation.
- [ ] Set retention (`keepLastSnapshots: { count: 1 }`, `snapshotExpiration`) and implement the expired-session UX.
- [ ] Build the session lifecycle indicators + "Resuming where you left off…" affordance + settings retention controls.
- [ ] Add lifecycle observability events + typed errors + correlation IDs.
- [ ] Make tests pass; run the adjacent suite, `git diff --check`, and `bun --bun run ci`.
- [ ] Capture the gated real-sandbox hibernate/resume proof (lifecycle transition log + byte-exact restore) per the Managed Runtime Proof Standard.

## Tests to add first

- **Hibernate→resume continuity (red first)**: a session with a mixed git working tree and two services hibernates and resumes; the working tree is byte-identical (`git status --porcelain` unchanged), the `relaunchOnResume=true` service relaunches with a new pid, the `relaunchOnResume=false` service stays stopped with `pid = null`. Fails before the resume path + service relaunch exist.
- **Illegal-transition guard (red first)**: `active → hibernated`, `hibernated → active` (skipping `restoring`), and any move out of `archived` throw. Fails if the machine permits them.
- **Expired/discarded-snapshot rejection (red first)**: resuming a discarded or retention-expired snapshot is rejected and routes to cold rebuild with the "rebuild fresh" UX. Fails before the rejection path.
- **`relaunchOnResume=false`-stays-stopped (red first)**: on resume, a `false` service is not relaunched. Fails if resume relaunches all services indiscriminately.
- **Lifecycle indicator rendering (red first)**: the session list shows the correct badge per `lifecycleState` and reopening a hibernated session shows "Resuming where you left off…". Fails before the indicators.

## Observability and user feedback

- **User-visible status**: per-session lifecycle badge (Active/Hibernating/Hibernated/Restoring), "Resuming where you left off…" on reopen, service-relaunch step, "Session expired — will rebuild fresh on reopen" past retention.
- **Named service**: `sandbox-lifecycle` emits structured events. Examples:
  - `hibernate-started` (info) `{ userId, sessionId, sandboxName, fromState, hibernateAfter }`
  - `snapshot-created` (info) `{ userId, sessionId, sandboxName, snapshotId, snapshotSizeBytes, durationMs }`
  - `resume-started` (info) `{ userId, sessionId, sandboxName, snapshotId }`
  - `service-relaunched` (info) `{ sessionId, sandboxName, serviceId, kind, relaunchOnResume, newPid }`
  - `resume-failed` / `snapshot-expired` (warn) `{ sessionId, sandboxName, snapshotId, errorKind }`
- **Typed error kinds**: `illegal-lifecycle-transition`, `snapshot-failed`, `snapshot-expired`, `resume-failed`, `service-relaunch-failed`, `region-unavailable`.
- **Correlation IDs**: `userId`, `sessionId`, `sandboxName`, `snapshotId`, `lifecycleVersion`, `serviceId`.
- **Redaction**: never log snapshot contents, file bytes, env values, or git diff content; event payloads carry references (snapshotId/serviceId), not data.
- **Grep-able debug recipe**: `grep '"sessionId":"<id>"' logs | grep '"service":"sandbox-lifecycle"'`; for the transition trail `... | grep -E '"event":"(hibernate-started|snapshot-created|resume-started)"'`; for relaunch `... | grep '"event":"service-relaunched"'`.
- **Evidence expectation (Managed Runtime Proof Standard)**: capture the lifecycle transition log from a **real** persistent-sandbox hibernate/resume (the full `active → hibernating → hibernated → restoring → active` trail with snapshotId), plus byte-exact filesystem/git restore proof and the service-relaunch contract — mirroring `POC/4c-snapshot-vms/evidence/01-lifecycle-transitions.json` and `04-git-working-state.txt` against the real platform.

## Regression harness plan

- **Existing coverage**: `apps/web/lib/sandbox/lifecycle.ts` already drives `active → hibernating → hibernated`; the POC's `src/lifecycle.test.ts` proves the machine guards (6/6) and the eval proves the resume contract (30/30) against a fake. No production coverage for the resume path, service relaunch, or indicators.
- **New durable signals**: (1) a lifecycle state-machine guard test (illegal transitions throw; discarded/expired snapshot rejected) ported from the POC; (2) a hibernate→resume continuity integration test (working-tree byte-exact + service relaunch contract) using a fake provider mirroring documented Vercel behavior; (3) a lifecycle-indicator UI smoke; (4) the gated real-sandbox proof.
- **Fixtures**: a session with a mixed git working tree (committed/staged/unstaged/untracked/executable/binary); two `sandboxServices` rows (one `relaunchOnResume=true`, one `false`); a `LocalFakeSnapshotProvider`-style fake mirroring Vercel's snapshot/resume 1:1 (the POC's `fake-provider.ts`).
- **Fail-before/pass-after**: each test fails on `main` (no resume path, no selective relaunch, no indicators) and passes after the slice.
- **Limits not caught**: the fake cannot reproduce real Vercel restore latency, real snapshot-storage GC, the 5h session cap, or Firecracker-specific edge cases; final validation requires the gated real-sandbox hibernate/resume proof, and the agent-loop resumability is a separate workstream the harness does not cover.

## TDD audit trail

- Planned red commit: `test(lifecycle): failing hibernate→resume continuity + illegal-transition guard + expired-snapshot rejection + relaunchOnResume contract + indicators` (observed red).
- Planned green commit: `feat(lifecycle): resume path (hibernated→restoring→active), selective service relaunch on resume, lifecycle indicators + retention` (suite green after red).
- If the real-platform fidelity cannot be asserted pre-merge (credentials/region gating), record the exception and the manual real-sandbox hibernate/resume proof captured in the PR per the Managed Runtime Proof Standard.

## Regression risks and concerns

- **5h per-session cap**: a single uninterrupted compute burst can't exceed 5h (Pro/Enterprise) / 45 min (Hobby); multi-day work must checkpoint and hibernate between bursts, and the agent runtime must tolerate mid-task hibernation and be resumable — real work in the agent loop, not just lifecycle plumbing.
- **Agent resumability**: anything in the agent loop that assumes a continuously-live process breaks; the loop must be checkpointable/resumable across hibernation (a dependency, tracked as out-of-scope here but blocking GA of multi-day tasks).
- **Storage/GC governance**: each auto-snapshot is 200MB–few GB at $0.08/GB-month; without `keepLastSnapshots: { count: 1 }` + sensible `snapshotExpiration`, storage creeps. A session GC'd by the 30-day default cold-rebuilds anyway, so the "always resumes" promise has an expiry the UX must communicate.
- **`iad1`-only region**: single-region persistence is a latency/residency constraint for non-US users — a real platform limit.
- **Lost process/in-memory state**: only the filesystem is snapshotted; running processes, in-memory caches, open sockets, and unflushed buffers vanish — services must be idempotent on relaunch and flush to disk in `beforeStop`.
- **Unproven real fidelity**: the fake proves the abstraction and survival contract but not real restore latency, storage GC, or Firecracker edge cases; the gated real-sandbox proof is required before claiming the path is production-proven.

## Deploy or migration impact

- **No schema migration for the core path**: the session lifecycle fields (`lifecycleState`, `lifecycleVersion`, `lastActivityAt`, `sandboxExpiresAt`, `hibernateAfter`, `sandboxState`, `snapshotUrl`/`snapshotCreatedAt`/`snapshotSizeBytes`) already exist. If `currentSnapshotId` (snapshot rollback) is added, generate the Drizzle migration and commit the `.sql`.
- **Snapshot storage/retention config**: configure `keepLastSnapshots: { count: 1 }` and `snapshotExpiration` at the sandbox-provisioning layer; document the snapshot-storage cost ($0.08/GB-month) and the 30-day-from-last-use GC default.
- **Resume model adoption**: adopt the v2 `getOrCreate` / `get({ name })` + `onResume` model in `packages/sandbox/vercel/sandbox.ts`; ensure `persistent: true` (already the default) and the `onResume`/`afterStart`/`beforeStop` hooks are wired.
- **Region**: `iad1`-only; document the constraint for non-US deployments.
- **No production data backfill**; existing sessions adopt the resume path on their next idle/resume cycle (preview deploys use isolated Neon branches, so no production-data risk during validation).

## Definition of done

- [ ] Red test written first and observed failing (behavior proof red).
- [ ] Red-test commit recorded (or documented exception per the Managed Runtime Proof Standard).
- [ ] Green commit after the red, implementing the smallest change to pass.
- [ ] Targeted tests pass (continuity, illegal-transition guard, expired-snapshot rejection, `relaunchOnResume` contract, indicators).
- [ ] Adjacent suite passes.
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes (format, lint, typecheck, tests).
- [ ] Regression harness implemented (state-machine guards + continuity integration + indicator smoke + gated real-sandbox proof).
- [ ] Docs updated (lifecycle/resume behavior, retention controls, multi-day/5h-burst model, region constraint).
- [ ] Observability evidence captured (lifecycle transition events, snapshot/resume events, service-relaunch events, typed errors, redaction verified).
- [ ] Deploy notes included (optional `currentSnapshotId` migration, snapshot retention config, resume-model adoption, region).
- [ ] Managed Runtime Proof Standard evidence captured (real-sandbox hibernate/resume: full lifecycle transition log + byte-exact filesystem/git restore + service-relaunch contract).
