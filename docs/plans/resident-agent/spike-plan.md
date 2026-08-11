# Resident Agent Service — Spike Plan

Execution plan for the validation spike. **Subordinate to [prd.md](prd.md)**
— where they disagree, the PRD wins. The spike is a set of experiments with
pass/fail criteria, thin enough to throw away. Every milestone records the
numbers the build-vs-fork decision needs.

**Timebox: ~3 weeks after P0 completes.** Kill criterion: if M0 + M1 are not
done by end of week 1 — with M4a *attempted* and any blocker recorded as
evidence — stop and reassess. (M4a depends on human-provisioned items; a
provisioning delay is recorded, not fatal.)

## What the spike must answer

| # | Question | Milestone |
| --- | --- | --- |
| 0 | Can we prove what the system did — deployed harness, core ledger, independent evaluator, fault injection | M0 |
| 1 | End-to-end cold-start latency: hibernated worker + sleeping sandbox → answer | M1, M3 |
| 2 | Persistence choreography: backup/restore with a real git repo, manifest-complete | M3 |
| 3 | A third-party Brain runs headless in a container, does real repo work, without write authority | M2a |
| 4 | Recovery: faults at named barriers produce safe outcomes without duplicate effects | M2b |
| 5 | Real external clients connect through OAuth and static-token front doors | M4a |
| 6 | The product shape works thin: fan-out, roll-up, blocked→resolve (evidence, not gate) | M4b |
| 7 | Cost per task, measured; owner-model swap with memory intact | M5 |

## Ground rules

- **Raw primitives**: Agents SDK `Agent`, Cloudflare Workflows, Sandbox SDK
  (track decided at M0 per current vendor recommendation). No
  `@cloudflare/computer`.
- **Versions**: M0 generates the authoritative dependency manifest from
  registries at kickoff; pin everything; re-resolve at midpoint. Prose
  versions in research docs do not drive the build.
- **No persistent DO→sandbox connections** — per-operation RPC only
  (outbound connections block hibernation and bill up to 15 min).
- **Every MCP tool returns fast** (Codex CLI 60 s default budget): `task`
  starts a turn and returns ids; progress is read, never awaited. Long
  calls emit progress notifications inside the 5-minute idle window.
- **Start from the inventoried examples** —
  [research/examples-and-boilerplates.md](research/examples-and-boilerplates.md)
  maps milestones to verified starting repos and flags the traps
  (deprecated `McpAgent` templates, stale pins).
- **Numbers land in the spike README as measured**, per the M0 benchmark
  method. One fixture, one brain, two gate clients. Breadth is the enemy.
- **Evidence over narration**: a milestone passes when the independent
  evaluator says so from ledger evidence, never when an agent reports done.

## Milestones

### P0 — Provisioning (human; before the clock starts)

The founder provides, per [prd.md §10/§11](prd.md): Workers Paid account +
payment method (Containers require paid; R2 may demand a card despite
marketing — verify by live probe), least-privilege API token
(Workers Scripts / R2 / Containers / Workers AI / AI Gateway / Logs scopes)
+ `CLOUDFLARE_ACCOUNT_ID`, domain/DNS decision (before any client
registration), IdP choice for `/authorize`, GitHub App installed on a
disposable fixture repo (App over PAT: installation tokens mint
unattended), Anthropic key or AI Gateway BYOK under the `default` alias,
Claude Code + Codex CLI client access, and budget ceilings. Full manifest:
[research/testing-and-observability.md](research/testing-and-observability.md).

### M0 — Harness first (target: days 1–3)

Deliverables, all proven by running them:

1. **Isolated deployed env** (`[env.test]` Worker set: own DO namespaces,
   R2 bucket, KV, Workflow bindings), fingerprinted by listing actual
   deployed resource identities — config files are not proof.
2. **Core evidence ledger** (schema versioned): correlation ids, sequenced
   status transitions, command argv/exit codes, before/after digests,
   redaction + secret-canary scan. App-level `run_id` threads Worker → DO →
   Workflow instance → container env → AI Gateway metadata (no first-party
   propagation exists — the ledger *is* the correlation).
3. **Independent evaluator**: deterministic, in a protected path
   implementing agents cannot edit, verdicts only from ledger evidence.
   Prove it by handing it a deliberately corrupted bundle.
4. **Deterministic fake Brain** (testagent-style) with the named barriers
   from [prd.md §9.3](prd.md); one fault injected end-to-end.
5. **Two test tiers wired**: vitest-pool-workers (DO SQLite/alarms/eviction
   helpers; Workflow introspection with mocked events/sleeps) and deployed
   e2e (containers, OAuth, hibernation — everything local emulation cannot
   reach, per
   [research/testing-and-observability.md](research/testing-and-observability.md)).
