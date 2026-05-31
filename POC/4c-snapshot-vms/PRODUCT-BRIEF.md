# Product Brief: Persistent / Snapshottable Sandboxes (resume where you left off)

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR
Sandboxes are ephemeral with idle teardown today, so any session that goes idle loses its environment and cold-rebuilds from scratch. The POC's headline finding is that **Vercel snapshot/hibernation is GA, automatic, and sub-second on cache hit** (p75 40s → sub-second) — the hard part we feared is already solved on the platform. The remaining work is **orchestration**: drive the lifecycle state machine and relaunch services on resume, which the POC proved sound (30/30 eval assertions, byte-exact filesystem restore, correct service-relaunch contract, multi-day survival across two hibernate/resume cycles). This unlocks "resume exactly where you left off" and multi-day tasks for modest cost. **Build it (soon) — it's easier than originally flagged.**

## The gap today
When a session goes idle, the sandbox is torn down and everything in it is lost: the installed toolchain, the running dev server, build caches, and — most painfully — **uncommitted/untracked work in the git working tree**. Who feels it:
- **Anyone returning to a paused task** — come back an hour later and the agent has no memory of the environment; it cold-rebuilds (reinstall toolchain, re-warm caches), which on heavy profiles (Rust ~4 min, Docker minutes) is a real wait, and any in-flight uncommitted state is gone.
- **Long / multi-day tasks** — a large refactor or migration that spans days simply can't persist; the environment evaporates between bursts, so the agent restarts cold each time and can't carry working state forward.
- **Expensive-setup profiles (ties to 4b)** — the very profiles that are slow to install (Rust, Docker) are the ones that hurt most to rebuild on every idle teardown.

## What we'd build
**Transparent "resume where you left off."** A session that goes idle **hibernates** (snapshots its filesystem) instead of being destroyed, and on the user's next request **resumes** from the most recent snapshot — same files, same git working tree (staged/unstaged/untracked included), same caches — with services relaunched. To the user it's seamless: they come back and the environment is intact. Under the hood it's a lifecycle state machine (`provisioning → active → hibernating → hibernated → restoring → active`) plus a service-relaunch step.

The POC de-risked this precisely: Vercel's persistent sandboxes are GA and `persistent: true` is the default; stopping auto-snapshots the filesystem and resuming boots a new session from it, sub-second on cache hit. The codebase already reflects it — `interface.ts` has `snapshot()`, `vercel/sandbox.ts` implements it via `session.snapshot()`, and `connect(name, { resume: true })` resumes by durable name. The POC built and proved the orchestration analogue (lifecycle machine with validated transitions, snapshot/resume provider, and a `relaunchOnResume` service contract) against a local fake that mirrors the documented Vercel behavior 1:1.

## How users experience it
### Where it lives (exposure)
Mostly **invisible** — the point is that resume "just works." The surfacing is lightweight lifecycle indicators on the session: a session in the list shows **Active / Hibernated / Restoring**; reopening a hibernated session shows a brief "Resuming where you left off…" instead of a cold-start. Settings expose retention controls (how long hibernated sessions are kept) and, for multi-day work, the session communicates that it checkpoints and hibernates between bursts.

### Sample UI
**Session lifecycle indicators + a resume affordance.** States:
- **Active** — normal running session.
- **Hibernating** — brief transient ("Saving your session…") as the snapshot is taken on idle; the user can leave.
- **Hibernated** — in the session list, a "Hibernated — resumes instantly" badge with last-active time and (optionally) "expires in N days" from the retention policy. Reassures the user nothing is lost.
- **Restoring** — on reopen, "Resuming where you left off…" with the service-relaunch step visible if it takes a beat ("Restoring files ✓ · Relaunching dev server…"). On a cache hit this is sub-second and barely shown.
- **Active (resumed)** — back to work; files and git working tree byte-identical, `relaunchOnResume` services back up with fresh process state.
- **Multi-day / checkpointed** — a long task shows it has hibernated and resumed across bursts ("Day 2 — resumed from yesterday"), making the ≤5h-per-burst reality legible rather than surprising.
- **Expired / GC'd** — a long-idle hibernated session past retention shows "Session expired — will rebuild fresh on reopen," so the cold-rebuild is expected, not a silent surprise.

