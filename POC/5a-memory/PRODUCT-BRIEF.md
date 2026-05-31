# Product Brief: Cross-Session / Project Memory

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR
Every chat in open-agents starts from zero — the agent re-learns your repo's conventions, re-derives the same fixes, and forgets every decision the moment a session ends. POC 5a proves a retrieval-backed memory store (pgvector + AI Gateway embeddings, scoped strictly per user+repo) that surfaces the *relevant* past decision at the top of the ranking, never leaks across tenants, and deduplicates repeated learnings instead of hoarding them. The eval is hard-evidence (21/21 assertions on realistic data, not a smoke test). We should build this — it is the single highest-leverage quality multiplier in the roadmap and a hard prerequisite for trustworthy standing/scheduled agents (2a).

## The gap today
Each chat is isolated. Nothing the agent learns in one session survives to the next: not the decision to use Better Auth over NextAuth, not the convention that migrations go through Drizzle, not the fix for the cold-start null-pointer in session hydration. The user feels this as **Groundhog Day** — they re-explain the same context every session, watch the agent re-derive a fix it already found last week, and correct the same wrong assumption repeatedly. Power users with long-lived repos feel it most acutely: the more history a project has, the more the agent's amnesia costs them. It also blocks scheduled/standing agents entirely — an agent that wakes up nightly with no memory of yesterday cannot accumulate competence.

## What we'd build
A per-user, per-repo memory that compounds across sessions. After a run finishes, the system extracts `{kind, content}` candidates (decision | convention | fix | fact), embeds them, and either merges them into an existing near-duplicate memory or inserts a new one — all scoped to `(userId, repoOwner, repoName)`. On a new turn, the system embeds the user's query, retrieves the cosine top-k memories *within that scope only*, and injects them as a labeled reference block before the model runs. The POC proves the load-bearing mechanism end to end: relevance is ranking-quality (correct memory #1 by a wide margin, distractors absent or ≤25% of #1), scoping is enforced in SQL (a user's own cross-repo query returns zero rows), and dedup merges a paraphrase at cosine 0.972 while a genuinely distinct decision still inserts. It reuses the existing Neon Postgres + pgvector stack and the AI Gateway embedding path already wired into `webAgent.stream` — no new datastore, no new credential.

## How users experience it
### Where it lives (exposure)
- **Passive by default.** Memory works with zero user action: it surfaces inside the chat as a small, collapsible "Remembered from this repo" affordance above the agent's first response, listing the 2–4 memories that informed the turn. Each is a chip the user can expand.
- **A "What the agent remembers" panel** per repo (reachable from the session header and from repo settings) that lists all memories for the current user+repo, grouped by kind, with provenance ("learned in session #1432, used 6 times, last used 2 days ago").
- **Inline edit/forget** on every memory card — correct a stale memory, pin one as authoritative, or forget it outright.
- **Settings toggle** to disable memory per repo or globally for users who want a clean slate.

### Sample UI
The **memory panel** is a right-rail or modal showing **memory cards**, one per memory:
- Header: kind badge (Decision / Convention / Fix / Fact), confidence/use-count, last-used timestamp.
- Body: the memory content, rendered as quoted reference text (visually distinct from agent instructions — reinforcing that memories are *notes, not commands*).
- Provenance line: source session link + "used N times."
- Actions: **Edit** (inline textarea), **Forget** (removes the row), **Pin** (protect from dedup/decay).

States to design:
- **Empty** — "No memories yet for owner/repo. As you work, the agent will remember decisions, conventions, and fixes here."
- **Populated** — grouped cards, newest/most-used first.
- **In-chat surfaced** — collapsed "Remembered 3 things" line that expands to the cards that informed *this* turn (the retrieval set), so the user sees exactly what shaped the answer.
- **Stale/flagged** — a memory the system suspects is superseded (e.g. contradicts a newer decision) shows a "may be outdated" marker prompting review.
- **Scope-empty** — a repo the user has never worked in shows the empty state, never another repo's memories (the SQL scope guarantee made visible).

