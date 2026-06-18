# COVERAGE GAPS — Deep Adversarial Review (audit-20260617-222902)

Aggregate reviewer coverage gaps across the sandbox-lifecycle and inference-models
domains, plus the two low-severity items that did not clear the medium filing bar.
Use this to scope a follow-up review pass.

## Low-severity items deferred (not filed; below medium threshold)
1. **sandbox-lifecycle (low):** Create route returns 500 and skips the lifecycle
   kick if per-user skill install throws, despite the sandbox VM and DB state
   already being persisted. Partial-success / error-handling inconsistency.
2. **inference-models (low):** `/api/models` GET has no authentication and exposes
   the full configured gateway model catalog (ids, names, descriptions, context
   windows, pricing) to anonymous callers. Non-sensitive metadata disclosure.

## sandbox-lifecycle coverage gaps (from reviewers)
- Client-side consumers of `/api/sandbox/reconnect` and `/api/sandbox/status`
  (chat UI, status chips) were not reviewed; server returns correct status enums
  but client handling of `expired` / `no_sandbox` or `lifecycleTiming.state` was
  not verified.
- `@open-agents/sandbox` `connectSandbox` internals (`extendTimeout` hard-max
  enforcement, `expiresAt` semantics, snapshot 421/422 handling) only partially
  read. Confirmed exec timeout returns `success:false` (not throw) but snapshot
  error paths were not exhaustively traced.
- Archive/unarchive flow (`lib/sandbox/archive-session.ts`) only skimmed; the
  archive-snapshot/unarchive race lesson was noted but current unarchive gating
  code was not re-verified in depth.
- `sandbox-services/[serviceId]/*` and `lib/sandbox/runtime/service-launch.ts`
  (managed runtime service start/stop, log streaming) not deeply reviewed.
- **No `apps/web/middleware.ts` exists**, so all rate-limiting is per-route opt-in.
  The snapshot gap was filed (Issue 1); other VM-creating paths
  (e.g. chat-sandbox-runtime setup) were not audited for equivalent gaps.
  This is the highest-leverage follow-up review target.

## inference-models coverage gaps (from reviewers)
- Did not exercise live `gateway.getAvailableModels()` against a real Vercel AI
  Gateway token; `/api/models` behavior inferred from code + unit tests only.
- `packages/agent` provider-option defaulting (`getProviderOptionsForModel`) and
  variant `providerOptionsOverrides` merging only skimmed, not exhaustively
  reviewed for correctness.
- Chat streaming path's handling of a profile whose key fails to decrypt
  mid-stream was not deeply traced beyond confirming `profile-resolution` throws
  and `chat.ts` surfaces the error.
- Did not audit managed-runtime/sandbox consumers of inference profiles (out of
  this domain's scope).
- **Verifier methodology gap:** the inference-models-1 verifier read the
  `loops-ux-audit` worktree instead of the committed branch, which produced two
  inaccurate trigger claims (`fetch-profile-models.ts` does not exist on `main`/
  this branch; create POST does not auto-fetch). Future verification passes should
  pin to `git rev-parse --show-toplevel` + the checked-out branch, not a sibling
  worktree, to avoid phantom-file citations.

## Triage note
No truncation applied (2 confirmed issues, well under the 50 cap). Dedup against
`open-issues.txt` (143 entries) found no matches for either confirmed issue and no
match for the refuted finding.
