# Performance Audit — Open Agents

**Date:** 2026-06-17
**Goal:** Make the app faster, especially sandbox startup, tool/LLM interactions, and general UI sluggishness.
**Method:** Four parallel subsystem deep-dives (sandbox, agent/LLM, frontend, DB/API) + manual verification of the top claims against source.

This document is the durable record of the audit. 31 distinct opportunities are listed,
ranked within each domain and quantified where possible. The "Implementation tiers"
section at the end groups them by impact vs. risk.

---

## TL;DR — biggest wins

| # | Opportunity | Est. impact | Effort | Risk |
|---|---|---|---|---|
| 1 | Bake Bun + agent-browser + Chromium into the base snapshot (stop cold-installing at boot) | **−45–195 s** per managed-runtime sandbox start | M | Med |
| 2 | Add index on `chat_messages.chatId` (+ `chatId, createdAt`) | full-scan → index lookup on **every chat open**; ~100 ms → ~1 ms at scale | S | Low |
| 3 | Move skill install + token revoke off the sandbox-create critical path | **−6–30 s** perceived startup | M | Med |
| 4 | Subagent prompt caching (`prepareStep`) | **−50–90 % TTFT** on cached prefix per subagent step; large cost cut | S | Low |
| 5 | Index `accounts.userId` (Better Auth reads it on every authed request) | removes a full scan from **every API request** | S | Low |
| 6 | Don't re-render the whole 5,106-line chat component on every token | **~200× fewer** DOM reconciliations during streaming | M | Med |
| 7 | Parallelize Composio + GitHub tool resolution before each LLM turn | **−150–400 ms** TTFT/turn when both active | S | Low |

---

## Domain 1 — Sandbox startup & lifecycle

**S1. Cold install of Bun/agent-browser/Chromium at boot** ⭐
`packages/sandbox/profiles/web-bun-agent-browser/setup.sh:12-56`. Every managed-runtime
setup runs `curl … | bash` (Bun), `bun install -g agent-browser`, and
`agent-browser install --with-deps` (downloads Chromium). None of it is baked into
`DEFAULT_SANDBOX_BASE_SNAPSHOT_ID` (`lib/sandbox/config.ts:64`, env unset by default).
**Fix:** bake these into a refreshed base snapshot (machinery exists in
`vercel/snapshot-refresh.ts`); setup.sh becomes a version check.
**Impact:** −45–195 s per session. Single largest latency source. Effort M, Risk Med.

**S2. Skill install blocks the create response**
`app/api/sandbox/route.ts:262-280`. `installSessionGlobalSkills` /
`installSessionUserSkills` are awaited before the HTTP response; global installs loop
serially at up to 120 s/skill.
**Fix:** fire after responding (pattern already used for `kickSandboxLifecycleWorkflow`).
**Impact:** −6–30 s perceived startup. Effort M, Risk Med.

**S3. Serial global-skill install loop**
`lib/skills/global-skill-installer.ts:26-33`. `for…of await` → `Promise.all`.
**Impact:** n×T → ~max(T); 3 skills @5 s = 15 s → 5 s. Effort S, Risk Low.

**S4. Reconnect probe runs a live VM `exec("pwd")` on every page load**
`app/api/sandbox/reconnect/route.ts:111-118`. Two sequential network calls (SDK connect +
in-VM exec). For an already-active sandbox a DB-only fast path suffices.
**Impact:** −200–600 ms on the most frequent action (opening a session). Effort M, Risk Med.

**S5. Unconditional `updateNetworkPolicy` on every reconnect**
`packages/sandbox/vercel/sandbox.ts:722`. `connect()` always calls
`syncGitHubCredentialBrokering(sdk, undefined)` even when no token was ever brokered.
**Impact:** −1 Vercel control-plane call (~100–200 ms) per reconnect; reconnects fire ~4×/min.
Effort S, Risk Low.

**S6. 4 sequential `runCommand` RTTs for empty-repo git bootstrap**
`packages/sandbox/vercel/sandbox.ts:606-642`. `git init` + 2× `git config` + `git commit`
as 4 separate round-trips to the MicroVM.
**Fix:** one `bash -c 'git init && git config … && git config … && git commit …'`.
**Impact:** −3 RTTs (~150 ms; more cross-region). Effort S, Risk Low.

