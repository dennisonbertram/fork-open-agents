<!-- TITLE: feat: Cross-session project memory (per user+repo, retrieval-backed) -->

## Why this matters

Every chat in open-agents starts from zero. The agent re-learns the repo's
conventions, re-derives the same fixes, and forgets every decision the moment a
session ends. Users feel this as **Groundhog Day**: they re-explain that auth is
Better Auth (not NextAuth), that schema changes go through Drizzle migrations
(never `db:push`), and that the cold-start crash was a null pointer in session
hydration — every single session. Power users with long-lived repos pay the
highest amnesia tax, and scheduled/standing agents (POC 2a) are uninteresting
without cross-run memory: a nightly agent with no recall is a cron job with
amnesia.

POC 5a (PR #91, `poc/5a-memory`) proved a retrieval-backed, per-user/per-repo
memory store on the existing Neon Postgres + pgvector stack, with embeddings on
the AI Gateway path already wired into `webAgent.stream`. The eval is
hard-evidence (21/21 assertions on realistic data, not a smoke): the correct
memory ranks #1 by a wide margin, scoping is enforced in SQL (a user's own
cross-repo query returns zero rows), and a paraphrase merges at cosine 0.972
while a genuinely distinct decision still inserts. This issue scopes the
production build: schema + migration, the gateway embedder, the read/write seams
in the chat workflow, a conservative extractor, and the "What the agent
remembers" UI with edit/forget.

## User/operator path protected

The conversational chat turn in `apps/web/app/workflows/chat.ts`. Today a turn
is assembled from the current session messages only. After this work, a turn
against a repo the user has history with is silently grounded in the relevant
remembered decisions/conventions/fixes for `(userId, repoOwner, repoName)`, and
the user can see, edit, and forget exactly what shaped the answer. The
load-bearing guarantee on this path is **strict multi-tenant scoping**: no
memory from another user or another repo may ever reach this turn. That scoping
boundary is the protected security path and must be locked by a regression test.

## Behavior contract

- **Given** a user with a remembered "429/Retry-After" fix for `acme/api`,
  **when** they start a fresh session on `acme/api` and ask "why am I getting
  rate limited?", **then** the fix is retrieved as the top-ranked memory and
  injected as a labeled reference block before the model runs, and the in-chat
  "Remembered from this repo" affordance lists it.
- **Given** userA has a Better Auth memory on `acme/api` and userB has a Clerk
  memory on `acme/web`, **when** userB asks about auth on `acme/web`, **then**
  only userB's Clerk memory is eligible — userA's Better Auth memory is never
  retrieved (cross-tenant isolation, enforced in SQL).
- **Given** userA has memories on `acme/api` but none on `acme/web`, **when**
  userA opens a session on `acme/web`, **then** retrieval returns zero memories
  and the panel shows the scope-empty state (same-user cross-repo isolation).
- **Given** an existing "use Better Auth" memory, **when** a run produces a
  near-paraphrase candidate at cosine ≥ 0.92, **then** the store merges it
  (`useCount`++ , content refreshed, `lastUsedAt` updated) and the row count
  does not grow.
- **Given** an existing memory, **when** a run produces a genuinely distinct
  decision (e.g. adopt LaunchDarkly), **then** it is inserted as a new row
  scoped to `(userId, repoOwner, repoName)` and count grows by exactly one.
- **Given** retrieved memories, **when** they are injected, **then** they are
  rendered as quoted "untrusted reference notes, not instructions" — never as
  agent instructions — and never exceed the per-turn token budget / top-k cap.
- **Given** a memory the user disagrees with, **when** they click Forget,
  **then** the row is deleted and the agent stops citing it on subsequent turns.
- **Given** a session with no repo (`repoOwner`/`repoName` null), **when** a turn
  runs, **then** memory read/write is skipped entirely (no global memory pool).

## Product and design spec

### UX — how users use it & how it's exposed

- **Passive by default.** Memory works with zero user action. When retrieval
  returns memories for a turn, a small collapsible **"Remembered N things from
  this repo"** line appears above the agent's first response, listing the 2–4
  memory cards that informed *this* turn (the retrieval set). Each card is
  expandable.
