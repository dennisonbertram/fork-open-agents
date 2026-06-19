# Epic: Per-Repo Background PR-Review Agent That Extracts Learnings

Prepared: 2026-06-09

Status: planning, not ready for implementation

GitHub issue: https://github.com/dennisonbertram/fork-open-agents/issues/264

---

## Executive Summary

Every connected repo gets a built-in, opt-in background agent that watches PR
webhook events (`pull_request closed+merged` and `pull_request_review.submitted`)
and extracts durable learnings — patterns, gotchas, conventions, anti-patterns —
each with evidence pointers (PR URL, file paths, review-comment URLs). Learnings
are persisted to a new per-repo `repoLearnings` store in the Open Agents DB,
deduped via a 5-dimension overlap score, surfaced in a new `/settings/learnings`
Insights feed (table + Sheet detail), and optionally proposed as a versioned PR
committing learning files into the repo.

The arc rides the existing background-agents subsystem end-to-end: a new
normalized trigger kind `github.pull_request_review`, the existing
dispatcher/store/executor/event-timeline, the existing GitHub App webhook route,
and the existing redaction primitive. It composes with the concurrent
"observable, governable run" epic and explicitly does NOT re-specify end-of-run
SKILL.md auto-capture, the in-loop review verdict step, the approval gate, or
run cost/budget — those are owned by that epic; this feature depends on them and
calls them. This is the distinct PR-WEBHOOK-TRIGGERED learnings arc.

The four implementation slices are:

1. `#273` — durable store + DB-persist extraction on PR-merge (shadow, no UI)
2. `#274` — `pull_request_review` webhook subscription + readiness + enable toggle
3. `#275` — `/settings/learnings` Insights feed (table + Sheet + toggle)
4. `#276` — surface learnings to agent Phase-1 + optional propose-via-PR (gated)

## Why This Matters

Open Agents already runs agent work inside connected repos, but every session
starts cold — it relearns the same conventions and re-hits the same gotchas
because nothing durable survives between runs. Atlassian's production deployment
across 1,900+ repos shows extracting learnings from PR-review interactions cut
median PR cycle time 30.8% and drove a 38.7% code-resolution rate. CodeRabbit
and compound-engineering both show a curated, deduped, usage-decayed learnings
KB is the difference between an agent that compounds and one that plateaus.

For this codebase the payoff is local-first context: future agent sessions query
the learnings store (by `affectedPaths` glob + type + tags) in Phase 1 before
any web search, so the agent already knows "this repo redacts payloads before
persist," "never db:push in prod," "background agents v1 doesn't mutate."
Without it, every run pays full discovery cost. With the run-ledger keystone
(run epic #222), each learning can carry a "this saved ~$X" ROI strip.

Cross-references: #240 (live-runs dashboard / home surface), #241 (workflow
builder), #222 (cost legibility / run-ledger keystone).

## User/Operator Path Protected

An authenticated user with a connected GitHub App installation opens
`/settings/learnings`, sees a per-repo feed of extracted learnings
(type / confidence / evidence), and can enable/disable the per-repo PR-review
learnings agent (default OFF, inert until enabled). When enabled and a PR or
review webhook fires for an allowlisted repo, a background-agent run extracts
candidate learnings, dedupes them against the store, persists accepted ones, and
(if `outputMode` opt-in) proposes a PR.

The path must never: leak secrets/tokens/PII into learning rows or events; post
or commit anything to a repo the user lacks write access to; treat
attacker-controlled PR text as instructions; or silently stop (a learnings agent
that goes dark must look different from "no notable PRs").

## Key Research Findings

- **GitHub has no `merged` webhook action.** `merged` is a boolean on the
  `pull_request` object delivered on a `closed` action. Filtering for
  `action='merged'` silently never fires. Detection must read
  `payload.pull_request.merged` on `action='closed'` in `github-events.ts`.
  The existing webhook route already filters PR close/reopen at
  `app/api/github/webhook/route.ts:71-72`; merged detection must not conflict
  with that path.

- **`pull_request_review` is not currently handled.** The event is absent from
  `requiredGitHubAppEvents` in `lib/background-agents/github-app-webhooks.ts:7-11`
  and from the event switch in `app/api/github/webhook/route.ts:188-289`. It
  must be added to both, plus `normalizeGitHubBackgroundEvent` in
  `lib/background-agents/github-events.ts`. Only `pull_requests:read` scope is
  needed for the read/extract arc — no new write scope.