**S7. 2 sequential `git config` RTTs after clone**
`packages/sandbox/vercel/sandbox.ts:614-626`. Collapse into one `bash -c`.
**Impact:** −1 RTT (~50 ms). Effort S, Risk Low.

**S8. Token revocation blocks the response**
`app/api/sandbox/route.ts:229-232`. `await revokeInstallationToken(...)` in `finally`
(GitHub API ~100–300 ms) before responding; tokens auto-expire in 1 h anyway.
**Fix:** `void` it as best-effort background work.
**Impact:** −100–300 ms. Effort S, Risk Low.

**S9. Double connect on snapshot-restore fallback**
`app/api/sandbox/snapshot/route.ts:199-222`. Guard the legacy fallback when no legacy
snapshot exists. **Impact:** −300–800 ms on the failure path. Effort S, Risk Low.

**S10. Status poll runs even when hibernated**
`app/.../session-chat-content.tsx:2733-2756`. 15 s `setInterval` keeps a DB query going for
`no_sandbox`/hibernated sessions where state can only change on user action.
**Fix:** pause poll in terminal/hibernated state. **Impact:** −~4 DB queries/min/idle session.
Effort S, Risk Low.

---

## Domain 2 — Agent tool loop & LLM latency

**A1. Subagents have no prompt caching** ⭐
`packages/agent/subagents/{executor,explorer,design}.ts` have no `prepareStep`/`addCacheControl`
(verified: main agent has both at `open-agent.ts:276,338`; subagents have none). Every step of a
multi-step subagent re-sends growing context uncached.
**Fix:** add `prepareStep: ({messages,model}) => ({ messages: addCacheControl({messages,model}) })`.
**Impact:** −50–90 % TTFT on cached prefix per step after the first; ~80 % token-cost cut on
the accumulated prefix. Effort S, Risk Low.

**A2. Composio + GitHub tool resolution run serially each turn**
`app/workflows/chat.ts:2282-2477`. Independent (external API vs DB) but sequential → wall time
is the sum, not the max. **Fix:** `Promise.all`. **Impact:** −150–400 ms TTFT/turn when both
active. Effort S, Risk Low.

