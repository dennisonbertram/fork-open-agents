# POC 4c — Persistent / Snapshottable VMs

## Goal

Sandboxes are ephemeral with idle teardown. POC 4c investigates **snapshot-and-resume
(hibernate/wake)** so a session can survive idle teardown — supporting multi-day tasks
and the desktop use case **without cold rebuilds**. Feasibility was flagged *Hard /
dependent on Vercel Sandbox platform limits*, so this is primarily a **research spike**
that learns the real platform limits **and** prototypes the resume abstraction (lifecycle
state machine + filesystem/service/git restore mechanism) against a local fake provider.

## Research findings: real Vercel Sandbox limits (cited)

The briefing predates the platform GA; the key finding is that **Vercel shipped almost
exactly the model this POC needs**. As of late May 2026, **persistent sandboxes are GA**.

| Capability | Real number / behavior | Source |
|---|---|---|
| **Snapshot support** | **Yes, native.** Snapshots capture *"the sandbox's entire filesystem state"* — *"a compressed copy of the sandbox's disk"* (`.img` → `.vhs`, uploaded to S3). | [optimizing-vercel-sandbox-snapshots](https://vercel.com/blog/optimizing-vercel-sandbox-snapshots) |
| **Hibernation / auto-persistence** | **Yes, default.** *"When you stop a persistent sandbox, the SDK automatically snapshots the filesystem. When you resume it, a new session boots from that snapshot."* `persistent: true` is the default. | [persistent-sandboxes](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) |
| **Resume** | **Automatic.** *"Any call on a stopped sandbox, like `runCommand()` or `writeFiles()`, starts a new session from the most recent snapshot."* `Sandbox.get({ name })` / `getOrCreate`. | [persistent-sandboxes](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) |
| **Cold-start / restore cost** | **Sub-second on cache hit.** *"p75 dropped from 40s to sub-second, and p95 went from 50s to 5s."* Restore feels "instant". | [optimizing-vercel-sandbox-snapshots](https://vercel.com/blog/optimizing-vercel-sandbox-snapshots) |
| **Snapshot size** | **200MB to a few GBs** (compressed); raw disk image *"can be several GBs"*. | [optimizing-vercel-sandbox-snapshots](https://vercel.com/blog/optimizing-vercel-sandbox-snapshots) |
| **Max runtime duration** (per session) | **45 min Hobby, 5 hours Pro/Enterprise** (raised from 45 min). Default timeout **5 min**, extendable via `extendTimeout()`. | [pricing](https://vercel.com/docs/sandbox/pricing), [changelog: 5h](https://vercel.com/changelog/vercel-sandbox-maximum-duration-extended-to-5-hours) |
| **Persistence across sessions** | Unbounded: a **sandbox** (durable name) survives across many **sessions**; only the per-session VM is capped at 5h. Multi-day tasks = many ≤5h sessions over one durable name. | [persistent-sandboxes](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) |
| **Snapshot expiration / retention** | Default **30 days from last use** (timer resets on use). Configurable `snapshotExpiration`; `keepLastSnapshots` keeps N (1–10) most recent. | [pricing](https://vercel.com/docs/sandbox/pricing), [persistent-sandboxes](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) |
| **Ephemeral disk** | **32 GB NVMe** per sandbox. Snapshot storage billed separately ($0.08/GB-month). | [pricing](https://vercel.com/docs/sandbox/pricing) |
| **Region** | Only `iad1` today. | [pricing](https://vercel.com/docs/sandbox/pricing) |
| **What does NOT survive** | Only **filesystem** is snapshotted. **No claim** that running processes or installed-in-RAM state survive. Vercel provides an **`onResume` hook** explicitly *"to restart background services"* — confirming processes must be relaunched. | [persistent-sandboxes](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) |

**Critical takeaway:** the hardest part the briefing worried about (native snapshot of a
Firecracker MicroVM filesystem) **already exists and is fast**. The remaining work is the
**orchestration layer** — driving the lifecycle states and relaunching services — which is
exactly what this POC prototypes. The codebase already reflects this: `interface.ts` has
`snapshot(): Promise<SnapshotResult>`, `vercel/sandbox.ts` implements it via
`session.snapshot()` (and notes it *"automatically stops the sandbox"*), and
`VercelSandbox.connect(name, { resume: true })` resumes by name.

## What was built

A self-contained TypeScript POC (`src/`), no root/app changes:

- **`lifecycle.ts`** — `LifecycleMachine` over the exact state union from
  `apps/web/lib/sandbox/lifecycle.ts` (`provisioning | active | hibernating |
  hibernated | restoring | archived | failed`). The briefing's "resuming" == production
  "restoring" (aliased). Transitions are validated against an allow-list; illegal moves
  throw. Records a transition log with reasons + timestamps.
- **`provider.ts`** — the `SnapshotProvider` abstraction:
  `snapshot(instance) -> SnapshotRef`, `resume(ref) -> SandboxInstance`,
  `discard(ref)`. `SnapshotRef` mirrors Vercel's `{ snapshotId }` + durable name.
- **`fake-provider.ts`** — `LocalFakeSnapshotProvider`: implements snapshot/resume by
  archiving the **entire working directory** to a gzip tarball (the stand-in for Vercel's
  compressed `.vhs` disk image) + a sidecar JSON of service records & env, then **tearing
  down the live session dir**. `resume` boots a NEW session id (same durable name),
  extracts the tarball byte-for-byte, and rehydrates service records with pids cleared.
- **`service-records.ts`** — minimal model of a `sandbox_services` row (the load-bearing
  field is `relaunchOnResume`, `schema.ts:355`) and the explicit
  **`HIBERNATION_SURVIVAL` contract** (filesystem/git/service-records → yes; running
  processes/in-memory → no).
- **`orchestrator.ts`** — `SandboxOrchestrator` ties the machine to the provider:
  `hibernate()` does `active → hibernating → [snapshot+teardown] → hibernated`;
  `resume()` does `hibernated → restoring → [boot+restore+relaunch] → active` and
  relaunches only `relaunchOnResume=true` services with a **new pid** (proving processes
  are recreated, not restored). This is the POC analogue of
  `evaluateSandboxLifecycle` + the `onResume` service-relaunch behavior.
- **`fidelity.ts`** — content-hash filesystem fingerprint (path + mode + sha256 →
  `rootHash`) for byte-restore assertions and size characterization. Reuses POC 3b's
  insight: the git working tree (staged/unstaged/untracked) lives on the filesystem, so a
  full-disk snapshot captures it for free.

## How it was tested + evidence

Run from `POC/4c-snapshot-vms/`:

```bash
bun install
bun run typecheck          # clean
bun run eval               # 30/30 assertions pass
bun test src/lifecycle.test.ts   # 6/6 state-machine guard tests pass
```

**Eval (`src/eval.ts`) — a realistic multi-day task:** provisions a sandbox with a mixed
git working tree (committed + STAGED + UNSTAGED + UNTRACKED + executable-mode + binary),
two services (a `dev_server` with `relaunchOnResume=true` and a `code_editor` with
`relaunchOnResume=false`, both "running"), and a mid-session day-1 artifact. It then
**snapshots, tears down the live instance, and resumes into a new session — twice**.

Proven (30/30, evidence in `evidence/`):
- Live workdir is **physically torn down** after hibernate (`!existsSync`).
- Filesystem is **byte-restored** — `rootHash` of pre-snapshot manifest == post-resume
  manifest (`evidence/02`/`03`).
- Git working state intact: `git status --porcelain` identical; STAGED/UNSTAGED/UNTRACKED
  all survive; commit history intact (`evidence/04`).
- `relaunchOnResume=true` service **relaunched with a NEW pid**;
  `relaunchOnResume=false` service left **stopped, pid null** (processes don't survive).
- Lifecycle trail exactly:
  `provisioning → active → hibernating → hibernated → restoring → active →
  hibernating → hibernated → restoring → active` (`evidence/01`).
- A **multi-day task survives two hibernate/resume cycles** (both day-1 and day-2
  artifacts present after the 2nd resume).
- Snapshot/restore cost characterized (`evidence/05`): ~15 KB compressed for this tree,
  ~25 ms snapshot, ~22 ms resume on the fake.

**Guard tests (`src/lifecycle.test.ts`)** prove the machine **rejects** illegal moves
(`active→hibernated`, `hibernated→active`, any move out of terminal `archived`) and that a
**discarded/expired snapshot cannot be resumed** — so the "transitioned correctly" claim is
enforced, not cosmetic (`evidence/06`).

Evidence files: `00-eval-output.txt`, `01-lifecycle-transitions.json`,
`02-fs-manifest-pre-snapshot.txt`, `03-fs-manifest-post-resume.txt`,
`04-git-working-state.txt`, `05-snapshot-cost.json`, `06-state-machine-guards.txt`.

## Feasibility verdict

**Feasible today, platform-native — easier than the briefing assumed.**

- **Platform-native snapshot:** Vercel does the hard part natively. Auto-persistence
  snapshots the filesystem on `stop()` and restores on resume, with **sub-second** p75
  restore. This is strictly better than a reconstruct-from-archive fallback.
- **The work is orchestration, not infrastructure:** drive the lifecycle states and
  relaunch services — exactly what this POC proves sound (the abstraction + machine +
  relaunch contract all hold against the fake, and the fake mirrors the documented Vercel
  behavior 1:1).
- **The one real gap is the 5-hour per-session cap.** Multi-day tasks cannot be one
  continuous session; they must be **N sessions of ≤5h over a single durable sandbox
  name**, with hibernate between bursts. This POC's state machine models that directly
  (the trail loops through hibernate/resume repeatedly).

**Fallback (only if native persistence is unavailable, e.g. non-persistent mode or a
different provider):** reconstruct-from-archive on a fresh sandbox —
git-bundle the repo + working tree (POC 3b) + a filesystem archive of non-git artifacts
(`node_modules`, caches), restore onto a freshly-created sandbox, then relaunch services.
`fake-provider.ts` is essentially this fallback mechanism, so it is already prototyped; the
verdict is to prefer native persistence and keep this as the degraded path.

## Integration plan (real file paths)

1. **Use native persistence, not a custom provider.** `packages/sandbox/vercel/sandbox.ts`
   already passes `persistent: true` and implements `snapshot()` via `session.snapshot()`.
   Adopt the v2 `getOrCreate`/`get({ name })` + `onResume` model from the docs for resume.
2. **Lifecycle orchestration** lives in `apps/web/lib/sandbox/lifecycle.ts`
   (`evaluateSandboxLifecycle`). It already drives `active → hibernating → hibernated`
   via `sandbox.stop()`. Add the **resume path** (`hibernated → restoring → active`) on the
   next user request, using `buildActiveLifecycleUpdate` to write `lifecycleState=active`.
   The `SandboxOrchestrator` here maps directly onto that function.
3. **Session lifecycle fields** in `apps/web/lib/db/schema.ts` already exist and are the
   right shape: `lifecycleState` (same union), `lifecycleVersion`, `lastActivityAt`,
   `sandboxExpiresAt`, `hibernateAfter`, `sandboxState` (JSONB durable name), plus
   `snapshotUrl`/`snapshotCreatedAt`/`snapshotSizeBytes`. No schema change needed for the
   core path. (Optional: a `currentSnapshotId` column if rolling back to a specific
   snapshot via `sandbox.update({ currentSnapshotId })` is desired.)
4. **Service relaunch:** on resume, query `sandboxServices` for the session
   (`apps/web/lib/sandbox/runtime/service-records.ts`) and relaunch rows with
   `relaunchOnResume=true` (`schema.ts:355`) using the existing launcher
   (`service-launch.ts`, which sets `relaunchOnResume: true` at `:689`). Wire this into the
   Vercel `onResume` hook (or the existing `afterStart` hook in `interface.ts`). Records
   with `relaunchOnResume=false` stay `stopped`.
5. **`interface.ts` `snapshot()`** is the seam the `SnapshotProvider` abstraction maps onto;
   the production binding is a thin adapter (no new abstraction layer required since Vercel
   is native).

## Blind spots eliminated

- **"Can the real platform snapshot a MicroVM filesystem?"** — Yes, natively, GA, with
  sub-second restore. The interface `snapshot()` method is real, not aspirational.
- **"What state must we capture?"** — Filesystem (incl. git working tree) only; everything
  else (service intent, env) lives in Postgres/sandbox config, outside the VM.
- **"Do uncommitted/untracked changes survive?"** — Yes; they're on disk, so a full-disk
  snapshot captures them (verified byte-exact). No separate git bundle needed in the
  native path.
- **"Do running processes survive?"** — No. Confirmed by docs (`onResume` exists *to
  restart services*) and modeled + tested (new pid on relaunch; non-relaunch service stays
  stopped).
- **"Is the lifecycle state machine sound?"** — Yes; illegal transitions throw, the full
  hibernate/resume path is exercised twice, and the abort-back-to-active edge (active
  stream arrives mid-hibernation, per `restoreActiveLifecycleState`) is allowed.

## Remaining risks

- **5-hour per-session ceiling.** A single uninterrupted compute burst can't exceed 5h
  (Pro/Enterprise) / 45 min (Hobby). Multi-day work must checkpoint and hibernate between
  bursts; agent loops must be resumable. Mitigated by the orchestration model here, but the
  agent runtime must tolerate mid-task hibernation.
- **Snapshot storage cost & retention.** Each auto-snapshot costs $0.08/GB-month and
  snapshots are 200MB–few GB. Use `keepLastSnapshots: { count: 1 }` and a sensible
  `snapshotExpiration` to keep storage flat; a long-idle hibernated session can be GC'd by
  the 30-day-from-last-use default and would then cold-rebuild.
- **`iad1`-only region** — latency/residency constraint for non-US users.
- **In-memory / process state genuinely lost** — long-running in-memory caches, open
  sockets, and unflushed buffers vanish at hibernation. Services must be idempotent on
  relaunch and persist anything important to disk before idle teardown (the existing
  `beforeStop` hook in `interface.ts` is the place to flush).
- **Fake vs real fidelity:** the local fake proves the abstraction and the survival
  contract, but cannot reproduce real Vercel restore latency, snapshot-storage GC, or
  Firecracker-specific edge cases. Final validation requires a real persistent sandbox
  hibernate/resume against `vercel/sandbox.ts` (gated behind credentials / the Managed
  Runtime Proof Standard).
```
