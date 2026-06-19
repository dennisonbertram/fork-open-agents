# Epic: GitHub Actions & Secrets Manager

Prepared: 2026-06-09

Status: planning, not ready for implementation

GitHub issue: https://github.com/dennisonbertram/fork-open-agents/issues/263

---

## Executive Summary

A repo-scoped settings surface that lets a connected user **view and operate GitHub Actions** (workflows, runs, jobs, statuses, logs, plus re-run/cancel/dispatch) and **manage Actions Secrets** (list names + metadata; create/update/delete via libsodium sealed-box, across repository + environment scopes; organization scope deferred) for any repository covered by their existing GitHub App installation.

The surface composes **entirely on top of the existing GitHub App install model** and the `withScopedInstallationOctokit()` token broker in `apps/web/lib/github/*`. There is **no new OAuth flow** and **no new DB table for v1** — GitHub is the source of truth for all live Actions state and all secret data, and the existing `sessionEvents` table is the audit ledger.

Status is rendered through two shared visual dialects, used deliberately so this surface feels like one product with the rest of the app:

- **`ReadinessVerdict`** (`components/ui/readiness-verdict.tsx`) for "is this configured / available" health blocks — App permission presence (Actions read/write, Secrets read/write, Environments read/write) and secret-presence summaries. Status taxonomy `ready | action-needed | unavailable | error`.
- A **dedicated run-status → color map** (reusing the existing `StatusPill` pattern already used by repo agents) for workflow run lifecycle states, which do **not** map cleanly onto the 4-value readiness taxonomy.

Every page is built from `SettingsSection` / `SettingsPageHeader`, not bespoke cards.

The secret-value path is strictly **write-only**: GitHub's Secrets API never returns values, so the surface only ever shows **NAMES + `updated_at` metadata**, and `crypto_box_seal` encryption happens server-side only. The plaintext value lives in process memory for the milliseconds between request-body parse and the sealed-box `PUT`, and is never persisted, logged, or returned.

Ships in **4 PR-sized slices**, read/status before write, inert permission-aware UI before mutation, so the App permission upgrade can roll out behind a readiness gate.

---

## Why This Matters

Open Agents already mints scoped installation tokens to open/merge/close PRs on a user's repos, but operators have **zero visibility into the CI that gates those PRs** and **no way to manage the Secrets that CI depends on** — they must leave the product and go to github.com.

This is the natural UI companion to the [dev → prod env/secrets epic](dev-staging-production-env-secrets-epic.md). That epic establishes the philosophy "secret values are toxic; surface NAMES + status only, never decrypted values; redact in logs/shared-pages/screenshots; audit grants." The GitHub Secrets API is the perfect embodiment of that philosophy because it **physically cannot return values** — leaning into the API is leaning into the philosophy.

Adding an Actions/Secrets manager closes the loop between "agent opened a PR" and "did CI pass, and does the repo have the secrets the workflow needs" — turning Open Agents into a place you can actually **operate** a repo from, not just a place that writes code. It also creates the foundation for background-agent runs and verified-build runs to eventually correlate against the real `workflow_run` that gated them, which is the platform-coherence direction the concurrent "observable, governable run" epic is pushing toward.

---

## User/Operator Path Protected

An authenticated user who has the GitHub App installed on a repo:

1. Opens the repo's **Actions** tab in Open Agents.
2. Sees a `ReadinessVerdict` block stating App permission status, then the live list of workflow runs with correct status dots, and can re-run a failed run.
3. Switches to the **Secrets** tab, sees the list of secret **NAMES** with last-updated metadata (never any value), and creates a new repository secret that is sealed-box encrypted server-side and successfully accepted by GitHub.

At no point is a plaintext secret value, the GitHub App token, a decrypted value, or a signed 302 log/artifact URL present in the client bundle, in any network response body, or in any log line.

---

## Key Research Findings

Each finding cites its grounding source.

