# Fable round 2 — disposition of Kimi's audit, and the consolidation order

Author: Claude Fable 5 (final say). Date: 2026-08-11. Input: kimi-round1.md
(verdict: CONSENSUS: NOT-YET, six minimal changes).

## Disposition of Kimi's items — all accepted

| Kimi item | Disposition |
|---|---|
| (a1) Fan-out/roll-up demo should not be a go-gate | ACCEPT. The account registry stays in spike scope; M4b runs and records evidence, but the build-vs-fork decision gates on substrate criteria (M0, M1, M4a, M2, M3). Product-shape results inform, not gate. |
| (a2) Story 30 retention machinery overbuilt | ACCEPT. Spike ships redaction + secret-canary scan only. Retention/export/PITR/archive are v1 policy values, founder-TBD, no machinery in the spike. |
| (b1) Week-1 kill criterion miscalibrated | ACCEPT — reverses my trim 4. New criterion: M0 + M1 done by end of week 1, M4a *attempted* with any blocker recorded as evidence. A provisioning delay must not kill a healthy substrate spike. |
| (c1) Gate-client swap | ACCEPT — reverses my decision 12. Gate clients: Claude Code (OAuth + DCR/CIMD) and Codex CLI (Owner-issued static bearer token). ChatGPT Developer Mode on web joins mobile as canary. Rationale adopted verbatim: a decided auth mode with no gate client exercising it is the fork's "green but inert guard" pattern; and an autonomous build can drive Codex CLI headless but cannot drive ChatGPT's web UI. |
| (c2) Founder-input register mislabeled | ACCEPT. Provisioning items (Workers Paid account, automation token, domain/DNS, IdP choice, GitHub App, Anthropic key) are pre-M0 blockers, now a named P0 milestone. Data jurisdiction blocks M1 (DO placement is permanent). |
| Blind spot 1: no single source of truth | ACCEPT — the decisive item. Resolution: `prd.md` is written as the single binding spec (Codex PRD + Fable trims + Kimi changes integrated); `spike-plan.md` is rewritten to match; the three review docs move to `reviews/` with a precedence header stating they are historical record. |
| Blind spot 2: provisioning milestone + independent evaluator | ACCEPT. P0 provisioning milestone with founder as named decider per item. The M0 pass/fail evaluator is deterministic, lives in a protected path implementing agents cannot edit, and derives verdicts only from ledger evidence. |
| Blind spot 3: fixture/oracle spec | ACCEPT. M2a entry criterion: named fixture repo, pinned commit, expected patch, expected test outcome, final digest, oracle-run-green-before-change. Reconciliation of "one fixture" vs the founder's "real sample projects" (plural): the spike uses one pinned fixture; v1 acceptance runs the story-derived e2e suite against at least two real sample projects. |
| Blind spot 4: MCP/OAuth revision pinning + static-token ownership | ACCEPT. The PRD pins MCP spec revision 2026-07-28 (stateless lifecycle), CIMD metadata requirements for Claude Code selection, RFC 8707 resource indicators, and progress-notification cadence (beat the 5-minute idle window). Static-token issuance/scoping/rotation/revocation design is an M0 work item, owner: the front-door epic. |
| Blind spot 5: platform traps into pass criteria | ACCEPT. M3 gains the backup-GC rule (R2 lifecycle rule or sweeper; expired objects must not accumulate) and the `mksquashfs` permission test (0600/0700 dotfiles). M4a revocation acceptance becomes a measured-window criterion (record propagation time; flag if it exceeds the documented KV consistency expectations). The Workflow instance-ID convention is pinned in the PRD: `${workerId}-turn-${seq}`, ≤100 chars, duplicate-live-ID-throws as the idempotency mechanism. |

## Consolidation order

1. `prd.md` (new) — the binding spec. Where any review document disagrees
   with it, `prd.md` wins.
2. `spike-plan.md` (rewritten) — P0 provisioning gate; M0 harness; M1 thin
   spine; M4a front door early; M2a brain; M3 persistence; M2b recovery;
   M4b product shape (evidence, not gate); M5 cost then swap. Timebox ~3
   weeks. New kill criterion per (b1).
3. `reviews/` — codex-round1, fable-round1, kimi-round1, fable-round2, kept
   as the consensus record, each subordinate to `prd.md`.

Round-2 question to both reviewers: verify the consolidated `prd.md` +
`spike-plan.md` capture every accepted item, list only remaining blockers,
and state CONSENSUS: YES or NOT-YET.
