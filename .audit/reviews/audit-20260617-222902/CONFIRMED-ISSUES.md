# CONFIRMED ISSUES — Deep Adversarial Review (audit-20260617-222902)

Triage/synthesis pass over domain-reviewer survivors that cleared 3x adversarial
verification. Two candidate findings survived; both were independently re-verified
against the checked-out branch (`feat/performance-optimizations`, repo root
`/Users/dennison/develop/open-agents`) before filing. Dedup against
`open-issues.txt` (143 entries): **no duplicates** — none of the open issues
address rate-limit parity on the snapshot route or a host guard on the inference
`baseUrl`. Neither restates a resolved `docs/agents/lessons-learned.md` entry.

One finding (inference-models-1) was kept but **corrected**: two of its three
claimed triggers were inaccurate on the actual branch. The corrections are noted
inline and reflected in the issue body so the implementer is not misled.

Severity policy: only MEDIUM+ filed. Both survivors are medium. Lows are listed
in `COVERAGE-GAPS.md`. No truncation (2 issues < 50 cap).

---

## Issue 1 — `fix: sandbox snapshot pause (POST) and resume (PUT) routes lack rate-limit and bot-protection parity with every other mutating sandbox route`

- **Severity:** medium
- **Category:** security (defense-in-depth / abuse-surface consistency)
- **Source findings:** `sandbox-lifecycle-2`
- **Scratchpad refs:** `docs/ux-walker/inference-models.md` (adjacent, untracked); verifier notes in `sandbox-lifecycle.md`
- **Labels:** `type:bug`, `type:regression`, `severity:medium`

### Verified code facts (re-checked on this branch)
- `apps/web/app/api/sandbox/snapshot/route.ts` imports **neither** `@/lib/botid`
  (`checkBotProtection`) **nor** `@/lib/rate-limit` (`checkRateLimit`/`rateLimitKey`).
  Both handlers (POST pause at line 41, PUT resume at line 109) call only
  `requireAuthenticatedUser` + `requireOwnedSession(WithSandboxGuard)`.
- Sibling routes all apply both guards: create POST `apps/web/app/api/sandbox/route.ts:121,126`
  (20/min), DELETE `route.ts:306,311` (10/min), extend `apps/web/app/api/sandbox/extend/route.ts:27,32`
  (3/min).
- No `apps/web/middleware.ts` exists, so there is no global throttle — protection
  is purely per-handler opt-in.
- PUT resume reaches a real provider VM operation when not already running:
  `connectSandbox({..., resume:true})` / legacy `createIfMissing:true,persistent:true`
  (`snapshot/route.ts:191-211`). After a successful resume the bare PUT loop is
  idempotent (`alreadyRunning` short-circuit, lines 149-162), so the genuine abuse
  is the alternating **POST (stop, clears runtime state) → PUT (resume) → POST → PUT**
  cycle, each iteration incurring one real `sandbox.stop()` teardown and one real
  `connectSandbox({resume:true})` against the user's own Vercel Sandbox quota —
  unthrottled.

### Severity rationale (medium, not high/low)
- Bounded to the user's **own** session and quota via `requireOwnedSession` — no
  cross-tenant cost amplification, no auth bypass, no data exposure. Verifiers split
  medium/low; synthesis keeps medium because the inconsistency is concrete, the
  create POST already throttles the same `resume:true` operation at `route.ts:225-226`,
  and parity is a cheap, expected fix. Not high because impact is self-inflicted
  cost/quota churn requiring valid auth + ownership.

---

## Issue 2 — `fix: inference-profile baseUrl has no host guard, enabling server-side SSRF and self-credential forwarding via the Anthropic SDK`

- **Severity:** medium
- **Category:** security (SSRF / credential forwarding)
- **Source findings:** `inference-models-1`
- **Scratchpad refs:** `docs/ux-walker/inference-models.md` (untracked, independently
  corroborates; the "auto-fires on create" detail there is **inaccurate** on this branch)