### UX walkthrough
1. A user opens a session against `acme/api` and asks "why am I getting rate limited?"
2. The system embeds the query, retrieves the top-k memories scoped to this user + `acme/api`, and finds the "429 / Retry-After" fix ranked #1.
3. A "Remembered 1 thing from this repo" line appears above the agent's reply; the agent's answer is already grounded in the prior fix.
4. The user clicks the line, sees the memory card, and confirms it's correct (or clicks **Edit** to refine it).
5. The session continues; the agent makes a new decision ("adopt LaunchDarkly for feature flags"). On finish, extraction produces a candidate, dedup finds no near-match, and it's inserted as a new memory.
6. Next week, in a fresh session, the user asks about feature flags — the LaunchDarkly memory surfaces #1, with no re-explanation needed.
7. If the user later switches to NextAuth, they open the panel, **Forget** the stale Better Auth memory (or it's flagged as contradicted), and the agent stops citing it.

## Value to the user
**Job to be done:** "Help me work on *my* repo the way *we* actually work, without me re-teaching you every time."
- **Scenario — onboarding a returning project.** A user comes back to a project after three weeks; the agent already knows the auth stack, the migration workflow, and the two gotchas that bit them last time, so the first turn is productive instead of remedial.
- **Scenario — repeated fix.** A flaky cold-start crash recurs; instead of re-debugging from scratch, the agent retrieves the prior root cause (null pointer in session hydration / TTL) and goes straight to the fix.
- **Scenario — convention enforcement.** The user asks for a schema change; the agent remembers "schema changes go through Drizzle migrations, never db:push" and does it the house way without being told.

## Value to the product
- **Compounding quality.** Unlike a one-time feature, memory makes the agent *better the more you use it* — a retention and quality flywheel that competitors without memory cannot match turn-for-turn.
- **Prerequisite for standing agents (2a).** A scheduled/standing agent is only useful if it accumulates competence between runs. Memory is the substrate that makes 2a worth shipping; without it, a standing agent is just a cron job with amnesia.
- **Activation & retention.** The "Remembered from this repo" moment is a visible, repeatable proof that the product *knows your codebase* — a strong stickiness driver and a reason to consolidate work onto open-agents rather than spreading it across tools.
- **Differentiation.** "An agent that learns your repo" is a clear, demonstrable positioning wedge against stateless chat-coding tools.

## The case FOR (strong)
1. **It's the highest-leverage quality multiplier we have, and it compounds.** Every other quality investment is per-turn; memory improves *all future turns* and gets better with use. The eval proves it surfaces the right memory #1 by a wide margin on realistic data — this is real retrieval quality, not "a result came back."
2. **It unblocks the roadmap.** Standing/scheduled agents (2a) are not credibly good without cross-run memory. Building 5a is a dependency, not a nice-to-have.
3. **Low integration risk on the existing stack.** One additive table on Neon + pgvector, embeddings reuse the AI Gateway path already wired into `webAgent.stream`, and both seams (read before `webAgent.stream`, write next to `persistAssistantMessage`) are clean and proven in the POC.
4. **Strict multi-tenancy is already solved.** The scope filter is enforced in SQL, not app logic — the eval proves no cross-user and no cross-repo leak, including the same-user cross-repo case returning zero. The scariest correctness risk for a memory feature is already de-risked.
5. **Dedup keeps it from rotting into noise.** Repeated learnings reinforce one memory (useCount++, content refreshed) instead of piling up — proven at the 0.92 cosine threshold — so memory stays dense and useful rather than degrading over time.

## The case AGAINST (strong)
1. **Prompt injection via stored memories is a genuine attack surface.** Memories are model-generated text re-injected into the system prompt; a malicious or hallucinated memory could smuggle instructions. The POC labels the block "untrusted reference notes, not instructions," but that is mitigation, not elimination — extraction-time sanitization and provenance display are still required, and an adversary editing a memory is a real vector.
2. **Staleness and contradiction aren't solved.** Dedup merges paraphrases but does **not** detect supersession — a "use NextAuth" memory can linger and contradict the newer "use Better Auth" decision. Without recency weighting, explicit invalidation, and a contradiction check, memory can confidently mislead. This is the one capability gap most likely to produce a visibly wrong answer.
3. **Extraction quality is unproven and out of POC scope.** The store is proven; the `{kind, content}` extractor is not. A noisy extractor pollutes memory with junk, and garbage-in compounds exactly the way good memory does. The feature is only as good as a component this POC deliberately didn't build.
4. **Context-window budget pressure.** Injecting memories every turn competes for tokens with the actual task context. Without a strict token budget, top-k cap, and per-memory length limit, memory can crowd out the very context it's meant to augment — a real regression risk on long sessions.
5. **Embedding-model drift is operational debt.** Changing the embedding model invalidates every stored vector and forces a re-embed migration. `embeddingModel`-per-row makes this detectable, but it's ongoing maintenance, and HNSW recall vs. exactness becomes a tuning burden at scale.

## Effort, dependencies & risk
- **Feasibility verdict (from POC): Medium, low integration risk.** One additive table, embeddings on the existing gateway path, two clean seams.
- **Build size:** schema + migration (pgvector extension, HNSW cosine index, FKs, scope index); `gatewayEmbedder`; read injection before `webAgent.stream`; write path next to `persistAssistantMessage`; plus the net-new **extractor** and the **memory panel / edit-forget UI** (the POC built neither). Budget the extractor and UI as the bulk of the work, not the store.
- **Dependencies:** 5a is a **prerequisite for good standing agents (2a)** — sequence it ahead of or alongside 2a. It depends on the existing AI Gateway embedding path and Neon pgvector (both present).
- **Top risks + mitigations:** prompt injection → labeled untrusted block + sanitization + provenance + restricted memory editing; staleness/contradiction → recency weighting + explicit invalidation + write-time contradiction check; context bloat → token budget + top-k cap + per-memory length cap; extraction noise → conservative extractor + user edit/forget as the human correction loop; embedding drift → per-row model tag + re-embed migration.

## The decision
**The crisp question:** Do we commit to a per-user/per-repo memory now, accepting that we must also build a conservative extractor and a contradiction/staleness story — or defer until 2a forces it?

**Recommended trigger to greenlight:** Greenlight **now**, scoped to a v1 that ships the proven store + read/write seams + a conservative extractor + the memory panel with edit/forget, with staleness handled by recency weighting and manual forget (defer automated supersession detection to v2).

**Success metrics:** % of turns where a surfaced memory is *kept* (not forgotten/edited) by the user; reduction in user re-explanation (measured by repeated-context detection); turn-1 task success on returning sessions vs. cold sessions; zero cross-tenant leak incidents (must stay zero); memory-injection token share kept under budget.

**Suggested default: BUILD NOW.** It compounds quality, it's low-risk on the existing stack, and it's a hard prerequisite for the standing-agent roadmap. The honest caveats (injection, staleness, extraction) are manageable with a conservative v1 plus the user's own edit/forget loop as the safety valve — they argue for *scoping* the first release, not for waiting.
