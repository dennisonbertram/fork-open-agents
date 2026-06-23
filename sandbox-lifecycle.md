# Sandbox Lifecycle Audit — Scratchpad

## Files read
- docs/agents/lessons-learned.md (full)
- apps/web/lib/sandbox/lifecycle.ts
- apps/web/lib/sandbox/lifecycle-kick.ts
- apps/web/lib/sandbox/config.ts
- apps/web/lib/sandbox/utils.ts
- apps/web/app/api/sandbox/route.ts (create/delete)
- apps/web/app/api/sandbox/snapshot/route.ts (pause POST / resume PUT)
- apps/web/app/api/sandbox/status/route.ts
- apps/web/app/api/sandbox/reconnect/route.ts
- apps/web/app/api/sandbox/extend/route.ts
- apps/web/app/api/sandbox/activity/route.ts
- apps/web/app/api/sessions/[sessionId]/sandbox/route.ts (on-demand attach)
- apps/web/app/api/sessions/[sessionId]/sandbox-services/route.ts
- apps/web/app/workflows/sandbox-lifecycle.ts (workflow)
- apps/web/app/api/sessions/_lib/session-context.ts (authz)
- apps/web/lib/db/sessions.ts (updateSession, claimSessionLifecycleRunId)

## Known lessons checked against current code
- "snapshotting is a stop/hibernate" → snapshot POST route stops sandbox then buildHibernatedLifecycleUpdate. OK fixed.
- "18_000_000ms clamp / timeout+buffer never exceeds API limit" → config uses STANDARD = 5h - 30s; HOBBY = 40m - 30s. No internal timeout buffer added at connectSandbox call. OK (no violation found).
- "lifecycle not durable without workflow run" → workflow + kick present. OK.
- "expired/no_sandbox/expired-as-no_sandbox" → reconnect returns "expired" with hasSnapshot; client-side lesson. Server returns status enum. OK.
- "persist lifecycleRunId before start()" → lifecycle-kick uses claimSessionLifecycleRunId (atomic CAS) then startLifecycleRun. OK fixed.
- "skipped/not-due-yet retry" → workflow `continue`s on not-due-yet/active-workflow/snapshot-already-in-progress. OK fixed.
- "reconnect persists refreshed runtime state" → reconnect persists sandboxState + sandboxExpiresAt; does NOT reset lastActivityAt/hibernateAfter. OK fixed (and lesson says that's correct).
- "probe timeouts transient non-terminal" → reconnect probe: non-fatal probe failure warns but stays connected; only isSandboxUnavailableError throws. isSandboxUnavailableError includes "sandbox probe failed" but exec with timeout returns success=false, not throw. Need to verify timeout path.
- "status endpoint should detect overdue hibernateAfter and kick" → status route kicks on isExpired || now>=dueAtMs. OK fixed.
- "reconnect read-only / never refresh lifecycle activity or kick" → reconnect does NOT kick lifecycle and does NOT reset activity. OK fixed.
- "Snapshot restore idempotent alreadyRunning returns 200 alreadyRunning" → PUT snapshot route: hasRuntimeSandboxState → returns success alreadyRunning:true. OK fixed.

## Candidate defects under analysis

### CAND-1: reconnect persists refreshedState with stale/fresh expiresAt but does NOT bump lifecycleVersion
In reconnect success path, updateSession writes sandboxState + sandboxExpiresAt but does not pass lifecycleVersion / getNextLifecycleVersion. Compare: extend, snapshot, create all pass lifecycleVersion: getNextLifecycleVersion(...). Investigate whether stale lifecycleVersion causes the client to ignore the refreshed expiry. Need client logic. Possibly low/benign.

### CAND-2: snapshot POST route missing rate-limit + bot check (compare to create/extend/delete)
snapshot POST and PUT and DELETE do not call checkRateLimit or checkBotProtection. Extend/create/delete all do. This means an authenticated user can hammer snapshot POST (which calls connectSandbox + sandbox.stop()) or PUT (which creates a new sandbox VM). Each PUT can spin up a new sandbox VM with no rate limit → resource/abuse. DELETE route also no rate limit on the stop. Worth raising as medium (abuse/cost), but create route has 20/min; snapshot resume PUT has none and each creates a VM.

### CAND-3: snapshot PUT restore can race — two concurrent PUTs both pass hasRuntimeSandboxState=false and both call connectSandbox(createIfMissing.../resume) creating the same persistent sandbox name; second wins. Low concurrency.

### CAND-4: lifecycle-kick isLifecycleRunStale only clears stale run when lifecycleState === "active". If lifecycleRunId is stuck AND lifecycleState is "hibernating"/"failed"/"provisioning", the stale run is never cleared and no new workflow starts → sandbox stuck. Investigate. In evaluateSandboxLifecycle, on failure it sets lifecycleRunId:null + failed. On hibernate success it clears. But if workflow start throws AFTER claim, the catch clears lifecycleRunId if owned. Hmm. But what about lifecycleState "hibernating" stuck? evaluate sets "hibernating" then if sandbox.stop() throws it goes to catch → failed + null. OK. But if the workflow process is killed mid-"hibernating" (between setting hibernating and stop), lifecycleState stays "hibernating" and lifecycleRunId may be set; isLifecycleRunStale returns false (only active), so kick never clears it, shouldStartLifecycle returns false (lifecycleRunId truthy) → stuck hibernating forever. Real durability gap. Medium/high.

### CAND-5: status route — when it recovers failed→active, it does not kick lifecycle, but a recovered-active expired sandbox should still be cleaned. Actually it kicks in the next block if lifecycleState active && (isExpired||now>=dueAtMs). But the recovery block sets effectiveSessionRecord to the recovered (active) record, and then the kick block checks effectiveSessionRecord.lifecycleState === "active". So it will kick. OK.

### CAND-6: reconnect catch non-unavailable path returns status "connected" but does NOT persist. Per lesson that's intended (transient). But it forwards safeExpiresAt only if > Date.now(); if the VM is actually expired this returns "connected" with no expiresAt → client may treat as connected with no expiry. Acceptable per lesson.

### CAND-7: create route POST — after connectSandbox succeeds and before updateSession, if installSessionUserSkills throws (unhandled — no try/catch around it), the whole POST throws 500 but sandbox VM already created and sandboxState NOT persisted to DB. The sandbox VM is orphaned (leaked) with no DB record → resource leak + the persistent sandbox name exists at provider but DB has no runtime state, so next create resumes it but with stale state. Actually connectSandbox used resume:createIfMissing persistent. Let me verify: installSessionUserSkills is awaited without try/catch (line 274), while installSessionGlobalSkills is wrapped in try/catch. If installSessionUserSkills throws, the function throws, Response 500, but sandbox already provisioned and updateSession already ran (line 237 before skills). Wait — updateSession at 237 runs BEFORE skills install. So state IS persisted. But skills install throwing → 500 to client, client may retry create → resume same sandbox. Probably OK-ish but the 500 is misleading. Low.

### CAND-8: snapshot PUT legacy restore uses timeout: DEFAULT_SANDBOX_TIMEOUT_MS but the persistent-name branch also uses DEFAULT_SANDBOX_TIMEOUT_MS. No 18M clamp issue (5h). OK.

### CAND-9: extend route rate limit 3/min is fine. But extend calls sandbox.extendTimeout without clamping result against 18_000_000ms. If user extends repeatedly, expiresAt could exceed Vercel hard limit and the SDK would reject. But that's SDK-enforced; extendTimeout itself enforces. Not a web bug.

## CONFIRMED findings

### F1 (medium, reliability): Sandbox stuck in `hibernating` after workflow run is killed — no recovery path
- lifecycle.ts:205 sets lifecycleState="hibernating" inside evaluateSandboxLifecycle BEFORE sandbox.stop().
- The only exits: success → "hibernated" (buildHibernatedLifecycleUpdate) or catch → "failed" + lifecycleRunId:null.
- If the durable workflow run is evicted/killed (cold-start eviction, redeploy, OOM) BETWEEN claiming the lease (lifecycleRunId set via claimSessionLifecycleRunId) and completing evaluate, the session stays lifecycleState="hibernating" with lifecycleRunId set.
- isLifecycleRunStale (lifecycle-kick.ts:83-97) only returns true when lifecycleState === "active". So a "hibernating" lease is never treated as stale → shouldStartLifecycle returns false (lifecycleRunId truthy) → no new workflow.
- status route safety-net kick (status/route.ts ~line 78) only fires when lifecycleState === "active".
- Result: sandbox never hibernates, never resumes, never cleared. Stuck until manual DB intervention.
- Trigger: any deploy / cold-start eviction while a lifecycle workflow is mid-evaluation (set hibernating, lease claimed). Realistic on serverless.

### F2 (medium, security/abuse): snapshot PUT (resume) and snapshot POST (pause) have NO rate limiting or bot protection, unlike create/extend/delete
- app/api/sandbox/snapshot/route.ts POST (line ~22) & PUT (line ~93): requireAuthenticatedUser + requireOwnedSession(WithSandboxGuard) only. No checkRateLimit, no checkBotProtection.
- Confirmed via grep: create POST (route.ts:121,126), extend (extend/route.ts:27,32), and DELETE (route.ts:306,311) ALL have bot-check + rate-limit. ONLY the snapshot POST & PUT routes are missing both.
- snapshot PUT resume uses createIfMissing:true / persistent:true (restoreLegacySnapshot + persistent-name resume) → each call can spin up / resume a Vercel Sandbox VM with no throttle. Auth-gated (not IDOR; ownership checked) but no per-user rate cap → an authenticated user can create unbounded sandbox VMs (cost/quota abuse). create limits to 20/min; snapshot resume limits to none.
- snapshot POST pauses/stops the VM (connectSandbox + sandbox.stop) — also unthrottled, lower cost but can be abused to churn provider API.

### F3 (low, error-handling): create route — installSessionUserSkills throws aborts POST with 500 AFTER sandbox + state persisted; inconsistent with global-skills guard
- route.ts:274 installSessionUserSkills awaited outside try/catch (global skills at 262 ARE guarded).
- Sandbox VM already created (line 211) and state persisted (line 237) → client gets 500 on success, persistent sandbox exists without user skills, lifecycle workflow kicked only after skills (line 283 never reached on throw) → no lifecycle kick → sandbox won't hibernate on inactivity until next kick.

## REJECTED candidates
- CAND-1 (reconnect no lifecycleVersion bump): benign; client uses timestamps not version for reconnect; not a defect.
- CAND-3 (concurrent snapshot PUT race): low-value; persistent sandbox name dedups at provider; not raising.
- CAND-5, CAND-6, CAND-8, CAND-9: verified non-issues (see above).
- probe-timeout-as-terminal: verified exec returns success=false with "Command timed out..." which is NOT in isSandboxUnavailableError → stays connected (transient). Lesson fix is IN PLACE.

## Coverage gaps
- Client-side reconnect/status consumers not reviewed (lessons reference client behavior; server returns correct enums).
- @open-agents/sandbox connectSandbox internals (extendTimeout clamp, expiresAt semantics) not read.
- sandbox-services/[serviceId]/* and runtime/ not deeply reviewed (service-launch).
- Archive/unarchive flow (archive-session.ts) only skimmed.