6. **Probes before reliance**: container stdout→observability (workers-sdk
   #12998 closed without a named mechanism), HTTPS-interception local/prod
   parity, R2 free-tier card requirement.
7. **Written artifacts**: benchmark method (phases, sample count, region,
   cache state), dependency manifest, static-token design
   (issuance/scoping/rotation/revocation), ADRs for registry store and
   Worker-vs-Sandbox DO topology.

Pass: prd.md §10 M0 row.

### M1 — Thin worker spine (target: days 4–5)

One service endpoint; opaque `workerId`; minimal account registry row;
minimal event ledger; named-DO routing (try the SDK RPC-transport primitive
before hand-rolling); idempotent `create_worker` (repeat key → same
result); alarm smoke; **launch the 24-hour soak immediately**. Measure DO
wake latency per the M0 method (no published numbers exist). Start from
`cloudflare/agents/examples/mcp-worker` + `mcp-rpc-transport`; do not build
on deprecated `examples/mcp`.

### M4a — Front door early (target: days 6–8)

`@cloudflare/workers-oauth-provider` (CIMD + DCR per the pinned 2026-07-28
revision) in front of the MCP handler; consent page; static-token mode.

- **Gate client 1: Claude Code** (native OAuth; PKCE always; CIMD selected
  when metadata advertises it). No `mcp-remote`.
- **Gate client 2: Codex CLI** via Owner-issued static bearer
  (`--bearer-token-env-var`) — exercises the decided second auth mode so it
  cannot ship as an inert guard.
- ChatGPT Developer Mode (web) and ChatGPT mobile read-only: canaries,
  recorded if accounts are provisioned, non-gating.
- Refusal matrix through the deployed entry point: expired, denied scope,
  foreign worker (`not_found`), revoked (measured-window), plus allow
  paths. Record Nth-worker consent behavior (does one client registration
  cover new workers under RFC 8707 resource scoping?).
- Start from `examples/mcp-worker-authenticated`; port GitHub-OAuth handler
  logic if needed; do **not** start from `remote-mcp-github-oauth`
  (deprecated `McpAgent`, stale pin). Reuse the oauth-provider
  `conformance/` harness (createTestHarness + synthetic consent) and layer
  `@modelcontextprotocol/conformance --suite auth` on top.

### M2a — Brain in a box (target: days 9–11)

Workflow provisions a Sandbox container, acquires the **pinned fixture**
([prd.md §9.4](prd.md) — named repo, pinned commit, expected patch,
expected test outcome, final digest, oracle-green-before-change) via a
read-only injected credential, runs the pinned Brain CLI headless
(pre-baked image; measure the cold `npm install` path once), Worker
verifies independently (tests + digests), **no external writes**. Prove the
container never sees a raw token and cannot push through the injected path
(the authority split, prd.md §7.8). Start from
`cloudflare/agents/examples/sandbox-coding-agent` +
`sandbox-sdk/examples/authentication`. The Workflow-wraps-sandbox glue has
no official example — write it; memoized `step.do` per operation.

### M3 — Persistence (target: days 12–14)

Backup manifest names everything continuation needs: `.git`, untracked
files, Brain session state/dotfiles, dependency caches, permission
metadata. squashfs → R2; restore; digests match before/after sleep;
next-day follow-up answered from restored state; phase latencies per the
M0 method (vendor 2 s/30 s numbers are baselines to re-measure).
Corrupt/missing backup → typed blocked/failed. **Backup GC**: R2 lifecycle
rule or sweeper proven (expired objects must not accumulate — TTL is only
checked at restore). **`mksquashfs` permission test**: 0600/0700 dotfiles
round-trip. Start from `sandbox-sdk/examples/time-machine`.

### M2b — Recovery (target: days 15–16)

Fault injection at every named barrier (§9.3) across Workflow, Worker DO,
Sandbox DO, container, and CLI process — each kill mechanism distinct and
scripted (no flaky manual kills). Outcomes: safe completion, safe retry, or
typed terminal state; never duplicate external effects, unbounded leases,
or unrecorded orphan processes. Mid-turn kill = idempotent restart (the
upstream reference orphans `claude -p`; cloudflare/agents#1829 — we are
ahead of the references here, by design).

### M4b — Product shape, thin (target: day 17)

Client-looped fan-out (≥3 workers from one session), account roll-up with
zero model wakes, blocked→cross-client resolve (`resolve_block` from a
second client). **Evidence for the decision review, not a go-gate.**

### M5 — Cost, then swap (target: days 18–21)

Cost attribution first: DO/Workflow/Sandbox/R2/model usage from real
provider evidence with provenance; BYOK `default`-alias proven before
capture (silent Unified-Billing fallback invalidates the comparison; the
2026-08-07 `env.AI` unification is days old — re-verify call shape). Then
the model swap with the **frozen rubric**: two swap points; memory-only
(workspace access structurally denied) vs memory+workspace; scored on
repeated/contradicted work vs the task graph, respect for a seeded
non-obvious recorded decision, time-to-first-productive-action. Thresholds
approved before the run; cost threshold: founder, before M5.

## Decision gates

Per [prd.md §10](prd.md): **substrate-gated go** (M0, M1, M4a, M2a, M3,
M2b + latency + cost), M4b informs. Auto-return-to-fork conditions are
listed in the PRD and are absolute. Hybrid remains a legitimate outcome.

## Explicit non-goals

No UI beyond consent page + recovery CLI. No worker-to-worker delegation.
No second Brain. No batch-create API. No warm pools. No retention
machinery. No production hardening beyond what the pass criteria name.
