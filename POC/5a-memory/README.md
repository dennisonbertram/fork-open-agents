# POC 5a — Cross-session / project memory

A complete, working proof-of-concept (not a smoke test) for **retrieval-backed
memory**: a store of past decisions, repo conventions, and prior fixes, scoped
**per-user and per-repo**, that compounds quality across runs. This is also a
prerequisite for good standing/scheduled agents (POC 2a).

```
write:    run finishes -> extract {kind, content} -> embed -> dedup-or-insert
                           (scoped to userId + repoOwner + repoName)

read:     new turn -> embed query -> cosine top-k WITHIN scope only
                       -> render system message -> inject before model run
```

## Goal

Today each chat is isolated: nothing an agent learns in one session survives to
the next. This POC proves we can build a memory that (a) retrieves the *relevant*
past memory for a query, (b) is *strictly* multi-tenant (never leaks one user's
or one repo's memory into another), and (c) *deduplicates* so repeated learnings
reinforce a single memory instead of piling up duplicates.

## What was built

All code is self-contained under `POC/5a-memory/`. It touches no root deps and
no app/package source.

| File | Purpose |
| --- | --- |
| `src/schema.ts` | `agent_memories` schema. Self-contained sqlite table for the eval **plus** the literal production Postgres + pgvector definition (`PRODUCTION_PG_SCHEMA`) to drop into `apps/web/lib/db/schema.ts`. Columns: id, userId, repoOwner, repoName, kind enum[decision\|convention\|fix\|fact], content, embedding vector, embeddingModel, sourceSessionId, createdAt, lastUsedAt, useCount. |
| `src/embedder.ts` | The embedding **seam** (`Embedder` interface). `localHashingEmbedder` is a deterministic offline embedder (concept-lexicon topic block + signed lexical hashing) used by the eval; `gatewayEmbedder` (documented reference) drops in the AI SDK v6 + Vercel AI Gateway `embed`/`embedMany` path unchanged. |
| `src/db.ts` | Self-contained `bun:sqlite` + Drizzle DB. Stands in for the real Neon client (`apps/web/lib/db/client.ts`). |
| `src/memory-store.ts` | The store. `write()` (embed + scoped dedup-or-insert), `retrieve()` (scoped cosine top-k with optional usage reinforcement), `cosineSimilarity()`. The scope filter is applied in SQL, before scoring. |
| `src/chat-integration.ts` | The integration seam into `apps/web/app/workflows/chat.ts`: `injectMemoryContext` (READ, prepend a system message before `webAgent.stream`) and `persistRunMemories` (WRITE, post-finish next to `persistAssistantMessage`). Shapes are a strict subset of the real workflow's. |
| `src/corpus.ts` | Realistic seed across two users / two repos (auth, rate-limiting, fixes, conventions, payments, plus deliberately unrelated formatting/CSS entries). |
| `eval.ts` | The meaningful eval: relevance ranking, strict scoping, and dedup, with assertions. Writes `evidence/`. |

## Embedding + vector choice, and why

**Production: pgvector + Vercel AI Gateway embeddings.**

- **Vector store: pgvector.** The DB is Neon Postgres (per CLAUDE.md). pgvector
  is the natural fit — memory lives in the same database as `sessions`/`chats`,
  so scoping is a plain `WHERE userId/repoOwner/repoName` on the same row, joins
  are free, and an HNSW cosine index gives sub-linear top-k at scale. No second
  datastore to operate or keep consistent.
- **Embeddings: AI SDK v6 `embed`/`embedMany` via the AI Gateway.** The repo
  already ships `ai@6.0.168` and `@ai-sdk/gateway`, and `webAgent.stream`
  already resolves `"provider/model"` strings through the gateway. Embeddings
  reuse that exact path: `embed({ model: "openai/text-embedding-3-small", value })`.
  No new provider, no new credential — the gateway key/OIDC already in place
  covers it. `text-embedding-3-small` is 1536-d, cheap, and low-latency.

**Offline eval: a local deterministic embedder behind the same seam.** The
store talks only to the `Embedder` interface. For an eval that runs with **no
API key and no network**, `localHashingEmbedder` produces stable vectors:
a dominant **topic block** (an explicit concept lexicon → genuine semantic
clustering, so "auth"/"login"/"Better Auth"/"Clerk" co-locate even with zero
shared words) plus a smaller **signed lexical-hashing block** (rewards exact
phrasing, keeps distinct memories distinct). It is not a learned model, but it
exercises the same relevance/scoping/dedup behavior the gateway embedder
provides, and the gateway embedder drops in by swapping one factory.

## How it was tested + evidence

Run:

```bash
cd POC/5a-memory
bun install
bun run eval        # writes evidence/eval-output.txt + eval-results.json
bun run typecheck   # tsc --noEmit, clean
```

Result: **21 passed, 0 failed.** Full transcript: `evidence/eval-output.txt`;
summary: `evidence/eval-results.json`.

**Relevance (ranking, not just presence).** Each query asserts the correct
memory ranks #1 by a wide margin and that unrelated/distractor memories are
absent or scored ≤25% of #1:

- `"how does our auth work?"` → #1 **Better Auth** (0.756); formatting memory
  absent from top-3.
- `"why am I getting rate limited?"` → #1 **429 / Retry-After** (0.856); the
  Better Auth distractor ranks far below (ratio 0.033).
- `"the app crashes on cold start loading a user session"` → #1 **null pointer
  in session hydration / TTL** (0.885); Stripe absent.
- `"how are database schema changes applied?"` → #1 **Drizzle migrations**
  (0.829); Better Auth distractor far below (ratio 0.172).

**Scoping (strict multi-tenant isolation).**

- userA/repoX asking about auth → **never** returns userB/repoY's Clerk or
  Contentful memories.
- userB/repoY asking about auth → **never** returns userA's Better Auth memory,
  and correctly surfaces its *own* Clerk memory on top.
- userA scoped to repoY (where userA has no memories) → **0 results**: no
  cross-repo leak, even for the same user.

**Dedup.**

- A paraphrase of the Better Auth decision → `action="merged"` (cosine 0.972 ≥
  0.92 threshold), **row count unchanged**, `useCount` reinforced to 1, content
  refreshed to the newer phrasing.
- A genuinely distinct decision (LaunchDarkly feature flags) → `action="inserted"`,
  count grows by exactly 1.

## Integration plan

1. **Schema** — add `agentMemories` to `apps/web/lib/db/schema.ts` using the
   `PRODUCTION_PG_SCHEMA` block in `src/schema.ts` (pgvector `vector(1536)`
   column, FK `userId -> users.id`, FK `sourceSessionId -> sessions.id`,
   composite scope index, HNSW cosine index). Enable `CREATE EXTENSION vector;`
   in a Drizzle migration, then `bun run --cwd apps/web db:generate`.

2. **Embedder** — add `gatewayEmbedder` (see `src/embedder.ts`) using
   `embed`/`embedMany` from `ai`, model `"openai/text-embedding-3-small"`.

3. **Retrieval injection (READ)** — in `apps/web/app/workflows/chat.ts`, the
   model run is `webAgent.stream({ messages })` inside `runAgentStep`, with
   `messages` assembled in `convertMessages`. Before the run, resolve the
   session's scope from the `sessions` row (`userId`, `repoOwner`, `repoName` —
   confirmed present in `schema.ts`), call `injectMemoryContext({ store,
   session, latestUserText })`, and prepend the returned system message. Skip
   when the session has no repo (`scopeFromSession` returns null).