- **Idempotency via X-GitHub-Delivery.** The existing
  `buildBackgroundRunIdempotencyKey` encodes `agentId:triggerId:source:kind:externalId`
  with a unique DB constraint + `onConflictDoNothing`. Review events must extend
  `externalId` to `pull_request_review:{review_id}:{action}` so replayed
  deliveries are suppressed cleanly. X-GitHub-Delivery is the at-least-once
  dedup GUID with a 7-day TTL retry window.

- **5-dimension dedup, not string equality.** Paraphrased duplicates escape
  string matching. The dedup strategy uses a heuristic `dedupSignature`
  (normalized hash of problem|rootCause|solution|paths|prevention) as a cheap
  unique-index gate for near-exact dupes, plus an LLM 5-dimension overlap score
  during extraction for paraphrased dupes. High overlap (4–5) updates the
  existing row with `id` stable; moderate (2–3) creates a new row flagged
  `consolidation_review`; low (0–1) creates a fresh row. `dedupSignature` is
  NOT NULL — Postgres treats NULLs as distinct under a unique index, so a null
  signature silently bypasses dedup.

- **Staleness and usage decay.** Learnings should decay from `lastUsedAt`, not
  `createdAt`. Never-used learnings keep full confidence forever and become
  noise. Archive (not delete) at `confidence=speculative` + `usageCount=0`.
  Flag stale (>90 days, repo scope) for a refresh-style scan. Confidence
  inflation risk: start single-source learnings at `medium`; promote to
  `high`/`proven` only on corroborating evidence.

- **Reviewer injection.** Review-comment authorship can differ from PR
  authorship; a malicious reviewer can plant a "learning." Mitigate by treating
  all PR/review text as untrusted DATA in the extraction prompt, scoring
  provenance in the LLM-as-judge, and starting reviewer-sourced learnings at
  `confidence="low"`.

- **External evidence.** Atlassian Rovo (1,900+ repos, 30.8% cycle-time
  reduction), CodeRabbit (curated deduped KB), and compound-engineering
  `ce-compound` all validate that a per-repo KB extracting reviewer signals is
  the canonical pattern for agents that compound rather than plateau.

- **The approval gate for propose-via-PR does not currently exist in tree.**
  There is no `requireApproval` in `apps/web/lib/background-agents`. Slice #276
  is explicitly blocked by a real approval-gate issue; do not ship the write
  path until that gate lands or the run epic's `outputMode=ready_pr` approval
  path is proven. The DB-persist arc is unaffected.

## System Design

### Source Of Truth

GitHub owns: PR/review events, diff + full file contents (fetched via
`withScopedInstallationOctokit` — never trusted from the webhook body alone),
review comments and their URLs, and X-GitHub-Delivery as the dedup GUID.

Open Agents owns: the per-repo learnings store (`repoLearnings` +
`repoLearningEvidence` + `repoLearningExtractionRuns` rows), the
dedup/merge/decay logic, the extraction prompt + LLM-as-judge quality gate +
actionability filter, the enable/disable toggle and per-repo agent config, the
background-agent run + event timeline + redaction status, the
`/settings/learnings` feed UI, and the Phase-1 surfacing path.