### UX walkthrough
1. User is mid-task; the agent has installed a Rust toolchain, has a dev server running, and there are **uncommitted** edits in the working tree. User steps away.
2. Session goes idle → **Hibernating** → snapshot taken (filesystem incl. the git working tree) → **Hibernated**. The live sandbox is torn down to stop billing compute.
3. Hours later the user reopens the session. **Restoring** flashes; on a cache hit it's sub-second. Files, staged/unstaged/untracked changes, and build caches are byte-exact; the dev server (a `relaunchOnResume=true` service) is relaunched with a new pid; a `relaunchOnResume=false` editor stays stopped.
4. The agent picks up exactly where it left off — no toolchain reinstall, no lost work.
5. For a multi-day refactor, this repeats: the task checkpoints and hibernates between ≤5h bursts over one durable sandbox name, surviving many sessions.

## Value to the user
**Jobs-to-be-done:** "Let me leave and come back without losing my environment or my uncommitted work." "Let the agent work on a task that takes days." "Don't make me wait through a cold rebuild every time I return."

- **Pause-and-resume:** Step away for lunch, come back to an intact session — dev server up, caches warm, uncommitted edits preserved — instead of a cold rebuild and lost work.
- **Multi-day refactor:** A large migration spans three days; the agent checkpoints and hibernates between bursts, resuming each day with full working state, rather than restarting from zero.
- **Expensive-profile relief:** A Rust or Docker repo (slow to set up, per 4b) resumes from snapshot instead of reinstalling the toolchain — turning a ~4 min cold start into a sub-second resume.

