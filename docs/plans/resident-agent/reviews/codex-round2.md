# Codex round 2 — verification of the consolidation

Model: gpt-5.6-sol, xhigh, same thread as round 1. Returned 2026-08-11.
Verbatim.

---

## Round-1 finding closure

All 14 findings are addressed at the design level, but two are weakened by the executable spike criteria.

- Findings 1, 3, 4, 7, 8, 9, 10, 11, and 13 are implemented in `prd.md` §§1, 7.1–7.2, 7.7, 7.11, 9.4–9.6 and `spike-plan.md` M0–M5: auth no longer implies unattended consent, the registry and single endpoint are decided, claim provenance is typed, M1 is thin, the oracle and benchmark method precede measurement, owner surfaces exist without a dashboard, and dependencies are pinned at kickoff.
- Finding 2 is architecturally implemented in `prd.md` §7.8 and M2a: repository acquisition is read-only and write authority stays with Worker operations; however, the spike never actually exercises a Worker-side write.
- Finding 5 is correctly decided in `prd.md` §7.6—mid-turn kill means idempotent restart and completion, not process resumption—but `spike-plan.md` M2b weakens this to any typed terminal state.
- Finding 6 is implemented by ordering M3 before M2b and specifying the backup manifest, GC, corrupt-backup, permission, and `mksquashfs` tests.
- Finding 12 is acceptably dispositioned in `fable-round1.md`: the binding PRD now embeds security, authorization, recovery, and evidence as go-gates, so rewriting the historical risk ranking adds no build value.
- Finding 14 is acceptably dispositioned as a research-document wording correction rather than a spike dependency.

## Trim and reversal safety

I accept every trim and reversal.

- Removing `create_workers` avoids an unnecessary API while preserving fan-out through idempotent client-looped `create_worker` calls.
- Deferring approval execution while reserving `require_approval` preserves schema compatibility without building an approval subsystem.
- Splitting M0-core from full-v1 evidence is sound because milestone-produced fields remain mandatory once applicable.
- Making M4b evidence-only correctly separates substrate viability from product-shape validation; failure must constrain product claims, but need not invalidate Cloudflare.
- Trimming Story 30 to redaction and secret-canary checks removes premature retention infrastructure while retaining the spike's security boundary.
- Gating week one on M0+M1, with a deployed M4a attempt or recorded P0/platform blocker, avoids judging Cloudflare OAuth before the Worker spine exists.
- Codex CLI with an Owner-issued static bearer token is a stronger second gate than ChatGPT: it is reproducible and directly validates unattended client access, while ChatGPT remains a useful canary.

The only load-bearing pushback is on recovery and side effects: the system's go decision explicitly depends on surviving a mid-execution failure without duplicating an external effect, so that path cannot remain hypothetical.

## Remaining contradictions and minimal changes

1. Inline the complete scope mapping and per-tool contracts into `prd.md` §7.3, because its normative reference to historical `reviews/codex-round1.md` violates the declared single-source-of-truth rule.
2. Make `spike-plan.md` M2b require the `during-execution` kill to restart and complete without duplicates, with `reconciliation_required`, `failed`, or `blocked` counting as failure of that unattended gate.
3. Add one disposable deterministic Worker-side GitHub write to M2b, fault after provider success but before ledger acknowledgement, and prove reconciliation returns the same provider object without a second effect.
4. Require Codex's static-token gate to perform an allowed Worker operation and run the applicable expiry, scope-denial, foreign-worker, and revocation tests, rather than merely "connect."
5. Assign the full hibernated-Worker-to-final-answer latency benchmark to a post-M2a/M3 deployed run using the M0-approved sampling method, because M1 wake and M3 restore timings alone cannot satisfy `prd.md` §8.
6. Split Story 16 so list/stop/audit remain spike-scoped while archive/destroy moves to v1, and move Story 20 quotas to v1 unless a concrete milestone test is added.
7. Define M5 cost—including storage and egress or `unknown` with provenance—as go-gating while making the model-swap study explicitly non-gating.
8. Define whether M0's `run_id` is an additional correlation identifier or aliases `turnId`/Workflow run ID, and require AI Gateway propagation only for provider-backed runs.

CONSENSUS: NOT-YET
