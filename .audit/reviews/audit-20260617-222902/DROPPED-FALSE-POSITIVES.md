# DROPPED / REFUTED FINDINGS — Deep Adversarial Review (audit-20260617-222902)

What the adversarial verification pass caught and the triage pass declined to file.
Kept for audit transparency.

---

## 1. Sandbox stuck permanently in `hibernating` if the durable workflow run is evicted mid-evaluation (stale-lease recovery only covers `active`)

- **Original severity:** high (verifier-corrected: medium)
- **Domain:** sandbox-lifecycle
- **Verifier summary:** REPRODUCTION/CORRECTNESS=confirmed, GUARD/FRAMEWORK/CONTEXT=refuted
- **Decision:** DROPPED — framework-mitigated (Vercel Workflow durability), with a documented residual nuance.

### Why dropped
- The factual premise is accurate: `apps/web/lib/sandbox/lifecycle-kick.ts:89`
  (`isLifecycleRunStale`) only treats `lifecycleState === "active"` as a stale,
  re-kickable run; a `hibernating` transient state is not covered by the stale-lease
  recovery path.
- **But** the sandbox lifecycle runs on the durable Vercel Workflow runtime
  (`workflow@^4.2.0-beta.72`, `apps/web/package.json:81`). Durable runs resume
  across serverless eviction, OOM, and redeploy (runs are pinned to their
  deployment; sleep is durable; interrupted steps re-execute from the start).
  On resume, `evaluateSandboxLifecycle` re-runs to completion and clears the lease
  via either the success path (`buildHibernatedLifecycleUpdate`) or the catch path
  (`lifecycleState="failed"`, `lifecycleRunId=null`).
- The `isLifecycleRunStale` / `shouldStartLifecycle` / status-route guards only
  block a **new** concurrent workflow from starting; they do not prevent the
  original durable run from finishing. So there is no permanent wedge for the named
  trigger (mid-evaluation eviction).
- The only residual caveat (not enough to file): the wedge would require the
  durable workflow run to be **permanently lost**, not merely evicted — a
  plausible-but-not-guaranteed scenario rather than a guaranteed crash class. No
  open issue duplicates this; logged here as a defense-in-depth note rather than a
  filed regression.

---

## 2. Low-severity items (below MEDIUM filing threshold — not filed, recorded for awareness)

These were not in the "survivors" set but were carried as `lowsForAudit`. They are
real but low; tracked in `COVERAGE-GAPS.md` rather than filed as regressions.

### 2a. Create route returns 500 and skips the lifecycle kick if per-user skill install throws, despite the sandbox VM and DB state already being persisted
- **Severity:** low. **Domain:** sandbox-lifecycle. Error handling / partial-success
  inconsistency; not a correctness or security regression.

### 2b. `/api/models` GET has no authentication and exposes the full configured gateway model catalog (ids, names, descriptions, context windows, pricing) to anonymous callers
- **Severity:** low. **Domain:** inference-models. Information disclosure of
  non-sensitive catalog metadata. Worth tightening, but below the medium bar.

---

## Note on the inference-models-1 finding's inaccurate triggers
The inference-models-1 finding **survived** and was filed as Issue 2, but two of its
three claimed triggers were **inaccurate on the checked-out branch** and are worth
flagging here as verifier over-reach (the verifier read the `loops-ux-audit`
worktree, not the committed branch):
- `apps/web/lib/inference/fetch-profile-models.ts` does **not exist** on this branch
  (only in worktrees). The cited `x-api-key` → `/v1/models` fetch mechanism is absent.
- The create POST route does **not** auto-fire a fetch; it only persists the profile.

The underlying defect (no host guard on `baseUrl`, with the Anthropic SDK issuing a
server-side authenticated request to a user-chosen host via the **test route** and
**chat path**) is real and is what Issue 2 captures. The inaccurate trigger details
were stripped from the filed issue body.
