# Fable round 1 — arbitration of Codex's review

Author: Claude Fable 5 (the coordinating model; holds final say per the
founder's direction). Date: 2026-08-11. Input: the full research package plus
codex-round1.md. Standing constraints from the founder: no premature
optimization; the system must be buildable autonomously by workflows and
subagents; e2e-tested with real sample projects; confirmed working, not
implied.

## Verdict

Codex's review is substantially correct about the control plane being the
weak layer, and most of its findings are accepted. Its PRD is a strong
skeleton with the right TBD discipline. Its main failure mode is scope
inflation for a validation spike — several additions are product
requirements dressed as spike requirements. I accept the corrections,
adopt the reordering logic, and trim the build surface.

## Codex findings — disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | "Any agent, anywhere is solved" overstated | ACCEPT. Story 1 rewording: "no manual client pre-registration," one-time Owner consent explicit. README synthesis line gets the same fix. |
| 2 | Credential possession vs authority | ACCEPT — the most valuable finding. Clone/pull uses a read-only injected credential; push/PR/comment/merge run as Worker-side deterministic integrations with distinct write credentials, outside the container. M2 design changes accordingly. |
| 3 | No account registry design | ACCEPT. A minimal account registry/read model enters spike scope (physical store decided in M0 via ADR). The founder's canonical flows require it; primitives alone cannot demo the product. |
| 4 | Endpoint topology undecided | ACCEPT and DECIDE: one account-level MCP endpoint, `workerId` as a parameter. Per-worker endpoints rejected (consent-per-worker kills the fan-out story). |
| 5 | M2 durability at wrong abstraction | ACCEPT and DECIDE: "survive a mid-turn kill" means safe idempotent restart completing without duplicate effects, plus truthful terminal states. Process reattachment is not promised. `reconciliation_required` is a failed unattended gate, correctly. |
| 6 | Persistence sequenced after recovery test | ACCEPT. Order becomes: real brain first (no kills), then backup/restore with a named manifest, then fault injection. Backup manifest must enumerate `.git`, untracked files, brain session state, dependency caches. |
| 7 | "Truth tables" too strong | ACCEPT. Memory storage classes: observed evidence / system projections / declared decisions / narrative. Completion and verification status derive only from the first two. |
| 8 | M1 overbuilt | ACCEPT. M1 ships minimal worker state + the M0-required evidence events. Typed task graph arrives with the first real turn (M2 needs it to record work); FTS5 and condensation are post-spike. |
| 9 | M5 has no fixed oracle | ACCEPT. Rubric, fixture, evaluator version, and thresholds frozen before the run; cost instrumentation precedes provider comparison. |
| 10 | Benchmark method unreproducible | ACCEPT. M0 versions the measurement method (phases, sample count, region, cache state). Values stay TBD until the method is approved — no invented numbers. |
| 11 | "No UI" conflicts with consent/recovery | ACCEPT. Non-stories amended: no *dashboard*; a consent page and an out-of-band recovery CLI are required surfaces. |
| 12 | Risk ranking | ACCEPT with one edit: security/side-effect containment and turn idempotency move to the top; "competitive window" moves out of the technical risk table into a product-strategy note. It stays in the package — it is real context for pace — but it is not a substrate risk. |
| 13 | Version drift inside the package | ACCEPT. Research docs carry their fetch-date versions by design; a note is added stating the examples-and-boilerplates doc is the freshest snapshot and that M0 generates the authoritative manifest from registries at kickoff. |
| 14 | Competition claim too broad | ACCEPT. Wording narrowed to "no confirmed vendor-native product combining all three properties was found as of 2026-08-11." |

## Trims — where Codex overbuilds (final-say calls)

1. **`create_workers` batch tool: cut from v1.** Story 19's fan-out is the
   *client* looping `create_worker` with idempotency keys — visiting agents
   are good at loops, and per-item results/quota-splitting/partial-failure
   semantics buy no new capability. Revisit only if M4b measurements show
   client tool-call budgets make loops impractical. Story 20 (legible
   quotas) applies to the single-create path.
2. **`require_approval` + `approve_action`: schema yes, flow later.** The
   grant vocabulary keeps all three values (cheap, avoids a migration), but
   the spike exercises `deny`/`allow` only. The approval flow and
   `actions:approve` scope are v1-product work, not spike work.
3. **Evidence bundle: minimum core first.** M0 ships the core bundle
   (correlation ids, status transitions with sequence numbers, command
   argv/exit codes, before/after digests, redaction scan, independent
   verdict). The remaining fields (grant snapshot hashes, jurisdiction,
   full cost provenance) attach at the milestone that produces them. The
   full list is the v1 contract, not the M0 entry bar.
4. **Spike shape: keep five milestones, adopt the ordering.** Codex's
   8-phase order is correct sequencing but reads as a program plan. The
   spike keeps M0–M5 with M2 split internally (M2a brain / M2b recovery,
   M2b after M3) and M4 split (M4a front door early, M4b product shape).
   Timebox honestly extended to ~3 weeks; the week-1 kill criterion becomes:
   M0 + M1 + M4a done by end of week 1 or stop and reassess.
5. **16 tools is the v1 surface, not the spike surface.** Spike implements:
   `whoami`, `create_worker`, `task_worker`, `ask_worker`,
   `get_worker_status`, `get_account_status`, `get_turn`, `cancel_turn`,
   `resolve_block`, `stop_worker`, plus resources. `destroy_worker`,
   `set_worker_grants`, `list_clients`, `revoke_client` are v1; revocation
   is exercised in M4a via the OAuth layer directly.

## Decisions on Codex's 14 founder questions

Decided now under delegated authority (flagged ones need founder
confirmation before the relevant milestone, none block M0):

1. One-time human OAuth consent per client: ACCEPTABLE. Additionally the
   front door offers Owner-issued scoped static bearer tokens for headless
   clients (Codex CLI pattern). Decided.
2. Brain never performs authenticated git writes. Decided (finding 2).
3. One account-level endpoint. Decided (finding 4).
4. Mid-turn kill = safe idempotent restart + truthful states. Decided
   (finding 5).
5. The spike proves thin versions of fan-out, account status, and blocked
   state (M4b). The canonical flows are the product; primitives alone
   cannot decide build-vs-fork. Decided.
6. First brain: Claude Code. Launch claim: owner-model swap. Brain swap:
   fast-follow. Decided (already package position).
7. Spike-fixture grant defaults: clone/read, push to worker-prefixed
   branch, open PR, comment = allow; merge, delete branch = deny.
   PROPOSED — founder confirms before M2a.
8. Authority order on disagreement: observed evidence > system projections
   > declared decisions > narrative; disagreement produces a blocked state
   with a drift reason. Decided.
9. Latency: < ~15 s stays the provisional target; whether it is a hard
   gate is confirmed by the founder at the decision review, with warm-pool
   cost as an explicit alternative. Cost threshold: FOUNDER INPUT required
   before M5. Not invented.
10. Destroy semantics PROPOSED: delete workspace, backups, and memory
    content; retain the audit skeleton (ids, digests, external-action
    records) under retention policy. Founder confirms before v1 freeze.
11. Owner admin surface: owner-scoped MCP tools + recovery CLI + minimal
    consent page. No dashboard. Decided.
12. Gate clients: Claude Code (OAuth) and ChatGPT Developer Mode on web
    (OAuth client #2). Codex CLI exercised via static token as the headless
    path. Decided.
13. ChatGPT mobile read-only status: canary, not gate. Decided.
14. Auto-return-to-fork conditions: Codex's list adopted verbatim
    (credential boundary unenforceable, unrecoverable duplicate effects,
    restore failure, real-client auth impossibility, missing independent
    evidence). Decided.

## Founder-input register (not blocking M0)

Cost/task go-no-go threshold (before M5); latency hard-gate confirmation
(decision review); spend ceilings (Cloudflare, model, GitHub); retention
and privacy values; data jurisdiction; destroy-semantics confirmation;
grant-default confirmation (before M2a); new-repo name.

## What the consensus must NOT do (standing guard)

No new subsystems beyond: front door + registry + worker DO + turn
workflow + sandbox brain + ledger + harness. No warm pools, no queues, no
multi-region, no billing mechanics, no delegation trees, no second brain
in the spike. Additions after this round need to displace something of
equal weight or carry evidence the spike fails without them.