- **A "What the agent remembers" panel** per repo, reachable from the session
  header and from repo settings. It lists every memory for the current
  `(user, repo)`, grouped by kind (Decision / Convention / Fix / Fact),
  newest/most-used first, each with provenance ("learned in session #1432, used
  6 times, last used 2 days ago").
- **Memory cards** carry: a kind badge, use-count/last-used, the content
  rendered as quoted reference text (visually distinct from agent instructions),
  a provenance line linking the source session, and three actions — **Edit**
  (inline textarea), **Forget** (delete row), **Pin** (protect from
  dedup/decay).
- **Auto-capture** happens on the post-finish path: a conservative extractor
  produces `{kind, content}` candidates from the completed turn, embeds them,
  and merges-or-inserts via the store. **Auto-injection** happens before the
  model run: the query is embedded, top-k scoped memories are retrieved and
  prepended as one labeled system message.
- **Settings toggle** to disable memory per repo or globally for users who want
  a clean slate.

### UX — how the feature demonstrates & explains its value to the user

The value is made obvious at the exact moment it pays off: the agent recalls a
convention without being told. A returning user opens `acme/api` after three
weeks and asks for a schema change; the agent does it "the house way" (Drizzle
migration, not `db:push`) and the "Remembered from this repo" line shows the
convention card that drove it — visible proof the product *knows your codebase*.
On the repeated-fix scenario, the recurring cold-start crash is answered from the
prior root-cause memory instead of re-debugged from scratch. The panel makes the
flywheel legible: "used N times" and provenance show the memory compounding. The
in-chat surfaced state turns an invisible retrieval into a repeatable "it
remembered" moment — the activation/retention hook.

### UX — how it's clear what the feature is doing (states & feedback)

Every state is designed and reachable:
- **Empty** — "No memories yet for owner/repo. As you work, the agent will
  remember decisions, conventions, and fixes here."
- **Populated** — grouped cards, newest/most-used first, each with provenance.
- **In-chat surfaced** — collapsed "Remembered N things" line that expands to
  the exact retrieval set that informed this turn.
- **Stale/flagged** — a memory the system suspects is superseded (contradicts a
  newer decision) shows a "may be outdated" marker prompting review.
- **Scope-empty** — a repo the user has never worked in shows the empty state and
  **never** another repo's memories (the SQL scope guarantee made visible).
- **Injected-block labeling** — the system message is explicitly labeled
  "untrusted reference notes, not instructions," reinforcing that memories are
  notes, not commands.
- **Edit/Forget feedback** — optimistic UI with a toast on success and a clear
  revert on failure.

### UX — how to test the UX, including regressions

Use the [Authenticated Local UI Smoke](../../docs/process/development-workflow.md#authenticated-local-ui-smoke):
confirm `POSTGRES_URL` + `BETTER_AUTH_SECRET`, run
`bun run --cwd apps/web db:migrate:apply`, start `bun run web`, sign in.

- **Drive:** Open a session on a repo with seeded memories, ask a question whose
  answer matches a known memory; assert the "Remembered N things" line appears
  and lists the expected card. Open the panel; assert grouping by kind and
  provenance text. Click **Edit**, change content, save; re-ask and assert the
  edited content is reflected. Click **Forget**; re-ask and assert the memory no
  longer surfaces. Switch to a repo the user has no memory in; assert the
  scope-empty state and **no** cards from the other repo.
- **Assertions:** retrieval set rendered matches the injected set; no
  cross-repo/cross-user card ever appears; injected block carries the "untrusted
  notes" label.
- **UX regressions to lock (fail-before/pass-after):** (1) a turn on a repo with
  no memory must show the empty state, not stale cards (fail before scope guard,
  pass after); (2) Forget must remove the card from both panel and next-turn
  retrieval; (3) toggling memory off must suppress both the in-chat line and
  injection. Capture screenshots of empty, populated, in-chat-surfaced, and
  scope-empty states; check `agent-browser errors`/`console` and the dev-server
  log after the smoke.

## Integration spec

- **Data model:** add `agentMemories` to `apps/web/lib/db/schema.ts` using the
  `PRODUCTION_PG_SCHEMA` block from `POC/5a-memory/src/schema.ts`: columns
  `id`, `userId` (FK → `users.id`), `repoOwner`, `repoName`, `kind` enum
  (`decision|convention|fix|fact`), `content`, `embedding vector(1536)`,
  `embeddingModel`, `sourceSessionId` (FK → `sessions.id`), `createdAt`,
  `lastUsedAt`, `useCount`. Add a composite scope index on
  `(userId, repoOwner, repoName)` and an HNSW cosine index on `embedding`.
- **Vector store:** pgvector in the same Neon Postgres as `sessions`/`chats`, so
  scoping is a plain `WHERE userId/repoOwner/repoName` on the same row and the
  multi-tenant boundary lives in SQL, not app logic.
- **Embeddings:** add `gatewayEmbedder` (per `POC/5a-memory/src/embedder.ts`)
  using AI SDK v6 `embed`/`embedMany` from `ai`, model
  `"openai/text-embedding-3-small"` (1536-d), resolved through `@ai-sdk/gateway`
  — the same path `webAgent.stream` already uses. No new provider/credential.
- **Retrieval injection (READ):** in `apps/web/app/workflows/chat.ts`, before the
  per-step model run (`runAgentStep`, ~L1226 in the step loop), resolve scope
  from the `sessions` row (`userId`, `repoOwner`, `repoName` — confirmed present
  in `schema.ts` ~L228) and call the store's `retrieve()`; prepend the rendered
  labeled system message into `modelMessages`. Skip when scope is null.
- **Memory write (WRITE):** in the post-finish path (next to
  `persistAssistantMessage`), run the conservative extractor over the completed
  turn to produce `{kind, content}` candidates, then call the store's `write()`
  (embed + scoped dedup-or-insert) per `POC/5a-memory/src/chat-integration.ts`.
- **Store:** port `memory-store.ts` (`write`, `retrieve`, `cosineSimilarity`)
  onto the real Drizzle client (`apps/web/lib/db/client.ts`); the scope filter is
  applied in SQL before scoring.
- **Events/observability:** a named `agent-memory` service emits structured
  retrieve/write/merge/forget events (see Observability section).
- **Config:** dedup cosine threshold (default 0.92), top-k cap, per-memory length
  cap, per-turn injection token budget, and a per-repo/global enable flag.

## In scope

- `agentMemories` schema + Drizzle migration (pgvector extension, vector column,
  scope index, HNSW cosine index).
- `gatewayEmbedder` on the AI Gateway embedding path.
- Store ported to the real Neon client with SQL-enforced scoping.
- READ injection seam before the model run; WRITE seam on post-finish.
- A **conservative** `{kind, content}` extractor (deliberately low-noise).
- The "What the agent remembers" panel + in-chat "Remembered N things"
  affordance, with view/edit/forget/pin and the per-repo/global toggle.
- Token budget, top-k cap, and per-memory length cap on injection.
- Structured observability and the multi-tenant scoping regression test.

## Out of scope

- Automated supersession/contradiction detection (v2; v1 handles staleness via
  recency weighting + manual Forget).
- Cross-repo or org-wide shared memory pools (scope stays strictly per
  user+repo).
- A learned/embedding-model A/B or a re-embed migration tool (only the per-row
  `embeddingModel` tag for detectability ships now).
- Memory for sessions with no repo (skipped, no global pool).
- Sophisticated extractor (LLM-graded multi-pass) — v1 is conservative and
  relies on user edit/forget as the correction loop.

## Research and context sources

- POC PR: #91 (`poc/5a-memory`).
- POC folder: `POC/5a-memory/` — `README.md`, `PRODUCT-BRIEF.md`,
  `src/schema.ts` (incl. `PRODUCTION_PG_SCHEMA`), `src/embedder.ts`,
  `src/memory-store.ts`, `src/chat-integration.ts`, `src/corpus.ts`, `eval.ts`.
- Eval evidence: `POC/5a-memory/evidence/eval-output.txt`,
  `eval-results.json` (21/21 assertions: ranking, strict scoping, dedup).
- Repo seams: `apps/web/lib/db/schema.ts` (`sessions` scope columns ~L228;
  `usageEvents` precedent for an additive table), `apps/web/app/workflows/chat.ts`
  (step loop, `runAgentStep`), `apps/web/lib/db/client.ts`.
- Project docs: [Behavior-First TDD](../../docs/process/behavior-tdd.md),
  [Observability Discipline](../../docs/process/observability-discipline.md),
  [Feature Ticket Format](../../docs/process/feature-ticket-format.md).
- Context7/vendor: AI SDK v6 `embed`/`embedMany`; pgvector HNSW index docs.

## Agent todo checklist

- [ ] Read `POC/5a-memory/README.md`, `PRODUCT-BRIEF.md`, and `src/` to confirm
      the store/embedder/seam shapes against current `chat.ts`.
- [ ] Add a **failing** scoping regression test asserting no cross-user /
      cross-repo memory is ever retrieved (and same-user cross-repo returns 0).
      Confirm red.
- [ ] Add failing tests for relevance ranking (correct memory #1, distractor
      ≤25%) and dedup (paraphrase merges at ≥0.92, distinct inserts). Confirm red.
- [ ] Commit the failing test-only state on the work branch.
- [ ] Add `agentMemories` to `apps/web/lib/db/schema.ts`; run
      `bun run --cwd apps/web db:generate`; commit the generated `.sql` (incl.
      `CREATE EXTENSION vector` + HNSW index).
- [ ] Port the store onto `apps/web/lib/db/client.ts` with SQL-enforced scope.
- [ ] Add `gatewayEmbedder` (`embed`/`embedMany`, `openai/text-embedding-3-small`).
- [ ] Wire READ injection before `runAgentStep` in `chat.ts`; skip null scope.
- [ ] Add the conservative extractor and wire the WRITE seam on post-finish.
- [ ] Enforce token budget, top-k cap, and per-memory length cap on injection.
- [ ] Build the memory panel + in-chat "Remembered N things" affordance with
      view/edit/forget/pin and the per-repo/global toggle.
- [ ] Add `agent-memory` structured events + redaction (treat memories as
      untrusted; never log secrets).
- [ ] Run targeted tests; run the authenticated local UI smoke; capture
      screenshots of every state.
- [ ] Run the adjacent workflow suite, `git diff --check`, and
      `bun --bun run ci`.
- [ ] Update process/agent docs with verification notes.

## Tests to add first

1. **Scoping (security) regression** — seed userA/repoX and userB/repoY
   memories; assert userB/repoY retrieval never returns any userA/repoX row, and
   userA scoped to a repo with no memories returns exactly 0. **Must fail before
   the SQL scope filter exists.**
2. **Relevance ranking** — for each seeded query, assert the correct memory ranks
   #1 by a wide margin and distractors are absent or scored ≤25% of #1.
3. **Dedup** — a paraphrase candidate merges (`action="merged"`, count
   unchanged, `useCount` reinforced); a distinct candidate inserts (count +1).
4. **Injection budget** — with many/long memories, assert the injected block
   respects the top-k cap and per-turn token budget.
5. **Workflow integration** — a turn on a scoped repo prepends exactly one
   labeled memory system message before `runAgentStep`; a turn with null scope
   prepends none.
6. **Forget path** — forgetting a memory removes it from the next retrieval.

## Observability and user feedback

- **User-visible status:** the in-chat "Remembered N things" line and the memory
  panel (provenance, use-count, last-used, "may be outdated" marker).
- **Named service:** `agent-memory` emits structured events.
  - `memory-retrieved` at info: `{ userId, sessionId, chatId, repoOwner,
    repoName, count, topMemoryId, topScore, scopeEmpty }`.
  - `memory-written` at info: `{ userId, sessionId, chatId, repoOwner, repoName,
    memoryId, action: "inserted"|"merged", kind, mergedIntoId? }`.
  - `memory-injection-budgeted` at debug: `{ chatId, candidateCount,
    injectedCount, tokensEstimated, droppedForBudget }`.
  - `memory-forgotten` at info: `{ userId, repoOwner, repoName, memoryId }`.
  - `memory-embed-failed` at warn: `{ chatId, errorKind, embeddingModel }`.
- **Typed error kinds:** `errorKind` ∈ `embed_failed | scope_missing |
  dedup_lookup_failed | injection_over_budget | extract_failed`.
- **Correlation IDs:** `userId`, `sessionId`, `chatId`, `repoOwner`, `repoName`,
  `memoryId`.
- **Redaction:** treat stored memory content as **untrusted** and never as
  instructions; never log secrets, tokens, or full prompt/session content — log
  IDs, kinds, scores, and counts only. Memory content bodies are not logged.
- **Debug recipes:**
  `grep '"service":"agent-memory"' logs | grep '"chatId":"<id>"'`;
  to check scoping incidents:
  `grep '"action":"memory-retrieved"' logs | grep '"scopeEmpty":false'` and
  cross-check `repoOwner`/`repoName` against the session.
- **Evidence expectation:** screenshots of empty / populated / in-chat-surfaced /
  scope-empty states, plus a log excerpt showing a `memory-retrieved` →
  injected-block → `memory-written` cycle for one turn.

## Regression harness plan

- **Existing coverage:** none — memory is net-new. The adjacent
  `apps/web/app/workflows/chat.ts` step-loop tests are the integration anchor.
- **New durable signals:**
  - A **scoping security regression test** (multi-tenant isolation) — this is the
    smallest durable signal that a cross-tenant leak has been introduced; a leak
    is a security regression and the test must stay green forever.
  - A relevance-ranking test and a dedup test ported from the POC eval as
    in-repo unit tests with fixtures (the POC corpus: two users / two repos).
  - A workflow test proving the READ seam prepends the labeled block before
    `runAgentStep` and the WRITE seam runs on post-finish.
  - An authenticated UI smoke for empty/populated/forget paths.
- **Fixtures:** the POC `corpus.ts` seed (auth, rate-limiting, fixes,
  conventions, payments, plus deliberate distractors).
- **Fail-before/pass-after:** scoping test fails before the SQL filter; ranking
  test fails with a naive "any result" retriever; dedup test fails before the
  threshold merge logic.
- **Limits not caught by the harness:** prompt-injection-via-memory (content
  semantics), staleness/contradiction (no automated supersession in v1),
  extractor noise quality, and embedding-model drift recall changes. These are
  called out as risks and partially mitigated by the labeled untrusted block,
  recency weighting, manual Forget, and the per-row `embeddingModel` tag.

## TDD audit trail

- **Red commit 1:** scoping security test (cross-user + cross-repo isolation,
  same-user cross-repo = 0) — observed failing.
- **Red commit 2:** relevance-ranking + dedup tests — observed failing.
- **Green commit 1:** schema + migration + store on real client with SQL scope →
  scoping test green.
- **Green commit 2:** gateway embedder + ranking/dedup logic → ranking/dedup
  green.
- **Green commit 3:** READ/WRITE workflow seams + extractor → workflow test green.
- **Green commit 4:** panel/in-chat UI + observability + budget caps.
- Any deviation recorded as an explicit exception in the PR.

## Regression risks and concerns

- **Prompt injection via stored memories** — memories are model-generated text
  re-injected into the system prompt; a malicious/hallucinated memory could carry
  instructions. Mitigation: labeled "untrusted reference notes, not
  instructions," extraction-time sanitization, provenance display, and restricted
  editing. Not fully eliminated.
- **Staleness / contradiction** — dedup merges paraphrases but does not detect
  negation/supersession; a superseded "use NextAuth" memory can linger. v1
  mitigates with recency weighting, a "may be outdated" flag, and manual Forget;
  automated detection is v2.
- **Context-window bloat** — injecting too many/too long memories crowds the
  window. Mitigation: token budget, top-k cap, per-memory length cap (covered by
  a test).
- **Embedding-model drift** — a model change invalidates stored vectors; per-row
  `embeddingModel` makes it detectable and a re-embed migration becomes
  necessary. HNSW recall vs. exactness is a tuning knob at scale.
- **Extractor noise** — a noisy extractor pollutes memory; v1 stays conservative
  and leans on user edit/forget.

## Deploy or migration impact

- **Migration:** new Drizzle migration enabling the **pgvector extension**
  (`CREATE EXTENSION IF NOT EXISTS vector`), creating `agent_memories` with the
  `vector(1536)` column, the composite scope index, and the **HNSW cosine
  index**. Migrations run automatically during `bun run build` on every Vercel
  deploy; Neon preview branching isolates preview data.
- **Operational:** confirm the Neon plan/region supports pgvector + HNSW; the
  HNSW index build is additive but should be reviewed for build time on large
  tables.
- **Rollout:** ship behind a per-repo/global enable flag; default conservative.
  No backfill required (memory accrues from new turns).

## Definition of done

- [ ] Protected path named: the scoped chat turn in `chat.ts`.
- [ ] Behavior proof written as a **red** test first and observed failing.
- [ ] Red-test commit recorded on the work branch (or an explicit exception).
- [ ] Green implementation commit(s) follow the red commit.
- [ ] **Security regression test** for multi-tenant scoping (no cross-user /
      cross-repo leak; same-user cross-repo = 0) is present and green.
- [ ] Targeted tests pass (scoping, ranking, dedup, injection budget, workflow,
      forget).
- [ ] Adjacent workflow suite passes.
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (scoping + ranking + dedup + workflow +
      UI smoke).
- [ ] Observability evidence captured (state screenshots + a retrieve→inject→
      write log excerpt).
- [ ] Deploy notes included (pgvector extension + HNSW index migration; enable
      flag).
- [ ] Docs updated (architecture/lessons-learned + verification notes).