- **Labels:** `type:bug`, `type:regression`, `severity:medium`

### IMPORTANT corrections to the original finding (verified on this branch)
1. **`apps/web/lib/inference/fetch-profile-models.ts` does NOT exist** in this
   checkout. It exists only in two worktrees (`baas-builder-ux`,
   `loops-ux-audit`). The cited `fetchInferenceProfileModels` is **never called**
   anywhere in `apps/web` or `packages/agent` on this branch. The `x-api-key` →
   `/v1/models` GET mechanism described in the finding is therefore **not present**.
2. **TRIGGER 1 ("auto-fires on profile create") is FALSE.** The create POST handler
   (`apps/web/app/api/inference-profiles/route.ts:40-66`) only calls
   `createInferenceProfile(...)` and returns `{ profile }`. No fetch is issued on
   create. The verifier reasoning that cited `route.ts:66-69` was reading the
   worktree version, not the committed branch.

### Verified code facts (the real, surviving surface)
- `baseUrlInputSchema` (`apps/web/lib/inference/types.ts:18-35`) only refines on
  `url.protocol === "https:" || url.protocol === "http:"`. **No host restriction.**
- `normalizeAnthropicBaseUrl` (`apps/web/lib/inference/model-routing.ts:3-23`) only
   adjusts the path to `/v1`; it never inspects the host. A `baseUrl` like
   `http://169.254.169.254` or `https://attacker.example` passes unchanged.
- **TRIGGER 2 (test route) — TRUE.** `apps/web/app/api/inference-profiles/[profileId]/test/route.ts:64-70`
   calls `generateText({ model: directAnthropicModel({ apiKey, baseURL: profile.baseUrl }) })`.
   `directAnthropicModel` (`packages/agent/models.ts:198-202`) builds
   `createAnthropic({ apiKey, baseURL })`, so the Anthropic SDK issues a server-side
   authenticated POST to the user-controlled `baseUrl` with the user's own decrypted
   key in the auth header.
- **TRIGGER 3 (chat) — TRUE.** `apps/web/lib/inference/profile-resolution.ts:61-68`
   returns `directAnthropic: { apiKey: decryptInferenceProfileApiKey(profile), baseURL: profile.baseUrl }`,
   feeding the same SDK path on the first chat turn.
- No `apps/web/middleware.ts`; `vercel.json` has only a cron entry — no egress/
   host firewall. Global grep for `ssrf|isPrivateIp|denyHost|allowHost|169.254|loopback|safeFetch|allowlist`
   in `lib`/`app`/`packages/agent` returns **zero** host-guard hits (the only
   "allowlist" matches are unrelated background-agent repo allowlists).

### Severity rationale (medium, not high/low)
- **Self-scoped BYOK, not cross-user:** all profile reads filter `eq(userId)` and
  chat re-checks session ownership; the forwarded key is the user's own. No IDOR.
- On Vercel (Node runtime, `import "server-only"`), the classic `169.254.169.254`
  cloud-metadata SSRF is largely neutralized by platform egress restrictions, but
  reaching attacker-controlled or locally-reachable hosts and the
  self-credential-forwarding pattern (user tricked into pointing their profile at
  an attacker host → server ships their key there) fully manifest. The
  defense-in-depth fix (loopback/private/link-local/metadata denylist, or a
  provider allowlist on `baseUrl`) is cheap and expected for a BYOK feature. Kept
  medium over low because it is a genuine unguarded server-side authenticated
  request to a user-chosen host, not a purely theoretical vector.

---

## Counts
- Candidate findings received: 2 survivors + 1 refuted + 2 lows = 5
- Verified survivors (medium+): **2**
- Confirmed issues filed: **2**
- Dropped as false-positive / framework-mitigated: **1** (+ 2 lows below threshold)
- Truncated: **no** (2 < 50)