**A3. System-prompt cache breakpoint not resilient to tool-list churn**
`context-management/cache-control.ts:91-129`. Only the last tool + last message get breakpoints
(2 of Anthropic's 4). If the tool list changes (Composio add/remove), the implicit system-prompt
cache invalidates. **Fix:** add an explicit system-prompt breakpoint.
**Impact:** protects ~6,300-token static prefix (system ≈3.3k + tools ≈3k) from churn-driven
cache misses → −0.5–2 s TTFT on those turns. Effort S, Risk Low.

**A4. `getSessionById`/`getChatById` fetched ~3× per turn**
`api/chat/_lib/chat-context.ts:102-103`, `workflows/chat.ts:188-195`,
`workflows/chat-sandbox-runtime.ts:681`. React `cache()` doesn't cross durable-workflow step
boundaries. **Fix:** thread the fetched record between steps. **Impact:** −10–40 ms/turn. Effort M, Risk Low-Med.

**A5. `getUserPreferences` called up to 5× per turn** (overlaps D7)
`workflows/chat.ts:190`, `lib/agents/resolve-agent.ts:157` (×4 in a `Promise.all`).
**Fix:** hoist once and pass down, or `cache()`. **Impact:** −~30 ms/turn. Effort S, Risk Low.

**A6. Inference profile fetched twice per turn**
`workflows/chat.ts:240` + `lib/inference/profile-resolution.ts:33` (re-query + re-decrypt).
**Fix:** pass the resolved selection through. **Impact:** −10–20 ms/turn for profile users.
Effort S-M, Risk Low.

**A7. Per-chunk `WritableStream` writer lock/unlock**
`workflows/chat.ts:2551-2554`. Acquires/releases the writer on every delta.
**Fix:** acquire once, release in `finally` (verify workflow SDK semantics).
**Impact:** −5–25 ms per long response + less streaming jitter. Effort S, Risk Med.

**A8. Stop monitor polls at 150 ms**
`workflows/chat.ts:2805-2841`. Abort detected up to ~150 ms late → wasted output tokens.
**Fix:** shorter interval or push-based cancel. **Impact:** −0–100 ms stop latency + token cost.
Effort S, Risk Low.

---

## Domain 3 — Web frontend

**F1. 5,106-line monolithic chat client component, no memoized rows** ⭐
`app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`. Every token re-renders the
whole tree (40+ hooks, `groupedRenderMessages`, `currentToolStates` recomputed each render; no
`React.memo` row). **Fix:** extract a memoized `MessageRow`. **Impact:** ~200× fewer
reconciliations during a stream in a long session. Effort M, Risk Med.

**F2. No `React.memo` on `ToolCall`/`ToolLayout`**
`components/tool-call/tool-call.tsx:46`. Completed tool calls (stable props) re-render on every
token. **Fix:** wrap in `memo`. **Impact:** removes 100+ re-renders/sec in tool-heavy streams.
Effort S, Risk Low.

**F3. Shiki/`streamdownPlugins` eagerly initialized**
`lib/streamdown-config.tsx:1-167` imported statically in `session-chat-content.tsx:149` even
though `Streamdown` itself is dynamically imported → ~2 MB WASM lands in the main chunk.
**Fix:** co-locate plugin init with the dynamic `Streamdown` import. **Impact:** defers ~2 MB off
critical path; faster TTI. Effort M, Risk Med.

**F4. Unconditional 5 s observability poll on every chat page**
`hooks/use-session-observability.ts:188`. Fires even when idle / panel closed.
**Fix:** wire the existing `enabled` flag (panel open or chat in-flight); widen idle interval.
**Impact:** −~12 req/min per idle tab. Effort S, Risk Low.

**F5. ReactFlow imported eagerly on loop/run pages**
`loops/[loopId]/builder/page.tsx:7`, `runs/[runId]/run-detail.tsx:22`. ~150 KB gzipped needed
only on builder/graph views. **Fix:** `dynamic(() => …, { ssr:false })`. **Impact:** −~150 KB JS
on loop-detail/run-detail initial load. Effort S, Risk Low.

**F6. `next.config` under-optimized** ⭐ (easy)
`next.config.ts:23` sets `optimizePackageImports` only for `lucide-react`. Add the 11 `@radix-ui/*`
packages, `sonner`, `date-fns`; add `poweredByHeader:false`.
**Impact:** ~15–30 KB bundle reduction. Effort S, Risk Low.

**F7. Loops list/runs have no `initialData`; runs poll at 5 s unconditionally**
`loops/loops-list.tsx:139-145`, `loops/[loopId]/loop-detail.tsx:124`. Skeleton flash on every
nav; 12 req/min even with no active run. **Fix:** server-fetch + `fallbackData`; gate poll on
active runs. **Impact:** removes skeleton flash + idle polling. Effort M, Risk Low.

**F8. No `loading.tsx` in `/loops/*`**
Blocking navigation (sessions/settings have them). **Fix:** add segment skeletons.
**Impact:** −200–500 ms perceived nav. Effort S, Risk Low.

**F9. Status poll uses raw `setInterval`, never backs off** (overlaps S10)
`session-chat-content.tsx:2733-2756`. **Fix:** SWR `refreshInterval` + terminal-state gate.
Effort S, Risk Low.

**F10. Unnecessary `"use client"` on leaf components**
e.g. `loops/loop-card.tsx:1` (pure display). 222 client files; many are leaves.
**Impact:** structural; enables RSC extraction. Effort S, Risk Low.

---

## Domain 4 — Database & API

**D1. `chat_messages` has zero indexes** ⭐⭐ (verified)
`lib/db/schema.ts:754-765`. No `(table)=>[...]` block → full scan on every `getChatMessages`,
fork, delete-and-following. **Fix:** `index(chatId)` + `index(chatId, createdAt)`.
**Impact:** ~100 ms → ~1 ms per chat open at scale; the single highest-value index. Effort S, Risk Low.

**D2. `accounts.userId` not indexed** ⭐ (verified)
`lib/db/schema.ts:90-106`. Better Auth reads `accounts` by `userId` on every `getSession()`
(~550 call sites). **Fix:** `index(userId)` (+ composite `(accountId, providerId)`).
**Impact:** removes a full scan from every authenticated request. Effort S, Risk Low.

**D3. `authSessions.userId` not indexed**
`lib/db/schema.ts:109-120` (token is unique, good; userId path scans).
**Fix:** `index(userId)`. **Impact:** Med (session list/invalidation). Effort S, Risk Low.

**D4. Postgres client has no pool config / not Neon HTTP** (verified)
`lib/db/client.ts:15` = `postgres(URL)` defaults (max 10, no idle/connect timeout), TCP.
**Fix:** tune pool (`max`, `idle_timeout`, `connect_timeout`); consider `@neondatabase/serverless`
HTTP for hot reads. **Impact:** avoids connection-slot exhaustion; −50–200 ms cold-conn per
function instance. Effort M, Risk Med.

**D5. No Redis read-caching for stable per-user data**
`lib/redis.ts` wired only for rate-limit. Preferences/profiles/models fetched from PG every
request/poll. **Fix:** short-TTL Redis cache w/ write invalidation. **Impact:** ~1 ms vs 10–20 ms
per hit on hot paths. Effort M, Risk Low-Med.

**D6. Background-agent status fetches 50 rows, filters in JS** ⭐ (easy)
`app/api/background-agents/[agentId]/status/route.ts:26-38`. Polled per active card; the
`(agentId, createdAt)` index already supports a scoped `limit:1`. **Fix:** scope the query.
**Impact:** 50× less data per poll. Effort S, Risk Low.

**D7. `getUserPreferences` called 2–4× per request, no request cache** (overlaps A5)
`lib/db/user-preferences.ts:150-159` (e.g. `sessions/route.ts:301` + `resolve-repo-defaults.ts:199`;
`settings/model-variants` 4×). **Fix:** React `cache()` (userId is unique) or thread through.
**Impact:** −30–80 ms per complex request. Effort S, Risk Low.

**D8. `getAgentLoopStepRunWithContext` does 2 sequential round-trips**
`lib/agent-loops/store.ts:558-574`. Hot per loop step. **Fix:** single JOIN.
**Impact:** −10–20 ms/step (×steps). Effort M, Risk Low.

**D9. Stall sweep uses correlated subqueries**
`lib/agent-loops/store.ts:1245-1276`. O(N) subqueries. **Fix:** `DISTINCT ON` / window function.
**Impact:** Med at 50+ active runs (cron path). Effort M, Risk Low.

**D10. `getUsedSessionTitles` scans all titles, no LIMIT**
`lib/db/sessions.ts:296-304` (per new-session POST). **Fix:** `COUNT` a candidate or `LIMIT`,
or generate name client-side. **Impact:** Low-Med. Effort S, Risk Low.

---

## Implementation tiers

**Tier A — ship now (safe, high-impact, testable):**
- D1 `chat_messages` indexes; D2 `accounts.userId` (+ composite); D3 `authSessions.userId` (one migration)
- A1 subagent prompt caching
- S6 + S7 sandbox git-bootstrap batching
- A2 parallelize Composio + GitHub tool resolution
- F6 `next.config` package-import optimization
- D6 scoped background-agent status query
- D7/A5 `getUserPreferences` request caching

**Tier B — high value, needs more care/testing:**
- S1 base-snapshot baking (biggest single win; needs snapshot pipeline + versioning)
- S2/S3/S8 move skill install + token revoke off critical path
- S4 DB fast-path reconnect; S5 conditional network-policy
- F1/F2/F3 chat-render memoization + Shiki deferral
- D4 Postgres pool tuning / Neon HTTP for hot reads

**Tier C — opportunistic:**
- A3, A4, A6, A7, A8, S9, S10, F4, F5, F7, F8, F10, D5, D8, D9, D10