- **Read-only manager needs only `actions:read` + `metadata:read`; dispatch/re-run/cancel needs `actions:write`. Editing workflow YAML needs the SEPARATE `workflows` permission (not `actions`)** — explicitly out of scope to avoid the documented `refusing to allow a GitHub App to create or update workflow` error and the associated infinite-loop risk. (src: GitHub Actions REST API research; https://docs.github.com/en/rest/overview/permissions-required-for-github-apps; community discussion #27072)
- **Repo + org secrets use the GitHub App `Secrets: write` permission; environment secrets use the DISTINCT `Environments: write` permission.** A read-only inventory needs only the read level of each. This is a common permission gap that silently breaks env writes while repo writes succeed. (src: GitHub Secrets REST API research; https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
- **Secret write is a strict 3-step server-side recipe:** `GET /…/secrets/public-key` for the EXACT scope (capture `key` AND `key_id` together), encrypt with `libsodium-wrappers` `crypto_box_seal` using `base64_variants.ORIGINAL` on **both** `from_base64` and `to_base64` (the default `URLSAFE_NO_PADDING` produces silently-wrong output), then `PUT { encrypted_value, key_id }`. Never cache `key_id` across scopes/fetches. Use `libsodium-wrappers`, NOT the deprecated/broken `tweetsodium`. (src: GitHub Secrets API research; https://docs.github.com/en/rest/guides/encrypting-secrets-for-the-rest-api; libsodium-wrappers v0.8.4)
- **The existing token broker is exactly the pattern needed.** `withScopedInstallationOctokit()` (`apps/web/lib/github/app.ts:159-178`) mints a per-repo scoped token, runs an async closure, then revokes. `verifyRepoAccess()` (`apps/web/lib/github/access.ts:65-135`) already returns `(installationId, repositoryId, defaultBranch)`. We extend the permissions object to add `actions`/`secrets`/`environments`. (src: GitHub integration internals mapping; `apps/web/lib/github/app.ts`, `apps/web/lib/github/access.ts`)
- **`mintInstallationToken()` enforces a single-repo invariant.** It throws `Installation tokens must be scoped to exactly one repo` when `repositoryIds.length !== 1` (`apps/web/lib/github/app.ts:98-100`), and `withScopedInstallationOctokit` takes a single `repositoryId`. This invariant is a deliberate safety property; org-scoped secrets would require minting **without** `repository_ids` (org-wide blast radius) — which is why **org scope is deferred to a later, separately-justified slice and is NOT in v1** (see Open Decisions). (src: GitHub integration internals mapping; `apps/web/lib/github/app.ts`)
- **A read-only Actions surface ALREADY EXISTS and is live.** `lib/github/repo-dashboard.ts` has `fetchActionsSummary` + `ActionsSummary`/`ActionRunItem` types + a `DashboardErrorKind` taxonomy, surfaced as `ActionsWindow` on `/repos/[owner]/[repo]/page.tsx` and served by `/api/repos/[owner]/[repo]/dashboard/route.ts`. **It authenticates with `getUserOctokit` (user OAuth token), not an installation token.** This epic **extends and unifies** that reader rather than building a parallel one — see System Design → Source of Truth and Slice CODE-01. (src: Open Agents repo-dashboard internals)
- **`workflow_dispatch` POST returns 204 with NO `run_id`.** Identifying the triggered run requires polling `GET /workflows/{id}/runs?event=workflow_dispatch` and timestamp-matching — racey under concurrent dispatch. The workflow file must exist on the **default branch** for the event to register at all. (src: GitHub Actions REST API research; https://docs.github.com/en/rest/actions/workflows)
- **Log and artifact download endpoints return 302 redirects to signed URLs that expire after ~1 minute** — must proxy server-side and re-request a fresh redirect each time; never store the `Location` URL or expose it client-side. GitHub run/job logs are full ZIP / large raw text — structurally **not** pre-grouped into steps with per-line levels. (src: GitHub Actions REST API research; https://docs.github.com/en/rest/actions/workflow-jobs)
- **Settings UI is uniform.** `SettingsPageHeader` + stacked `SettingsSection` (`rounded-xl border bg-card p-5`, `tone default|danger`), `useSWR` + `Skeleton` fallback, inline `text-destructive` errors, `sonner` toasts, `ReadinessVerdict` for "is this configured/available" blocks. Repo-scoped pages already use `/repos/[owner]/[repo]/` dynamic routing. (src: Open Agents Settings & Integration Design Language; `apps/web/components/ui/settings-section.tsx`, `readiness-verdict.tsx`)
- **Best-in-class secrets UI is a Table** (Key | masked-or-no-value | Updated by/at | kebab; Add via Dialog + react-hook-form + zod; Delete via destructive `AlertDialog` naming the key). **Best-in-class runs UI is a filterable run list** (status dot + #num + branch chip + actor + relative time + kebab Re-run all / Re-run failed / Cancel) feeding a split detail with a monospace log console. (src: UX patterns research; Mobbin StackAI/Cursor/Exa/GitHub/Vercel flows)
- **Idempotency/webhook infra already exists** (HMAC-SHA256 timing-safe verify, `X-GitHub-Delivery` dedup, `after()` enqueue, `redactBackgroundAgentPayload`). Subscribing to `workflow_run`/`workflow_job` webhooks for live status is OPTIONAL and additive — **SWR polling is sufficient for v1** and avoids a webhook-subscription + App-event change; the `workflow_job` `steps[]` payload is also flagged as unreliable. (src: Inbound Webhook research + Background Agents subsystem; `apps/web/app/api/github/webhook/route.ts`)

---

## System Design

### Source of Truth (split) — and the auth-identity decision

**GitHub is the source of truth for ALL live Actions state and ALL secret data.** Open Agents owns **no** copy of workflows, runs, jobs, logs, artifacts, or secret values. Every read is a pass-through to the GitHub REST API rendered on demand.

Open Agents owns only:

1. The user/installation/repo-access mapping it already has (`githubInstallations`, `verifyRepoAccess`).
2. A thin **audit trail** of mutating operations the user performed through the product (dispatch / re-run / cancel / secret create-update-delete), recorded as `sessionEvents` with redaction — capturing **WHAT** action against **WHICH** scope/name, never the value or the encrypted blob.
3. A small, cache-free **readiness summary** computed live (does the App have `actions` / `secrets` / `environments` permission on this repo).

Secret values exist in process memory only for the milliseconds between request-body parse and the sealed-box `PUT`.

**Auth-identity decision (resolves the reviewer's auth-model contradiction).** Every read and every write in this surface standardizes on the **scoped installation token** via `withScopedInstallationOctokit()`, **not** the user OAuth token. Rationale:

- It is consistent with the secrets write path (org/repo secret endpoints are App-permission-gated) and with the SECURITY claim that every call is a scoped-installation pass-through.
- It gives one rate-limit bucket (installation token, 5,000 req/hr) and one audit-actor semantic, instead of mixing the user token's separate bucket and blast radius.
- It keeps the per-call token mint → use → revoke discipline the broker already enforces.

Because the **existing `fetchActionsSummary` reader uses `getUserOctokit`**, Slice CODE-01 **explicitly migrates that reader (and the `ActionsWindow` dashboard path that consumes it) onto the scoped installation token**, and **unifies its `DashboardErrorKind` Actions cases into the single `GithubActionsErrorKind` taxonomy** below. We do not stand up a parallel reader or a parallel taxonomy. (This directly answers the SCOPE/DUPLICATION and FEASIBILITY+SECURITY review items.)

Authorization is enforced **per route** with `requireOwnedSession` → `verifyRepoAccess` (user can see the repo AND App installed AND covers the repo) **before** any GitHub call. Org-scope (deferred) additionally requires an **explicit org-admin authority check on the USER** (see Security & Safety) — `verifyRepoAccess` deliberately returns no org-admin signal.

### Data Model (TS / Drizzle sketches)

**No new tables for v1.** GitHub holds all state; the existing `sessionEvents` table is the audit ledger. The only persistence is structured, redacted audit events emitted via `emitSessionEvent` (`apps/web/lib/observability/events.ts`).

`sessionEvents` is keyed on `sessionId` (a chat session) and requires `sessionId` + `userId` (NOT NULL), and supports `requestId` + `redactionStatus`. This surface is **repo-scoped with no chat session**, so we mint a **synthetic correlation id** and record full attribution:

```ts
// apps/web/lib/github/actions-manager/audit.ts (new)

// Synthetic session id for repo-scoped (sessionless) audit rows.
// Shape: "gha:{installationId}:{owner}/{repo}" — stable per repo, satisfies
// the sessionEvents NOT NULL sessionId without a real chat session.
function repoAuditSessionId(installationId: number, owner: string, repo: string): string {
  return `gha:${installationId}:${owner}/${repo}`;
}

// Typed payload persisted via emitSessionEvent (redacted before write).
type GithubActionsActionEvent = {
  service: "github-actions-manager";
  action:
    | "workflow.dispatch"
    | "run.rerun"
    | "run.rerun_failed"
    | "run.cancel"
    | "secret.created"
    | "secret.updated"
    | "secret.deleted";
  scope: "repository" | "environment" | "organization";
  repoOwner: string;
  repoName: string;
  // Correlation IDs (mirrors the shared correlation-ID set):
  userId: string;            // authority actor
  installationId: number;    // App install
  requestId: string;         // per-request UUID, also returned in response header
  sessionId: string;         // synthetic repoAuditSessionId(...)
  workflowId?: string;
  runId?: number;
  environmentName?: string;
  secretName: string | null; // NAME only — NEVER the value
  dispatchRef?: string;      // branch/tag for dispatch
  // Shared audited-event-with-redaction primitive:
  redactionStatus: "not_required" | "passed" | "failed" | "blocked";
  // NEVER present: encrypted_value, plaintext value, key, key_id is omitted.
};
```

```ts
// apps/web/lib/github/actions-manager/errors.ts (new) — the ONE unified taxonomy.
// Slice CODE-01 folds the existing repo-dashboard DashboardErrorKind Actions
// cases into this; there is no second taxonomy.
type GithubActionsErrorKind =
  | "no_installation"
  | "app_no_actions_permission"
  | "app_no_secrets_permission"
  | "app_no_environments_permission"
  | "workflow_not_on_default_branch"
  | "dispatch_input_invalid"
  | "secret_name_invalid"
  | "secret_too_large"
  | "user_not_org_admin"        // reserved for the deferred org slice
  | "github_rate_limited"
  | "github_error";
```

**Optional future (NOT in v1):** if webhook-driven real-time status is ever required, introduce one cache-only table mirroring the background-agents pattern; GitHub stays the source of truth.

```ts
// FUTURE / NOT v1:
// githubWorkflowRunSnapshots {
//   id, userId, installationId, repoOwner, repoName,
//   runId (unique per repo), workflowId, status, conclusion,
//   headBranch, headSha, runNumber, event, htmlUrl,
//   startedAt, updatedAt, createdAt
// }  // cache only
```

### Integration Points (real files)

- **`apps/web/lib/github/app.ts`** — extend the permissions object passed to `mintInstallationToken()` / `withScopedInstallationOctokit()` to optionally include `{ actions?: "read"|"write"; secrets?: "read"|"write"; environments?: "read"|"write" }`. The single-repo invariant at line ~98 stays intact for all v1 work. (Org scope, if ever built, requires a separately-justified sibling that omits `repository_ids` — out of v1.)
- **`apps/web/lib/github/access.ts`** — reuse `verifyRepoAccess()` to gate every route; its `(installationId, repositoryId, defaultBranch)` return powers the dispatch default-branch check.
- **`apps/web/lib/github/repo-dashboard.ts`** — **migrate** `fetchActionsSummary` off `getUserOctokit` onto `withScopedInstallationOctokit`; **map** its Actions `DashboardErrorKind` cases into `GithubActionsErrorKind`. (CODE-01.)
- **`apps/web/lib/github/actions-manager/*`** (NEW concern folder, do not append): `workflows.ts`, `runs.ts`, `jobs.ts`, `logs.ts` (302-follow proxy), `dispatch.ts` (POST + bounded poll-for-run), `errors.ts`, `audit.ts`, `readiness.ts`.
- **`apps/web/lib/github/secrets-manager/*`** (NEW): `encrypt.ts` (libsodium sealed-box, `base64_variants.ORIGINAL`), `scope-router.ts` (scope → public-key endpoint + required permission), `repo-secrets.ts`, `environment-secrets.ts` (deferred to CODE-04), `org-secrets.ts` (deferred / out of v1).
- **`apps/web/lib/background-agents/github-app-webhooks.ts`** — do **NOT** mutate the background-agents fixed required-permissions readiness set (that would break the background-agents readiness UI for every existing install). Add a **separate** Actions/Secrets readiness check in `apps/web/lib/github/actions-manager/readiness.ts`.
- **API routes** under `apps/web/app/api/github/repos/[owner]/[repo]/actions/*` and `…/secrets/*` (and `…/environments/[...env]/secrets/*` in CODE-04). Quote bracket paths in git per CLAUDE.md.
- **`apps/web/app/repos/[owner]/[repo]/`** — add **Actions** and **Secrets** tabs to the existing repo surface. Do **NOT** touch `apps/web/app/settings/nav-items.ts` / `SETTINGS_NAV_GROUPS` (wrong altitude — these are inherently per-repo).
- **`apps/web/lib/observability/events.ts`** — reuse `emitSessionEvent` for the audit ledger.
- **`apps/web/lib/harness/redaction.ts`** — reuse `redactHarnessPayload` (already matches `secret|token|api_key|password|credential` patterns) and add a code-level guard ensuring the secret-value field name is never added to any payload object in the first place.
- **`apps/web/components/ui/readiness-verdict.tsx`** + **`settings-section.tsx`** — reuse as-is for health/layout. Run-status dots reuse the existing **`StatusPill`** run-status→color map, NOT the readiness taxonomy.
- **`apps/web/package.json`** — add `libsodium-wrappers` (CODE-03).

### UX Model (states + copy; reuse `SettingsSection` / `ReadinessVerdict`)

**Entry points.** Two tabs on the existing repo surface at `/repos/[owner]/[repo]/`: **Actions** and **Secrets**. A `ReadinessVerdict` block sits at the top of each tab stating App permission status (`ready`: "Connected — Actions read/write available"; `action-needed`: "Action needed — re-authorize the GitHub App to manage Actions" with a button to GitHub).

**Actions tab — primary flow.** `SettingsSection` wrapping a filterable run list. Each run row uses the **`StatusPill` run-status→color map** (queued / in_progress pulsing amber, success green, failure destructive red, cancelled / skipped / timed_out / action_required / stale / startup_failure muted/dedicated colors via the map), plus workflow name + `#run_number`, branch `Badge`, actor, relative time + duration, and a kebab `DropdownMenu` (Re-run all / Re-run failed jobs / Cancel — Cancel only when `in_progress`; Re-run guarded behind `actions:write` readiness). A "Run workflow" primary button opens a `Dialog` with a workflow `Select` (only `workflow_dispatch`-enabled), a ref `Input` (defaults to default branch), and inputs fields; on submit it POSTs dispatch, optimistically toasts "Run started", and **SWR-polls** with a **bounded post-dispatch poll** (poll for N seconds regardless of `in_progress` so the just-dispatched run appears even when no run is yet `in_progress`; otherwise `refreshInterval ~5s only while a run is in_progress`).

Clicking a run opens a `Sheet` (right) split detail: jobs list with status icons → **v1 log scope: raw text passthrough** in a monospace console (`role="log"`, `aria-live="polite"`, copy button), fetched through the server 302-proxy. The rich console (collapsible grouped steps, per-line timestamps, level `ToggleGroup`, find-in-logs) requires GitHub log **parsing** and is moved to a **later, separate slice** — it is explicitly out of CODE-01.

States: empty ("No workflow runs yet for this repo"), loading (`Skeleton` rows matching the run-row layout), error (inline `text-destructive` "Couldn't load runs — try again").

**Secrets tab — primary flow (v1: repository scope; CODE-04 adds environment).** A `SettingsSection` with a `Table` — Name (monospace) | Updated | kebab (Edit value / Delete). **No value column, no reveal eye** — there is nothing to reveal because values are never returned; this is the secret philosophy made literal, surfaced via `FieldHelp` copy "GitHub never returns secret values, so we only show names." "Add secret" opens a `Dialog` + react-hook-form + zod: Name `Input` (validate alphanumeric + underscore, not starting with `GITHUB_` or a digit — client mirror of GitHub rules) + a masked value `Input` (`type=password`, never echoed back, ≤48KB guard). Submit → server encrypts → toast "Secret <NAME> saved". Delete → destructive `AlertDialog` naming the key ("Delete <NAME>? This can break workflows that use it."), default focus on Cancel.

In CODE-04, a scope `ToggleGroup` (Repository / Environment) appears; Environment scope adds an environment `Select`.

States: empty (centered "No secrets in this scope. Add one to make it available to workflows."), loading (`Skeleton` table), error (inline), permission-gated (`ReadinessVerdict` "App needs Secrets write — re-authorize").

**Reuse.** `SettingsSection` (`tone="danger"` for the delete region), `SettingsPageHeader`, `ReadinessVerdict` (permission + secret-presence), `useSWR` + `Skeleton`, `sonner` toasts, `Dialog`/`AlertDialog`/`Sheet`/`Table`/`ToggleGroup`/`Badge`/`DropdownMenu`/`Tooltip` from shadcn, lucide icons (`Play`, `RefreshCw`, `Ban`/`X`, `Plus`, `Trash2`, `Lock`). Copy tone: plain-language verbs (Run, Re-run, Cancel, Add, Delete), <120-char descriptions, consistent with #229 / #235 / #236.

### Security & Safety

- **Secret values are write-only and ephemeral.** Plaintext lives only between request-body parse and the sealed-box `PUT`; never persisted, never logged, never returned. `crypto_box_seal` happens server-side only in `apps/web/lib/github/secrets-manager/encrypt.ts` (must `await sodium.ready`; must use `base64_variants.ORIGINAL` on both decode and encode).
- **Request-body logging is DISABLED for the secret routes.** Redaction happens at event-emit time, *after* body parse — so any upstream framework/observability request-body logger would leak plaintext before the handler redacts. The secret `PUT`/`POST` routes explicitly opt out of any request/response body logging (Next.js + observability middleware), and the value field is read into a local, never spread into a logged object.
- **Installation token never reaches the client.** Minted, used in a closure, revoked via `withScopedInstallationOctokit`. The GitHub App token and any decrypted value are never in the client bundle.
- **Authorization per route.** `requireOwnedSession` → `verifyRepoAccess` before any GitHub call.
- **Org-secret authority is a hard gate (deferred slice).** `verifyRepoAccess` returns no org-admin signal. Writing an org-level secret (`visibility: all`) injects a credential into every repo's CI in the org — a far larger privilege than one repo secret. Therefore org scope is **out of v1**, and if ever built it requires (a) an explicit **org-admin authority check on the USER** via the user Octokit org membership/role, returning `user_not_org_admin` on failure, **and** (b) a separately-justified org-wide token mint that omits `repository_ids`, with documented widened blast radius. (Resolves both MUST-FIX org items.)
- **Redaction.** All audit events go through `redactHarnessPayload`; `redactionStatus` (`not_required|passed|failed|blocked`) recorded per event using the shared primitive; plus a code-level guard that the secret-value field name is never added to a payload.
- **Signed 302 URLs** for logs/artifacts are followed server-side and never handed to the client.
- **Dispatch gating + input validation.** Dispatch is gated on the workflow existing on the default branch (`verifyRepoAccess` returns it). Zod validates dispatch inputs (≤25 props / ≤65535 chars), secret name regex, 48KB value cap.
- **Rate limits.** Reads cost 1 point, writes 5; SWR polling is bounded (post-dispatch window + only while `in_progress`); on 403/429 surface `github_rate_limited` and back off.

### Failure Modes

- **App lacks `actions`/`secrets`/`environments` permission (day-1 most likely).** Separate readiness check (`actions-manager/readiness.ts`) detects it via the App permission set and renders `ReadinessVerdict` `action-needed` with a re-authorize link — never let a write fail with a raw 403. `Environments:write` vs `Secrets:write` are distinct readiness lines.
- **`key_id` mismatch / cached key.** Always `GET` the public-key for the exact scope immediately before each `PUT`; never cache. Unit-test the `ORIGINAL` base64 variant explicitly.
- **`workflow_dispatch` 204 + default-branch requirement.** Pre-check default-branch presence; poll `runs?event=workflow_dispatch` + timestamp-match within a bounded post-dispatch window; if no run appears, toast "Dispatched — run may take a moment to appear" rather than a false error. Document the concurrent-dispatch race.
- **302 URL expiry (~1 min).** Server proxies and re-requests a fresh redirect every fetch; never persist or client-expose.
- **GitHub secondary rate limit.** Poll only within the bounded window / while `in_progress`, debounce, respect `retry-after`, surface `github_rate_limited`.
- **Cross-scope name shadowing (env > repo > org).** `FieldHelp` copy notes precedence; cross-scope shadow detection is out of v1.
- **libsodium async WASM init.** `await sodium.ready` at the top of every `encrypt.ts` call.
- **Best-effort token revocation.** Tokens expire naturally on outage; warning is the only signal — acceptable, matches existing broker behavior.

---

## Implementation Slices

Read/status before write; main path before advanced; one PR-sized slice each.

### CODE-01 — Read-only GitHub Actions dashboard (unify + migrate to installation token)

- **Goal:** Ship the inert, status-only Actions view behind a readiness gate: list workflows + runs with correct status dots, open a run detail `Sheet` with jobs and **raw server-proxied logs**. No mutations. Requires only `actions:read` + `metadata:read`.
- **In scope:** Extend `app.ts` permissions object; new `actions-manager/{workflows,runs,jobs,logs,errors,readiness}.ts`; read API routes; Actions tab page + run `Sheet` (raw-text log console); **migrate `fetchActionsSummary` off `getUserOctokit` onto `withScopedInstallationOctokit`**; **unify `DashboardErrorKind` Actions cases into `GithubActionsErrorKind`**; **new separate Actions/Secrets readiness check** (do not mutate the background-agents readiness set).
- **Out of scope:** Any mutation (re-run/cancel/dispatch); rich parsed log console (grouped steps, per-line timestamps, level filters, find-in-logs); secrets; webhooks; org scope.
- **Tests:** unit — installation-token reader returns mapped runs/statuses; `DashboardErrorKind`→`GithubActionsErrorKind` mapping is total and lossless; readiness check reports `app_no_actions_permission` when absent. contract — log route returns proxied raw text and never the signed `Location`. behavior — Actions tab renders run rows with correct `StatusPill` colors and an `action-needed` `ReadinessVerdict` when the App lacks `actions:read`.

### CODE-02 — Re-run, cancel, and `workflow_dispatch`

- **Goal:** Add write actions on the read-only dashboard: kebab Re-run all / Re-run failed / Cancel, and a "Run workflow" dispatch `Dialog` with ref + inputs and bounded poll-for-run. Gated behind `actions:write` readiness; audited via `emitSessionEvent`.
- **In scope:** `actions-manager/{runs,dispatch}.ts` write helpers; rerun/cancel/dispatch routes; `run-actions-menu.tsx`, `dispatch-dialog.tsx`; 204-no-run_id + bounded post-dispatch poll; default-branch precheck; audit events with `userId`/`requestId`/`sessionId`(synthetic)/`redactionStatus`.
- **Out of scope:** Secrets; org scope; webhooks; editing workflow YAML (`workflows` permission).
- **Tests:** unit — dispatch helper rejects non-default-branch workflow with `workflow_not_on_default_branch`; poll-for-run resolves the timestamp-matched run and times out gracefully. contract — rerun/cancel/dispatch routes require `actions:write` readiness and emit a redacted audit event with full correlation IDs. behavior — dispatching a workflow surfaces the new run within the bounded poll window without a manual refresh.

### CODE-03 — Secrets inventory + repository-scope create/update/delete (sealed-box)

- **Goal:** Secrets tab listing names + `updated_at` (no values) before write, plus repository-scope Add (libsodium sealed-box, server-side only, fresh public-key per write) and destructive Delete with `AlertDialog`. Establishes `encrypt.ts` + `scope-router.ts`.
- **In scope:** add `libsodium-wrappers` to `apps/web/package.json`; `secrets-manager/{encrypt,scope-router,repo-secrets}.ts`; secrets list / `PUT [name]` / `DELETE [name]` routes; Secrets tab page + `add-secret-dialog.tsx`; zod name/size validation; **disable request-body logging on secret routes**; redaction guard in `redaction.ts`; `secrets:read`/`secrets:write` readiness.
- **Out of scope:** environment scope (CODE-04); org scope (deferred); cross-scope shadow detection; value reveal (impossible by API).
- **Tests:** unit — `encrypt.ts` uses `base64_variants.ORIGINAL` and produces a value GitHub's reference vector accepts (explicit ORIGINAL-vs-URLSAFE assertion); name validator rejects `GITHUB_`-prefixed / digit-leading names; 48KB cap enforced. contract — list route returns names + metadata and never a value; secret routes emit redacted audit events with `secretName` (name only) and `redactionStatus`; no request-body logger captures the value. behavior — adding a repo secret shows it in the table with no value column; deleting prompts an `AlertDialog` naming the key.

### CODE-04 — Environment scope for Actions Secrets

- **Goal:** Extend the Secrets tab with a scope `ToggleGroup` (Repository / Environment) wired to environment secrets (`Environments:write` permission). **Organization scope is NOT included** (deferred per Open Decisions — feasibility + org-admin authority).
- **In scope:** `secrets-manager/environment-secrets.ts`; extend `scope-router.ts` for the environment public-key endpoint + permission; environment secret routes using a **catch-all `[...env]` segment** so GitHub-allowed slashed environment names round-trip (a single `[env]` segment silently breaks slashes); `scope-toggle.tsx`; `environments:read`/`environments:write` readiness line.
- **Out of scope:** organization scope and any org-wide token mint; visibility/selected-repo assignment; webhook live status.
- **Tests:** unit — `scope-router` maps `environment` to the correct public-key endpoint + `environments` permission; env-name catch-all route round-trips a slashed environment name. contract — env secret write fails with `app_no_environments_permission` when only `secrets:write` is granted (the distinct-permission gap). behavior — switching scope to Environment and selecting an environment lists that environment's secret names and lets the user add one.

---

## Epic Issue Body

> Paste into the GitHub epic issue (label: `epic`). Each slice gets its own feature ticket following the strict feature-ticket format, linking back here.

**Title:** Epic: GitHub Actions & Secrets Manager (repo-scoped)

**Summary.** Add a repo-scoped surface to view/operate GitHub Actions (workflows, runs, jobs, logs, re-run/cancel/dispatch) and manage Actions Secrets (names + metadata; create/update/delete via libsodium sealed-box; repository + environment scopes; org scope deferred) for repos covered by the user's existing GitHub App install. Standardizes on the scoped installation token, reuses `ReadinessVerdict` + `SettingsSection`, persists no secret values, and adds no new DB table in v1 (audit via `sessionEvents`).

**Why this matters.** Closes the loop between "agent opened a PR" and "did CI pass / does the repo have the secrets CI needs," without leaving the product. Natural companion to the dev → prod env/secrets epic; GitHub's value-never-returned Secrets API embodies the "names + status only" philosophy.

**User/operator path protected.** Install present → open Actions tab → see correct run statuses, re-run a failed run → open Secrets tab → see secret names + updated_at (never values) → create a repo secret that GitHub accepts. No plaintext value, App token, decrypted value, or signed 302 URL ever in the client/response/logs.

**Scope.** In: read dashboard, run mutations, repo + environment secret CRUD, readiness gating, redacted audit. Out: editing workflow YAML (`workflows` permission), organization-scope secrets, webhook live status, cross-scope shadow detection, value reveal.

**Slices.** CODE-01 read-only dashboard (unify + migrate to installation token) → CODE-02 run mutations → CODE-03 repo secrets (sealed-box) → CODE-04 environment scope.

**Labels.** `epic`, `type:feature`, `enhancement`, `ux-improvement`, `status:grooming`.

**Definition of done (epic-level).** All four slice PRs merged into `develop` with dev-deploy verification; readiness gating proven on a real install; sealed-box write accepted by GitHub; redaction/no-value audit verified; `bun --bun run ci` green on each slice.

---

## Open Decisions (with recommended answers)

- **Where does this surface live — global settings or repo-scoped tab?** → **Repo-scoped tabs under `/repos/[owner]/[repo]/` (Actions + Secrets).** Actions and Secrets are inherently per-repo; repo-scoped dynamic routing already exists. Do NOT touch `SETTINGS_NAV_GROUPS`.
- **Auth identity for reads — user OAuth token or scoped installation token?** → **Scoped installation token for both reads and writes.** Consistent with the secrets write path and the SECURITY claims; one rate-limit bucket and audit actor. CODE-01 migrates the existing `fetchActionsSummary` reader off `getUserOctokit`.
- **Live status via webhooks or SWR polling?** → **SWR polling for v1** (bounded post-dispatch window + `refreshInterval ~5s only while in_progress`). Webhooks need an App event-subscription change + snapshot table + dedup; `workflow_job` `steps[]` is unreliable. Defer to an optional later slice.
- **How wide is the App permission upgrade at launch?** → **Two-phase.** Phase 1 read-only (`actions:read`, `secrets:read`, `environments:read`) so the inventory/status surface is live and inert behind a readiness gate before users re-authorize. Phase 2 adds write levels. **Exclude the `workflows` permission (YAML editing)** entirely.
- **New DB table?** → **No table for v1.** GitHub is source of truth; `sessionEvents` is the audit ledger with a synthetic `sessionId`. Introduce `githubWorkflowRunSnapshots` only if/when webhook real-time status becomes a requirement.
- **Org-scope secrets in v1?** → **Defer entirely; NOT in v1 slices.** Org secrets require minting an installation token without `repository_ids` (widened blast radius, breaks the single-repo invariant) AND an explicit **org-admin authority check on the USER** (`verifyRepoAccess` gives no such signal). CODE-04 covers **environment** scope only; org scope is a separately-justified future slice. (This is the canonical resolution of the prior contradiction between the slice plan and the decisions list.)
- **Log viewer richness in v1?** → **Raw text passthrough only.** GitHub raw logs are not pre-grouped into steps with per-line levels; the grouped/leveled/find-in-logs console requires parsing and is a later slice.
- **Run-status visual dialect?** → **Dedicated run-status→color map via the existing `StatusPill`,** NOT the 4-value `ReadinessVerdict` taxonomy (workflow lifecycle states don't map cleanly). `ReadinessVerdict` is reserved for permission/secret-presence health.

---

## Rollout + Rollback

**Rollout.**

1. **Permission upgrade, read-only first.** Add `actions:read` + `secrets:read` + `environments:read` to the GitHub App. Land CODE-01 behind the new Actions/Secrets readiness gate; for installs that haven't re-authorized, the surface renders `action-needed` and never calls a missing endpoint. This makes the inventory/status view safe to ship before any write permission exists.
2. **Slice order:** CODE-01 → CODE-02 → CODE-03 → CODE-04, each a feature PR into `develop`, dev-deploy verified, then promoted via the release PR `develop → main`.
3. **Write permission, phase 2.** Add `actions:write` / `secrets:write` / `environments:write` ahead of CODE-02 / CODE-03 / CODE-04 respectively; the per-slice readiness check keeps each write inert until the matching permission is present.
4. **Migration.** No DB migration in v1. Verify `db:generate` produces no diff for these slices (confirming no schema change crept in).
5. **Dependency.** CODE-03 adds `libsodium-wrappers`; verify lockfile and build under Bun.

**Rollback.**

- **Per slice:** revert the feature PR. Because GitHub is the source of truth and there is no schema change, reverting code fully removes the surface — no data migration to unwind, no orphaned rows (audit events in `sessionEvents` are harmless historical records).
- **Permission-level:** the App permissions can be left in place even after a code revert (extra unused permissions are benign) or narrowed back via the App settings; the readiness gate means a code-present/permission-absent state degrades to `action-needed`, not an error.
- **Hard kill:** hide the Actions/Secrets tabs behind a feature flag check on the repo surface so the surface can be disabled without a deploy if a rate-limit or redaction incident is suspected; secrets routes additionally fail closed (no write attempted) when readiness is not `ready`.

## Tracked Slice Issues

- [ ] #269 — feat: read-only GitHub Actions dashboard (workflows, runs, jobs, logs) on the repo surface
- [ ] #270 — feat: re-run, cancel, and workflow_dispatch for GitHub Actions runs
- [ ] #271 — feat: Actions Secrets inventory + repository-scope create/update/delete (sealed-box)
- [ ] #272 — feat: environment and organization scope for Actions Secrets