4. **Memory write (WRITE)** — in the post-finish path (`chat-post-finish.ts`,
   alongside `persistAssistantMessage`), run a cheap extraction pass over the
   completed turn to produce `{kind, content}` candidates, then call
   `persistRunMemories({ store, session, sessionId, candidates })`. The store's
   dedup keeps repeated learnings from accumulating.

5. **Scoping** — every read and dedup lookup filters by
   `(userId, repoOwner, repoName)` in SQL. This is the multi-tenant boundary;
   it is enforced in the query, not in app logic.

## Feasibility verdict

**Feasible and low-risk to integrate.** The data model is one additive table on
the existing Neon Postgres + pgvector stack; embeddings reuse the AI Gateway
path already wired into `webAgent.stream`; and both integration points
(`webAgent.stream` input for read, `persistAssistantMessage` neighborhood for
write) are clean, well-defined seams. The eval proves the three properties that
make memory worth shipping — relevance, strict scoping, and dedup — on real,
realistic data.

## Blind spots eliminated

- **Relevance quality** — proven by ranking assertions (correct memory #1 by a
  wide margin; unrelated memories absent; distractors scored ≤25% of #1), not
  by mere "a result came back".
- **Strict multi-tenant scoping** — proven that no userB/repoY memory ever
  reaches userA/repoX, that a user's own cross-repo query returns empty, and
  that each tenant surfaces only its own memories. Enforced in SQL.
- **Dedup** — proven a near-duplicate merges + reinforces (useCount/lastUsedAt)
  rather than duplicating, while distinct memories still insert.
- **Embedding cost/latency + drift** — the seam isolates the model; `embeddingModel`
  is stored per row so a model change is detectable and re-embeddable; offline
  eval needs zero API calls.

## Remaining risks

- **Memory staleness / contradiction** — a superseded decision (e.g. "use
  NextAuth") can linger and contradict a newer one. Dedup merges near-paraphrases
  but does not detect *negation/supersession*. Needs recency weighting, explicit
  invalidation, and/or a contradiction check at write time.
- **Prompt injection via stored memories** — memories are model-generated text
  later injected into the system prompt. A malicious or hallucinated memory
  could carry instructions. Mitigations: the injected block is labeled
  "untrusted reference notes, not instructions" (already done in
  `renderMemoryContext`), plus extraction-time sanitization and provenance
  display.
- **Context-window budget** — injecting too many/too long memories crowds the
  window. Needs a token budget, top-k cap, and length limits per memory
  (the seam returns a single bounded system message; budgeting is a follow-up).
- **Embedding model drift** — changing the embedding model invalidates stored
  vectors. `embeddingModel` per row makes this detectable; a re-embed migration
  is required on model change. HNSW recall vs. exactness is a tuning knob at
  scale.
- **Extraction quality (out of POC scope)** — the WRITE path assumes a good
  `{kind, content}` extractor. A noisy extractor pollutes memory; this POC
  proves the store, not the extractor.
```