## Value to the product
- **Retention:** "Your session is still here, resume instantly" is a retention mechanic — it removes the penalty for stepping away and the friction of returning, so users come back to in-progress work instead of abandoning it.
- **Enables a new workload class:** Multi-day/long-horizon tasks become possible at all. That's a category of work (big refactors, migrations, multi-step research/build) the ephemeral model structurally can't serve.
- **Compounds 4b and 4a:** It amortizes expensive profile installs (4b's Rust/Docker) and lets a desktop session (4a) resume — so it multiplies the value of the other two rather than standing alone.
- **Cost posture is favorable:** Snapshot storage is cheap ($0.08/GB-month, 200MB–few GB) and hibernation *stops compute billing* while idle — so persistence can actually lower spend versus keeping sandboxes warm.

## The case FOR (strong)
1. **The hard part is already solved and fast.** Native MicroVM filesystem snapshot/hibernation is GA, automatic (`persistent: true` default), and **sub-second on cache hit** (p75 40s → sub-second, p95 50s → 5s). We're building orchestration on top of a proven, fast primitive — not inventing snapshotting.
2. **The orchestration is proven sound.** The POC's lifecycle machine, provider abstraction, and service-relaunch contract passed **30/30** eval assertions plus guard tests: byte-exact filesystem restore (`rootHash` match), full git working state intact (staged/unstaged/untracked), correct relaunch (new pid for `relaunchOnResume=true`, stopped for `false`), and a **multi-day task surviving two hibernate/resume cycles**. Illegal transitions and resuming a discarded snapshot are rejected.
3. **It slots into existing seams.** `interface.ts` `snapshot()`, `vercel/sandbox.ts` `session.snapshot()`, `connect(name, { resume })`, and the schema's lifecycle fields (`lifecycleState`, `sandboxState`, `snapshotUrl`, …) already exist. The POC maps `SandboxOrchestrator` directly onto `evaluateSandboxLifecycle`; **no core schema change** for the main path.
4. **Uncommitted work survives for free.** Because the full disk is snapshotted, the git working tree comes along with no separate bundle — proven byte-exact. This directly fixes the most painful loss (in-flight, un-pushed work).
5. **Easier and cheaper than originally flagged.** It was scoped as "Hard / dependent on platform limits"; the platform shipped almost exactly the needed model. Risk and effort are materially lower than the briefing assumed, and storage cost is small while idle compute billing stops.

## The case AGAINST (strong)
1. **The 5-hour per-session ceiling is a real constraint.** A single uninterrupted compute burst can't exceed 5h (Pro/Enterprise) / 45 min (Hobby). Multi-day work must checkpoint and hibernate between bursts, and **the agent runtime must tolerate mid-task hibernation and be resumable** — that's real work in the agent loop, not just lifecycle plumbing.
2. **Processes and in-memory state genuinely don't survive.** Only the filesystem is snapshotted. Running processes, in-memory caches, open sockets, and unflushed buffers vanish; services must be idempotent on relaunch and flush important state to disk before teardown (the `beforeStop` hook). Anything assuming a continuously-live process breaks.
3. **Storage cost and retention need governance.** Each auto-snapshot is 200MB–few GB at $0.08/GB-month; without `keepLastSnapshots: { count: 1 }` and a sensible `snapshotExpiration`, storage can creep. A long-idle session GC'd by the 30-day default cold-rebuilds anyway — so the "always resumes" promise has an expiry the UX must communicate.
4. **`iad1`-only region.** Single-region persistence is a latency/residency constraint for non-US users — a real limit for a global audience.
5. **Final fidelity is unproven against the real platform.** The local fake proves the abstraction and survival contract but cannot reproduce real restore latency, snapshot-storage GC, or Firecracker-specific edge cases. A real persistent-sandbox hibernate/resume against `vercel/sandbox.ts` (gated by the Managed Runtime Proof Standard) is still required before claiming the path is production-proven.

## Effort, dependencies & risk
- **Feasibility verdict (from POC): Easier than originally flagged.** Re-scoped from "Hard / platform-dependent" to "feasible today, platform-native" — Vercel does the snapshot/restore natively and sub-second; the remaining work is orchestration, which the POC proves sound.
- **Build size:** Medium, and mostly orchestration. Add the resume path (`hibernated → restoring → active`) to `evaluateSandboxLifecycle` in `apps/web/lib/sandbox/lifecycle.ts`; adopt the v2 `getOrCreate`/`get({ name })` + `onResume` model; relaunch `relaunchOnResume=true` services on resume via the existing launcher; surface lifecycle indicators + resume UX. The schema lifecycle fields already exist. Plus the agent-runtime work to tolerate mid-task hibernation.
- **Dependencies:** Vercel persistent sandboxes (GA); existing lifecycle fields and `sandboxServices` (`relaunchOnResume`); the `onResume`/`afterStart`/`beforeStop` hooks; a real-sandbox hibernate/resume validation behind the Managed Runtime Proof Standard. Compounds with 4b (amortize installs) and 4a (resume desktop).
- **Top risks + mitigations:**
  - *5h cap / mid-task hibernation* → make the agent loop checkpointable/resumable; model multi-day as N ≤5h sessions over one durable name (the POC's state machine already does this).
  - *Lost process/in-memory state* → idempotent service relaunch; flush to disk in `beforeStop`; persist intent in Postgres, not RAM.
  - *Storage creep / GC surprise* → `keepLastSnapshots: { count: 1 }` + sensible `snapshotExpiration`; UX communicates expiry and the cold-rebuild-after-expiry case.
  - *Unproven real fidelity* → run the gated real-sandbox hibernate/resume proof before GA.

## The decision
**The crisp question:** Do we want sessions to persist-and-resume (and multi-day tasks to exist) now that the platform makes snapshot/hibernation native and sub-second — accepting the 5h-burst constraint and the agent-resumability work it implies?

**Recommended trigger to greenlight:** Soon. The platform precondition is met; the main gate is a real-sandbox hibernate/resume validation (per the Managed Runtime Proof Standard) and the agent-loop work to tolerate mid-task hibernation.

**Success metrics:** resume rate (sessions reopened from hibernation vs. cold-rebuilt); p50 resume latency (target the platform's sub-second cache-hit); preserved-work rate (uncommitted changes intact on resume); multi-day task completion rate (tasks spanning >1 session); snapshot storage cost per active user (kept flat via retention policy); reduction in cold-rebuild time on expensive profiles (4b).

**Suggested default: BUILD (soon, after 4b leads).** It's lower-risk and higher-value than originally believed, and it compounds both other POCs by amortizing expensive installs and enabling desktop/long-horizon work. Sequence it after 4b's quick win, run the gated real-sandbox proof, and ship transparent resume plus the agent-resumability work. The constraints (5h burst, no live process survival, single region) are real but well-understood and mitigable — they shape the design, they don't block it.