The repo-committed learning file (if the optional PR slice ships) is a
PROJECTION of the Open Agents row, not the source of truth. Open Agents
reconciles on conflict. The optional PR write path and approval gate are OWNED
BY the concurrent run epic; this feature calls them, it does not re-specify
them. `repoLearnings` is a NEW first-class repo-scoped store and is explicitly
NOT `backgroundAgentOutputs` (those are run-ephemeral per-output blobs). Keep
`repoLearnings` (review insights) distinct from `agentToolEntries` (tool
provenance, owned by agents-foundation #244 work).

### Data Model

Three new tables in `apps/web/lib/db/schema.ts`. Follow existing conventions:
text PK via nanoid, snake_case columns, `userId` FK with cascade delete, JSONB
columns with explicit `.default([])` to avoid NULL.

```ts
// repoLearnings — one durable row per deduped insight, cross-run queryable
export const repoLearnings = pgTable("repo_learnings", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  installationId: integer("installation_id"),
  type: text("type", { enum: ["bug","convention","architecture","design","workflow","anti_pattern"] }).notNull(),
  scope: text("scope", { enum: ["file","module","repo"] }).notNull().default("repo"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  rootCause: text("root_cause"),
  solution: text("solution"),
  prevention: text("prevention"),
  affectedPaths: jsonb("affected_paths").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  severity: text("severity", { enum: ["critical","high","medium","low","info"] }).notNull().default("info"),
  confidence: text("confidence", { enum: ["proven","high","medium","low","speculative"] }).notNull().default("medium"),
  status: text("status", { enum: ["active","consolidation_review","archived","superseded"] }).notNull().default("active"),
  dedupSignature: text("dedup_signature").notNull(), // NOT NULL — deterministic hash, computed pre-insert
  supersedesLearningId: text("supersedes_learning_id"),
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  sourcePrNumber: integer("source_pr_number"),
  sourcePrUrl: text("source_pr_url"),
  committedFilePath: text("committed_file_path"), // set only by #276 projection; null until then
  createdBy: text("created_by").notNull().default("pr_review_learnings_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("idx_repo_learnings_repo").on(t.userId, t.repoOwner, t.repoName),
  index("idx_repo_learnings_status").on(t.userId, t.status, t.lastUsedAt),
  uniqueIndex("idx_repo_learnings_dedup").on(t.userId, t.repoOwner, t.repoName, t.dedupSignature),
]);

// repoLearningEvidence — evidence excerpts (redacted before persist; dropped if failed/blocked)
export const repoLearningEvidence = pgTable("repo_learning_evidence", {
  id: text("id").primaryKey(),
  learningId: text("learning_id").notNull().references(() => repoLearnings.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["pr_url","review_comment","file_excerpt","command_output","test_failure"] }).notNull(),
  ref: text("ref").notNull(),
  excerpt: text("excerpt"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_learning_evidence_learning").on(t.learningId)]);

// repoLearningExtractionRuns — one row per extraction run; links to backgroundAgentRuns for audit/ROI
export const repoLearningExtractionRuns = pgTable("repo_learning_extraction_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  backgroundAgentRunId: text("background_agent_run_id"), // FK-style to backgroundAgentRuns.id
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  prNumber: integer("pr_number"),
  triggerKind: text("trigger_kind").notNull(),
  candidatesExtracted: integer("candidates_extracted").notNull().default(0),
  accepted: integer("accepted").notNull().default(0),
  merged: integer("merged").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  errorKind: text("error_kind"), // typed; see error taxonomy in Failure Modes
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("idx_learning_extraction_repo").on(t.userId, t.repoOwner, t.repoName)]);
```

After editing `schema.ts`: run `bun run --cwd apps/web db:generate` and commit
the generated `.sql`. No new `usage_events` columns here — ROI depends on the
run epic adding `runId`/`sessionId` FK to `usage_events` (~`schema.ts:1494`);
`backgroundAgentRunId` on the extraction-run row is the forward hook.

### Integration Points

Existing files touched:

- `apps/web/lib/background-agents/types.ts` — add `github.pull_request_review`
  to `backgroundAgentTriggerKinds`; extend `buildBackgroundRunIdempotencyKey`
  externalId to `pull_request_review:{review_id}:{action}`.
- `apps/web/lib/background-agents/github-events.ts` — extend
  `normalizeGitHubBackgroundEvent` to parse `pull_request_review.submitted`
  (review id/state/body/html_url/user) and to surface `pull_request.merged`
  (boolean on `action=closed`) as a `merged` condition field.
- `apps/web/lib/background-agents/agent-spec.ts` — extend `fieldsForTrigger()`
  for `github.pull_request_review` (actions: `submitted`; states:
  `approved|changes_requested|commented`).
- `apps/web/lib/background-agents/github-app-webhooks.ts:7-11` — add
  `pull_request_review` to `requiredGitHubAppEvents`; readiness check confirms
  subscription. Needs only `pull_requests:read` — no new write scope for the
  read/extract arc.
- `apps/web/app/api/github/webhook/route.ts:188-289` — add
  `pull_request_review` case to the event switch routing into
  `dispatchBackgroundTriggerEvent`; for `pull_request 'closed'` read
  `payload.pull_request.merged` to map to a `merged` condition (NOT a `merged`
  action).
- `apps/web/lib/background-agents/executor.ts` — extraction body: fetch PR diff
  + full modified files via `withScopedInstallationOctokit` (head-SHA-anchored,
  never trusting the webhook body), run extraction prompt, apply LLM-as-judge +
  actionability gate, call learnings store; record events via
  `recordBackgroundAgentEvent` with `redactionStatus`.
- `apps/web/app/settings/nav-items.ts` — add Learnings under the Insights group.
- `packages/agent/open-agent.ts` — Phase-1 surfacing: query
  `searchLearnings(repo, affectedPaths, type, tags)` before web search
  (local-first context injection).

New files:

- `apps/web/lib/learnings/store.ts` — `createLearning`, `updateLearning`,
  `listLearningsForRepo`, `searchLearnings`, 5-dimension dedup/merge,
  confidence/usage bookkeeping.
- `apps/web/lib/learnings/extraction.ts` — prompt assembly (untrusted PR text
  as DATA), Zod structured parse, LLM-as-judge + actionability filter, redaction
  call + verifier.
- `apps/web/lib/learnings/dedup.ts` — 5-dimension overlap scoring +
  deterministic `dedupSignature` computation.
- `apps/web/lib/learnings/builtin-agent.ts` — `ensureRepoLearningsAgent(userId,
  owner, repo)`: idempotently creates/updates the built-in `backgroundAgents`
  row + triggers when the user enables the feature for a repo.
- `apps/web/lib/learnings/repo-projection.ts` — optional propose-via-PR
  projection; reuses run epic's approval gate + `ready_pr` write path (slice
  #276 only).
- `apps/web/app/api/learnings/route.ts` + `[learningId]/route.ts` — GET list
  (auth + owner), PATCH (archive / confidence override), DELETE.
- `apps/web/app/settings/learnings/page.tsx` — `SettingsPageHeader` +
  `LearningsSection`; `useSWR` feed + per-repo enable toggle backed by
  `ReadinessVerdict`.
- `apps/web/app/settings/learnings/learnings-section.tsx` — per-repo
  `ReadinessVerdict` + enable `Switch` + extraction run stats.
- `apps/web/app/settings/learnings/learning-feed-table.tsx` — `Table` feed with
  type/confidence `Badge` chips, filters, per-row kebab (`DropdownMenu`).
- `apps/web/app/settings/learnings/learning-detail-sheet.tsx` — right `Sheet`
  with Evidence/Insights `Tabs`, AI-trust caption, feedback affordance.

### UX Model

Entry point: `/settings/learnings` under the Insights nav group (new nav item).

Per-repo row: a `ReadinessVerdict` block ("Learnings agent: ready |
action-needed | unavailable | error") and an enable `Switch` (default OFF,
inert until enabled). Readiness reflects allowlist + installation +
event-subscription state so operators see why nothing extracted.

Feed: `Table` with columns Title (leading type icon) | Type (`Badge`:
bug=red, convention=blue, architecture=violet, anti_pattern=amber,
design/workflow=gray) | Confidence (`Badge` mapped to `ReadinessVerdict` color
taxonomy: proven/high=emerald, medium=amber, low/speculative=muted) | Affected
paths (truncated chips) | Evidence (count badge + external-link) | Updated
(sortable, `aria-sort`). Filters: type / confidence / status pills + "Filter
learnings" search.

Detail: right `Sheet` with Type/Scope/Severity/Confidence key-value rows, the
description (the WHY), root cause / solution / prevention sections, and
Evidence/Insights `Tabs` with `(N)` counts linking to PR + review-comment URLs.
Per-row kebab `DropdownMenu`: Archive (via `AlertDialog`) / Override confidence
/ Open source PR.

States: empty ("No learnings yet — enable the agent for a repo and they'll
appear after the next pull request" + enable CTA, never a dead toggle); loading
(`Skeleton` matching the table layout); success (`Sonner` toast "Learning agent
enabled"); error (inline `text-destructive` + `ReadinessVerdict`
operator-details disclosure, never exposing env var names).

AI trust: each learning carries a "Powered by AI — confidence: \<label\>, verify
via evidence" caption + Helpful/Not-helpful affordance. Confidence is shown as
label + evidence link, never a bare number. Badge uses text+color (never
color-alone). `Sheet` returns focus to the triggering row on close. `aria-sort`
on all sortable columns.

Reuses without forking: `SettingsPageHeader`, `SettingsSection`
(`rounded-xl border bg-card p-5`), `ReadinessVerdict`, `useSWR` + `Skeleton` +
inline empty/error, `Badge`, `Table`, `Sheet`, `Tabs`, `Tooltip`,
`DropdownMenu`, `AlertDialog`, `Sonner`.

### Security And Safety

Trust boundary inherits from background-agents: signed webhook
(`x-hub-signature-256` HMAC-SHA256 verified constant-time at
`webhook/route.ts` before any business logic), `BACKGROUND_AGENTS_ALLOWED_REPOS`
allowlist, installation-scoped Octokit, `verifyRepoAccess` before any mutation.

Prompt injection: PR titles, descriptions, bodies, commit messages, and review
comments are attacker-controlled. The extraction prompt treats ALL PR text as
untrusted DATA, never instructions. Output is parsed as structured JSON (Zod)
and never eval'd. LLM-as-judge + actionability filter reject
vague/speculative/injected content before persist.

Redaction (reuse, do not fork): every evidence excerpt and every event payload
passes through `redactHarnessPayload` (BEARER, sk-/ghp-/gho-/ghs-/ghu-/ghr-
token shapes, ENV_ASSIGNMENT, ARTIFACT_CONTENT_KEYS). `backgroundAgentEvents.redactionStatus`
(`not_required|passed|failed|blocked`, ~`schema.ts:1025`) records the outcome.
A learning whose redaction status is `failed`/`blocked` is NOT persisted — the
row and its evidence excerpts are dropped before DB write. Never store raw
review-comment bodies verbatim.

Secret philosophy: learnings store names/paths/patterns, never decrypted values.
If extraction surfaces a literal-looking secret it is dropped, not stored.

CI-gaming guard: extraction flags learnings that would weaken CI (removing
tests, `|| true`, skipping lint) as `anti_pattern`/critical rather than
convention.

Write-path gating: the optional propose-via-PR slice reuses the run epic's
approval gate (`requireApproval` before `createReadyPullRequestOutput`) and
`outputMode=ready_pr` scoped token (`contents:write` + `pull_requests:write`,
minted/revoked per use). The read/extract arc needs only `pull_requests:read`
added for review events.

Per-user partition: rows are scoped to `(userId, repoOwner, repoName)`.
Multiple users on the same org repo get isolated stores in v1. This is a
documented limitation; the `uniqueIndex` enforces it deliberately.

### Failure Modes

Typed `errorKind` taxonomy on `repoLearningExtractionRuns.errorKind` and the
`run_failed` event: `no_installation`, `user_no_write`, `repo_not_allowlisted`,
`diff_fetch_failed`, `pr_too_large`, `superseded_sha`, `extraction_parse_failed`,
`judge_rejected_all`, `redaction_blocked`, `dedup_conflict`, `rate_limited`,
`unknown`.

Key failure scenarios:

- **Silent failure:** a learnings agent that stops extracting looks identical to
  "no notable PRs." Mitigate with a per-run `repoLearningExtractionRuns` row
  recording `candidatesExtracted/accepted/rejected` + `errorKind`, surfaced in
  the run event timeline.
- **`merged` mis-filter:** filtering `action='merged'` silently never fires.
  Must read `payload.pull_request.merged` on `action='closed'`. Covered by a
  required fail-before test.
- **Webhook at-least-once + out-of-order:** rapid force-pushes deliver
  `synchronize` events out of order; anchor extraction to the PR head SHA at
  fetch time and suppress/label runs for a superseded SHA. Idempotency key (incl.
  sha + review id) prevents duplicate runs.
- **KB bloat via dedup false negatives:** string-equality dedup misses
  paraphrased duplicates; the 5-dimension overlap score + `dedupSignature` unique
  index guards against this. A null signature bypasses the unique index — `NOT
  NULL` is required.
- **Stale KB:** never-used learnings keep full confidence and become noise; apply
  usage-anchored decay + flag stale for refresh scan; archive at
  `confidence=speculative` + `usageCount=0`.
- **Context-window overflow on large PRs:** fall back to per-file extraction +
  aggregate; flag oversized PRs with `errorKind=pr_too_large`.
- **Confidence inflation:** single-source learnings start at `medium`; promote
  to `high`/`proven` only on corroborating evidence entries.
- **v1 mutation limitation:** `outputMode=ready_pr` fails visibly today (issue
  #21); the propose-via-PR slice is blocked on a real approval gate — the
  DB-persist arc is unaffected.
- **Allowlist drift across envs:** unlisted repos skip silently; the per-repo
  `ReadinessVerdict` must reflect allowlist + installation state.

## Implementation Slices

Implementation is sequenced shadow-first: land the store and inert trigger
before subscription is live, subscription before UI, UI before agent surfacing
and write path. The propose-via-PR projection is the last slice and is
explicitly gated.

### Slice 1 — #273: Per-Repo Learnings Store + DB-Persist Extraction On PR-Merge (Shadow, No UI)

Goal: land the durable store and the read/extract arc end-to-end on the existing
background-agents pipeline, inert until enabled.

In scope: three new tables + migration; `github.pull_request_review` trigger
kind + `buildBackgroundRunIdempotencyKey` extension; `normalizeGitHubBackgroundEvent`
parsing for `pull_request_review.submitted` AND `pull_request.merged` (via
`closed` + boolean); `fieldsForTrigger()` extension; executor extraction body
(head-SHA-anchored fetch, untrusted-data prompt, Zod parse, LLM-as-judge +
actionability gate, enforced redaction with drop-before-persist, 5-dimension
dedup, per-run summary row); `lib/learnings/store.ts`, `extraction.ts`,
`dedup.ts`; per-`(userId, owner, repo)` canonical partition + single-agent
dispatch guard. No UI write path, no repo mutation.

Out of scope: webhook subscription, readiness check, enable toggle, UI feed,
Phase-1 agent surfacing, propose-via-PR.

Tests (fail-before required): merged-PR payload triggers `merged` condition;
`pull_request_review.submitted` normalizes to kind `github.pull_request_review`
with correct externalId; 5-dimension overlap scoring updates existing row on
high overlap / flags `consolidation_review` on moderate / creates fresh on low;
planted secret sets `redactionStatus=failed/blocked` and drops the row before
persist; replayed delivery triggers `onConflictDoNothing`; single-source
learning persists at `confidence=medium`; reviewer-sourced learning at
`confidence=low`.

### Slice 2 — #274: Pull_request_review Webhook Subscription + Readiness + Built-In Agent Enable Toggle

Goal: make the trigger live and operator-controllable.

In scope: add `pull_request_review` to `requiredGitHubAppEvents`
(`github-app-webhooks.ts:7-11`) + the webhook route switch
(`route.ts:188-289`); extend readiness check; `ensureRepoLearningsAgent(userId,
owner, repo)` that idempotently creates exactly one `backgroundAgents` row +
trigger per repo when enabled; enable/disable API at `app/api/learnings/route.ts`.
Default OFF. No UI beyond the API.

Out of scope: `/settings/learnings` feed UI, Phase-1 surfacing, propose-via-PR.

Tests: readiness reports missing event subscription before it is added; enabling
creates exactly one agent + trigger idempotently; webhook routes
`review.submitted` into `dispatchBackgroundTriggerEvent`.

### Slice 3 — #275: /settings/learnings Insights Feed (Table + Detail Sheet + Per-Repo ReadinessVerdict Toggle)

Goal: ship the operator-facing read surface and enable affordance using existing
primitives.

In scope: nav item under Insights; `SettingsPageHeader` + `LearningsSection`;
`useSWR` feed `Table` with type/confidence `Badge` chips, filters, per-row kebab
(`DropdownMenu`); `Sheet` detail with Evidence/Insights `Tabs` + external-link
evidence; `ReadinessVerdict` per-repo health + enable `Switch`; empty/loading/error
states + AI-trust caption + feedback affordance; archive via `AlertDialog`;
`PATCH`/`DELETE` routes at `app/api/learnings/[learningId]/route.ts`.

Out of scope: Phase-1 agent surfacing, propose-via-PR.

Tests: feed renders empty state with enable CTA when no learnings; enabling fires
toggle API + `ReadinessVerdict` reflects state; archive PATCH updates status;
Sheet returns focus to triggering row; `Badge` uses text+color not color-alone.

### Slice 4 — #276: Surface Learnings To Agent Phase-1 + Optional Propose-Via-PR Projection (Gated)

Goal: close the compounding loop and add the optional repo projection (write
last, gated).

In scope: wire `packages/agent/open-agent.ts` explorer/context loader to query
`searchLearnings(repo, affectedPaths, type, tags)` before web search
(local-first). Optional propose-via-PR projection via `lib/learnings/repo-projection.ts`
that REUSES the run epic's approval gate + `outputMode=ready_pr` write path;
`committedFilePath` set on success. Gated behind the approval gate landing.

Out of scope: the approval gate itself (owned by run epic — this slice is
blocked-by that issue); the run epic's SKILL.md auto-capture / in-loop review
verdict / run cost.

Tests: Phase-1 context includes a matching repo learning by `affectedPaths` glob
(fail-before test); PR projection is blocked when approval gate denies; `searchLearnings`
increments `usageCount` and updates `lastUsedAt`.

## Open Decisions

1. **Store location: DB only or DB + optional repo-committed files?**
   Recommendation: both, phased. DB is the source of truth and ships first
   (slices 1–3). The propose-via-PR projection is slice 4 and reuses the run
   epic's approval gate + `ready_pr` write path. The repo file is a projection,
   never the source of truth.

2. **Which webhook events trigger extraction?**
   Recommendation: `pull_request` (`closed+merged`) AND `pull_request_review`
   (`submitted`) by default. `opened`/`synchronize` gated behind an advanced
   toggle (higher noise, lower signal). Review submissions are the richest signal
   per Atlassian/CodeRabbit evidence.

3. **Dedup mechanism: embeddings vs LLM 5-dimension vs heuristic signature?**
   Recommendation: heuristic `dedupSignature` (normalized hash) as the
   unique-index gate for exact/near-exact dupes, PLUS LLM 5-dimension overlap
   during extraction for paraphrased dupes. No vector store in v1 — no infra
   exists; revisit if KB bloat appears. `dedupSignature` is NOT NULL by schema
   constraint.

4. **Who can enable, and is it default-on?**
   Recommendation: default OFF (inert). Any user with a connected installation +
   write access can enable for their own scope (userId-scoped rows, matching
   background-agents ownership). Not admin-gated — user-scoped data.

5. **New table set vs reuse `backgroundAgentOutputs`?**
   Recommendation: new `repoLearnings`/`repoLearningEvidence`/`repoLearningExtractionRuns`
   tables. `backgroundAgentOutputs` is one-per-run and shaped for PR/comment/issue
   outputs; learnings are durable, deduped, cross-run, queryable by
   `affectedPaths`. Link back to `backgroundAgentRuns` via `backgroundAgentRunId`
   for audit/ROI.

6. **ROI "saved ~$X" in v1?**
   Recommendation: defer. It depends on the run epic's run-ledger keystone
   (`usage_events` `runId`/`sessionId` FK, ref #222). Ship the `backgroundAgentRunId`
   schema hook on `repoLearningExtractionRuns` now so ROI can be computed later
   without migration churn.

7. **Per-(userId, owner, repo) partition as v1 limitation.**
   Two teammates on the same org repo get isolated stores in v1. This is
   explicitly documented in the `ReadinessVerdict` copy and in the unique index
   definition. Org-level shared stores are a future concern.

8. **Approval gate dependency for propose-via-PR.**
   The approval gate for `outputMode=ready_pr` does NOT currently exist in tree.
   Slice #276's write path is explicitly blocked-by a real approval-gate issue.
   Recommendation: file or depend-on the run epic's approval-gate issue before
   #276 is scheduled; do not merge the write path without a gate in tree.

## Rollout And Rollback

Rollout is shadow-first, extraction before UI, UI before agent surfacing:

1. Land slice #273 (store + extraction, inert trigger). Verified in run timeline
   only. No user-visible surface.
2. Land slice #274 (subscription + enable toggle). Feature is default OFF; no
   extractions fire unless a user enables a repo. Readiness check confirms
   subscription before extractions are trusted.
3. Land slice #275 (Insights feed UI). Users can browse learnings and manage
   the enable toggle. The propose-via-PR write path remains unavailable.
4. Land slice #276 (Phase-1 agent surfacing + gated PR projection). Agent
   surfacing ships first. PR projection ships only after the run epic's approval
   gate is proven in tree.

Rollback: per-repo `ReadinessVerdict` toggle returns to OFF state to disable
extraction without a migration. DB rows for `repoLearnings` are inert if the
agent is disabled. If the migration must be reverted, the three tables have no
FK dependencies from existing tables and can be dropped cleanly. No existing
background-agent behavior changes: new trigger kind is additive, `merged`
boolean detection is additive on `pull_request closed`.
