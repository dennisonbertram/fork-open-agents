<!-- TITLE: feat: event-driven agents — source-agnostic verify→normalize→match→dispatch pipeline (wake an agent on event X) -->

## Why this matters

Today the product reacts to exactly one external world: GitHub. `apps/web/app/api/github/webhook/route.ts` verifies an HMAC-SHA256 signature, parses by `x-github-event`, and either archives linked sessions (`handlePullRequestWebhook`) or dispatches a background run (`dispatchBackgroundTriggerEvent`). The partial generalization in `apps/web/lib/background-agents/` is still **GitHub-only and repo-centric**: the lone normalizer (`github-events.ts`) only understands GitHub payloads, every `NormalizedBackgroundTriggerEvent` *requires* a `repoOwner`/`repoName`, and the only verifier is GitHub's `sha256=<hex>` scheme.

That means an agent can react to a GitHub PR but **cannot** react to the failed deploy that PR caused, the Sentry error it triggered, or the customer email reporting it. The pain is felt by teams who want their repo agent wired into their real incident/support loop (deploy fails → agent investigates → opens a fix PR; bug-report email → agent triages and files an issue). The gap is structural, not cosmetic: a single hard-coded verifier would silently reject three of four real external sources.

The POC (PR #85, branch `poc/2c-event-driven`) proved the next step end to end — a source-agnostic `AgentEvent` model, a per-source verifier+normalizer registry covering three distinct HMAC schemes plus a bearer escape hatch, a payload-shape-agnostic rule engine, and the existing GitHub PR-close behavior reproduced as **one data-defined rule** to prove generalization is additive, not a rewrite. 53/53 assertions pass, including fan-out, redelivery dedup, bad-signature rejection, and PR-close no-regression. This issue describes productizing that proof.

## User/operator path protected

- **Operator path:** registering an event source (kind + signing secret + copyable webhook URL) and rotating its secret, on a new **Event Sources** admin surface.
- **User path:** defining a trigger rule "when source=X and type=Y [and match conditions] → run prompt P against repo R" on a new **Triggers** settings surface, and seeing the resulting agent run appear automatically.
- **Existing protected path (must not regress):** the live GitHub App webhook at `/api/github/webhook` — both the `pull_request.closed` session-archive behavior and the `issues`/`deployment_status` → background-run dispatch — must keep working unchanged once it routes through the generalized pipeline.
- **Delivery-log path:** the per-source delivery log that shows verify pass/fail, matched rule(s), the dispatched run, and deduped redeliveries.

## Behavior contract

- **Given** a registered GitHub source with the correct secret, **when** a real-shaped `issues.opened` payload arrives correctly signed with `x-hub-signature-256: sha256=<hex>` and matches an enabled rule, **then** the pipeline verifies it, normalizes it to a canonical `AgentEvent`, matches exactly the intended rule, renders the prompt from event fields (`{{subject}}`, `{{actor}}`, `{{metadata.*}}`), and dispatches **exactly one** run.
- **Given** a registered source, **when** a payload arrives with a signature computed under the wrong secret, **then** the request is **rejected (401)** and **no** run is dispatched.
- **Given** a verified event already dispatched, **when** the identical payload is redelivered (providers retry), **then** it still verifies and still matches but dispatches **zero new** runs (deduped on the idempotency key `rule:source:type:externalId`).
- **Given** an inbound email whose subject contains "Bug", **when** it matches both `email-support-triage` and `email-bug-report`, **then** the pipeline fans out to **two** distinct runs with the correct rule set and distinct rendered prompts.
- **Given** a verified `github.issues.closed` event with no matching rule, **when** it is ingested, **then** it normalizes cleanly but dispatches **zero** runs (no-rule → no-op).
- **Given** a real `pull_request.closed` (merged) GitHub event, **when** ingested through the generalized pipeline as the single `github-pr-close-archive` rule, **then** it derives `prStatus = "merged"` identically to the original `handlePullRequestWebhook` and dispatches exactly one run carrying the PR number and status (PR-close parity).
- **Given** an inbound request whose headers match no registered source, **when** ingested, **then** the response is **400 (unknown_source)** and no run is dispatched.
- **Given** a registered generic bearer source, **when** the `authorization: Bearer <secret>` token is wrong, **then** the request is **rejected (401)** with no dispatch.

## Product and design spec

### UX — how users use it & how it's exposed

- A new **Triggers** section in settings/nav lists trigger rules, each with an **enable/disable** switch, a one-line "When [source] [type] [match summary] → run agent on [repo]" summary, and a last-fired timestamp.
- A **"New trigger"** builder is a *When / Then* form:
  - *When* block: source dropdown → event-type dropdown (supporting wildcards like `source.*`) → optional condition rows (field path · matcher `equals|in|prefix|contains` · value).
  - *Then* block: target repo picker (optional — email/Sentry events have no repo), a prompt-template editor with an insert-field menu exposing available `{{subject}}`, `{{actor}}`, `{{metadata.x}}` keys, and a **live preview** rendered from a sample payload for that source.
- A new operator **Event Sources** admin screen lets an operator register a source `kind` (`github | agentmail | vercel-deploy | sentry | generic`), paste/rotate its signing secret, and copy the per-source webhook URL to paste into GitHub/Vercel/Sentry/AgentMail. Secrets are stored by reference (`secretRef`), never echoed back in plaintext after creation; rotation issues a new secret and invalidates the old one.
- **Secret provisioning per source:** GitHub reuses the existing GitHub App webhook secret (the `/api/github/webhook` alias keeps the current URL working); inbound email is provisioned by registering an AgentMail webhook (`client.webhooks.create({ url, eventTypes: ["message.received"] })`) pointed at `/api/events/agentmail` and storing the returned signing secret; Vercel/Sentry secrets are pasted from their respective webhook settings. (Vercel/Sentry are deferred to a follow-up — see Out of scope.)

### UX — how the feature demonstrates & explains its value to the user

- The "aha" moment is in-the-moment and unattended: a GitHub issue opens (or a bug-report email arrives) and, **without the user doing anything**, a new agent session appears already working — for a coding repo, with a draft fix PR in flight. The delivery log row links straight to that run, so the cause→effect is visible.
- The **empty/first-run state** of the Triggers list explains the value and the next step: a short "Wake an agent when something happens in your stack" explainer plus a primary **"Add your first trigger"** CTA and a couple of example rules (issue opened → triage; deploy failed → investigate). The Event Sources screen's empty state explains that a source must be registered before a trigger can fire and links to the source-registration flow.
- The rule builder's **live prompt preview** makes value concrete before saving: the user sees exactly what prompt the agent will receive, rendered against a sample payload, so the automation is legible rather than magical.

### UX — how it's clear what the feature is doing (states & feedback)

Every state is surfaced explicitly:

- **Trigger enabled / disabled** — switch state on the Triggers list; disabled rules never match.
- **Event received** — appears in the per-source delivery log as a new row (source, type, externalId, timestamp).
- **Verified** — green verify badge on the row.
- **Rejected (bad signature / wrong bearer)** — red verify badge labeled `signature invalid`; counts toward the per-source **verification-failure-rate** health indicator on Event Sources (critical because a misconfigured/rotated secret is indistinguishable from an attacker — both 401).
- **Matched / no-rule** — the row shows matched rule name(s), or "no rule matched (no-op)" when verified but unmatched.
- **Dispatched run pending → running → done** — the matched row links to the run whose status reflects the live workflow state.
- **Dedup-skipped** — a redelivered event renders a row clearly marked "deduped (0 new runs)".
- **Fan-out** — one event matching multiple rules renders multiple matched-rule chips and multiple run links on the same event.

### UX — how to test the UX, including regressions

- **Authenticated-local-UI smoke (Triggers + Event Sources):** follow the repo's [Authenticated Local UI Smoke](../../docs/process/development-workflow.md#authenticated-local-ui-smoke). With `POSTGRES_URL` + `BETTER_AUTH_SECRET` present and `bun run --cwd apps/web db:migrate:apply` applied, sign in, open **Event Sources**, register a `github` source, then open **Triggers → New trigger**, build a "when `github` `issues.opened` → run prompt against repo R" rule, confirm the live preview renders the prompt, save, and assert the rule appears **enabled** in the list. Drive enable→disable and assert the switch persists across reload.
- **Webhook-delivery smoke:** POST a signed, real-shaped `issues.opened` fixture to `/api/events/github`; assert HTTP 200, a delivery-log row with a **green verify** badge, the matched rule name, and a linked **pending/running** run. POST the same payload again; assert a "deduped (0 new runs)" row and that no new run was created. POST a wrong-secret payload; assert HTTP 401, a **red `signature invalid`** badge, and no run.
- **Interactions to drive:** register source; create rule; toggle enable/disable; send good/bad/duplicate deliveries; trigger fan-out via an email subject containing "Bug" and assert two run links.
- **Assertions:** rule persisted + enabled; verify badge color matches outcome; exactly-one run on first delivery; zero new runs on redelivery; two runs on fan-out; 401 + no run on bad signature; verification-failure-rate increments on rejection.
- **UX regressions to lock down (fail-before / pass-after):**
  - **GitHub PR-close parity (critical):** the existing `pull_request.closed` (merged) behavior — session archive + run dispatch with `prStatus = "merged"` — must keep working once it routes through the generalized pipeline as the `github-pr-close-archive` rule. Add a failing test asserting parity **before** the refactor; it must pass after.
  - The `/api/github/webhook` alias must continue accepting the live GitHub App URL with the current secret (no URL/secret change for existing installs).
  - Disabled rules never dispatch; no-rule events never dispatch; redeliveries never double-dispatch.

## Integration spec

Generalize, do not rewrite — the production seam already exists.

- **Generalize the ingest route.** Factor the HMAC-verify + parse + dispatch logic out of `apps/web/app/api/github/webhook/route.ts` into a source-agnostic `IngestPipeline` (`apps/web/lib/event-agents/ingest.ts`): `resolveSource(headers)` → `verify(rawBody, secret)` → `JSON.parse` → `normalize(parsed) → AgentEvent[]` → `matchEvent(rules) → AgentRunIntent[]` → dedup → dispatch. Verification reads `await req.text()` **before** `JSON.parse`, preserving the current raw-body discipline.
- **Per-source verifier/normalizer registry.** Add `apps/web/lib/event-agents/sources/` with one module per source implementing the `EventSource` contract (`matchesInbound` / `verify` / `normalize`): `github.ts` (folds in `apps/web/lib/background-agents/github-events.ts`, reproducing the `merged ? "merged" : "closed"` `prStatus` derivation), `agentmail.ts`, `vercel-deploy.ts` (SHA1), `sentry.ts`, `generic.ts` (bearer), plus an `index.ts` registry + `resolveSource` header router and a `verify.ts` with constant-time compare + `hmacHex` helpers.
- **Canonical model + rule engine.** Add the `AgentEvent { source, type, externalId, repo?, actor?, subject, body, metadata, occurredAt? }` type and the `rule-engine.ts` (dotted-key field access, `equals/in/prefix/contains` matchers, `source.*` wildcards, `{{field}}` templating) + `dispatcher.ts` under `apps/web/lib/event-agents/`. The canonical `AgentEvent` subsumes the existing repo-mandatory `NormalizedBackgroundTriggerEvent` by making `repo` optional; GitHub still populates it.
- **New schema (`apps/web/lib/db/schema.ts`).** Add `eventSources` (`{ id, ownerUserId, kind, secretRef, config jsonb }`) and `triggerRules` (`{ id, ownerUserId, enabled, whenSource, whenType, match jsonb, agentId/targetRepo, promptTemplate }`), generalizing today's repo-centric `backgroundAgentTriggers.conditions` (`backgroundAgentTriggers` at `schema.ts:854`; `BackgroundAgentTriggerConditions` in `apps/web/lib/background-agents/types.ts`) into a payload-agnostic jsonb `match`. Back the idempotency key with a **unique index** so dedup holds across instances and the table stays bounded.
- **Ingest endpoint.** Add `apps/web/app/api/events/[source]/route.ts` backed by `IngestPipeline`. Keep `/api/github/webhook` as a **thin alias** that calls the same pipeline so the existing GitHub App webhook URL keeps working.
- **Dispatch wiring (reuse the production seam).** The `RunAgent` seam wires to the **same** materialization GitHub already uses: `dispatchBackgroundTriggerEvent` (`apps/web/lib/background-agents/dispatcher.ts:70`) → `start(runBackgroundAgentWorkflow)` (`dispatcher.ts:41`), the trigger-mode analogue of `apps/web/app/workflows/chat.ts`'s interactive materialization. The idempotency key mirrors `buildBackgroundRunIdempotencyKey` (`apps/web/lib/background-agents/types.ts`).
- **Hard dependency on POC 2b durability.** Dispatch must enqueue into 2b's durable workflow/job queue so a triggered run **survives sandbox teardown / serverless restart** — exactly as production's `dispatcher.ts` calls `start(runBackgroundAgentWorkflow)`. The idempotency key is the reconciliation hook 2b needs. Until 2b lands, a crash between "intent created" and "run started" loses the wake-up.

## In scope

- Source-agnostic `IngestPipeline` factored out of the GitHub route, with `await req.text()` raw-body verification preserved.
- Per-source verifier/normalizer registry under `apps/web/lib/event-agents/sources/` for **GitHub** and **AgentMail (inbound email)** (the narrow launch set), plus the canonical `AgentEvent`, rule engine, dispatcher, and `generic` bearer escape hatch.
- `eventSources` + `triggerRules` tables (+ generated migration) with a unique index on the idempotency key.
- `apps/web/app/api/events/[source]/route.ts` ingest endpoint; `/api/github/webhook` kept as a thin alias.
- Folding `background-agents/github-events.ts` into `sources/github.ts` and reproducing the PR-close behavior as the single `github-pr-close-archive` rule (proven no-regression).
- Triggers settings surface (list + rule builder with live preview), Event Sources admin (register/rotate + verification-health), and per-source delivery log with all states.
- Dispatch wired through `dispatchBackgroundTriggerEvent → start(runBackgroundAgentWorkflow)` and enqueued into POC 2b's durable queue.
- Feature flag gating the new surfaces and route.
- Observability (`event-agents` service), regression harness, and authenticated-local-UI + webhook-delivery smokes.

## Out of scope

- **POC 2b durability is a required dependency, not built here.** This issue ships **after** 2b's durable runtime is adopted; without it a woken run can be lost on teardown. Do not mark the runtime path proven until it enqueues into 2b's durable queue (see [Managed Runtime Proof Standard](../../docs/process/managed-runtime-proof-standard.md)).
- **Start narrow:** launch with **GitHub issues.opened + inbound email** only. **Sentry and Vercel-deploy sources are deferred to a follow-up** issue (their verifiers/normalizers exist in the POC but their live signature schemes must be confirmed against real deliveries first).
- Unattended-run safety controls beyond the basics — rate limits, per-account spend caps, and a dry-run/review-only mode — are acknowledged as needed but tracked separately.
- Multi-tenant secret management hardening (KMS/secret-manager integration) beyond `secretRef` storage + rotation UX.
- Bulk import/migration of existing `backgroundAgentTriggers` rows into `triggerRules` (existing GitHub triggers keep working via the alias; a migration is a later task).

## Research and context sources

- **PR #85** — POC 2c: Event-driven agents (branch `poc/2c-event-driven`): https://github.com/dennisonbertram/fork-open-agents/pull/85
- **POC folder** `POC/2c-event-driven/` — `README.md` (pipeline, integration plan, blind spots, remaining risks) and `PRODUCT-BRIEF.md` (value, case for/against, decision: build later, start narrow). Both live on branch `poc/2c-event-driven`.
- **Eval evidence** — `POC/2c-event-driven/evidence/eval-log.txt` (53/53 PASS) and `evidence/dispatch-decisions.json` (per-event normalized `AgentEvent` + dispatch decisions: matched rule, rendered prompt, idempotency key, runId, plus a `_summary` of all 6 dispatched runs).
- **Real codebase seams** — `apps/web/app/api/github/webhook/route.ts` (HMAC verify + dispatch), `apps/web/lib/background-agents/{dispatcher.ts,github-events.ts,types.ts}`, `apps/web/lib/db/schema.ts` (`backgroundAgentTriggers`), `apps/web/app/workflows/chat.ts`.
- **External research (from README)** — inbound email via **AgentMail / Resend** webhook (`message.received`, `x-agentmail-signature` bare-hex SHA256); **Vercel deploy** webhook security (`x-vercel-signature`, HMAC-**SHA1** over raw body); **Sentry** issue-alert webhook (`sentry-hook-signature`, HMAC-SHA256 under a different header). Vercel/Sentry schemes are doc-derived and flagged "confirm against a live delivery."

## Agent todo checklist

- [ ] Confirm POC 2b durable runtime is adopted; identify the durable-enqueue entry point dispatch will call.
- [ ] Write the failing per-source verify→normalize→match→dispatch tests (GitHub + AgentMail) and the GitHub PR-close-parity test; confirm red.
- [ ] Add `eventSources` + `triggerRules` to `schema.ts` with a unique index on the idempotency key; run `bun run --cwd apps/web db:generate`; commit the `.sql`.
- [ ] Create `apps/web/lib/event-agents/` with `types.ts` (`AgentEvent`), `sources/` (github, agentmail, generic, verify, index), `rule-engine.ts`, `dispatcher.ts`, `ingest.ts`.
- [ ] Fold `background-agents/github-events.ts` into `sources/github.ts`, reproducing `prStatus` derivation; express PR-close as the `github-pr-close-archive` rule.
- [ ] Add `apps/web/app/api/events/[source]/route.ts`; rewrite `/api/github/webhook` as a thin alias over the same pipeline.
- [ ] Wire `RunAgent` → `dispatchBackgroundTriggerEvent → start(runBackgroundAgentWorkflow)` and enqueue into 2b's durable queue; persist dedup via the unique index.
- [ ] Build Triggers list + rule builder (live preview), Event Sources admin (register/rotate + verification-health), and the per-source delivery log with all states.
- [ ] Add the `event-agents` named service with structured events, typed error kinds, correlation IDs, and redaction.
- [ ] Add a feature flag gating new surfaces + route.
- [ ] Run authenticated-local-UI smoke (Triggers + Event Sources) and the webhook-delivery smoke; capture evidence.
- [ ] Run targeted tests, adjacent background-agents suite, `git diff --check`, and `bun --bun run ci`.
- [ ] Update docs (architecture, lessons-learned if applicable); attach observability evidence.

## Tests to add first

- **Per-source pipeline tests (GitHub):** signed real-shaped `issues.opened` fixture → verifies, normalizes to the right `AgentEvent`, matches the intended rule, dispatches exactly one run with a prompt rendered from event fields. Wrong-secret variant → 401, zero dispatch. Redelivery variant → zero new runs.
- **Per-source pipeline tests (AgentMail):** signed (`x-agentmail-signature` bare-hex SHA256) `message.received` fixture → normalizes (`Name <addr>` → bare address), matches; the "Bug" subject case fans out to two rules → two distinct dispatches with distinct prompts.
- **GitHub PR-close parity test (critical regression):** real `pull_request.closed` (merged) fixture through the generalized pipeline as `github-pr-close-archive` → derives `prStatus = "merged"` identically to the original `handlePullRequestWebhook`, archives the linked session, and dispatches exactly one run carrying PR number + status. This test must **fail before** the refactor (asserting the new pipeline path) and pass after.
- **Routing/auth edge tests:** unrecognized headers → 400 (`unknown_source`); wrong generic bearer → 401; verified `github.issues.closed` with no rule → zero dispatch.
- **Dedup persistence test:** the unique index on the idempotency key rejects a duplicate insert so a second delivery dispatches zero new runs across instances (not just an in-memory `Set`).

## Observability and user feedback

- **User-visible status:** the delivery log shows per-event verify pass/fail, matched rule(s), dispatched run + live status, and deduped redeliveries; Event Sources shows a per-source **verification-failure-rate** health indicator.
- **Named service:** `event-agents`, emitting **structured** events (action-name, level, fields: `source`, `eventType`, `ruleId`, `dispatched` bool, `dedupKey`). Action names e.g. `event-agents.source.resolved`, `event-agents.verify.result`, `event-agents.rule.matched`, `event-agents.run.dispatched`, `event-agents.run.deduped`.
- **Typed error kinds:** `signature_invalid`, `unknown_source`, `no_rule_match`, `dispatch_failed` (and `normalize_empty` for fail-closed normalizer drift).
- **Correlation IDs on every event:** `userId`, `sessionId`, `chatId`, `requestId`, `triggerId`/`ruleId`, and `eventDeliveryId`.
- **Redaction (hard rule):** never log raw payloads, signing secrets, bearer tokens, or email bodies. Log shapes/IDs/derived fields only; redact `secretRef`/secret values; truncate or omit `subject`/`body` per existing `background-agents/redaction.ts` conventions.
- **Grep-able debug recipes:** `service=event-agents action=event-agents.verify.result kind=signature_invalid` (auth failures per source); `action=event-agents.run.deduped` (redelivery noise); `action=event-agents.run.dispatched dispatched=true ruleId=<id>` (confirm a rule fired); `kind=normalize_empty source=<src>` (provider payload drift).
- **Screenshot / evidence expectation:** capture the per-source normalized JSON + dispatch decisions exactly as the POC's `evidence/dispatch-decisions.json` does (matched rule, rendered prompt, idempotency key, runId per case) and reference the 53/53 eval (`evidence/eval-log.txt`) as the feasibility baseline; add authenticated-local-UI + webhook-delivery smoke screenshots showing verified/matched/dispatched and deduped rows.

## Regression harness plan

- **New tests:** per-source verify+normalize+match+dispatch suites for **GitHub** and **AgentMail**, plus the **GitHub PR-close parity** test (archive + `prStatus = "merged"` + single run), routing/auth edge tests (unknown source 400, wrong bearer 401, no-rule no-op), and the dedup-persistence test backed by the unique index.
- **Fixtures:** signed, real-shaped payloads per source, each signed with its **true** scheme (GitHub `sha256=<hex>`, AgentMail bare-hex SHA256, generic bearer), derived from the POC's `POC/2c-event-driven/fixtures/*.json`.
- **Fail-before / pass-after:** the parity test and per-source tests assert the new pipeline path and must be **red before** the refactor and **green after**; the dedup test must fail against an in-memory-only store and pass against the unique index.
- **Limits (explicit):** live signature specifics for **Vercel (SHA1)** and **Sentry (different header)** must be confirmed against **real deliveries** before those sources ship — the harness uses doc-derived schemes for them and so cannot certify them; and the harness will **not** catch provider payload drift (shape changes) — normalizers fail closed (return `[]`) and emit a `normalize_empty` observability event so drift is visible rather than silently dropping events.

## TDD audit trail

- **Planned red commit:** add the failing per-source pipeline tests (GitHub + AgentMail) and the GitHub PR-close-parity test before any pipeline code.
  - Command: `bun test apps/web/lib/event-agents/ apps/web/lib/background-agents/dispatcher.test.ts`
  - Expected failing output: module-not-found / unimplemented for `apps/web/lib/event-agents/*`, and the PR-close-parity assertion failing because `pull_request.closed` does not yet route through the generalized pipeline (`prStatus`/single-run assertions unmet).
  - Commit the red state (or document an explicit exception per repo policy).
- **Planned green commit:** implement `types.ts`, `sources/*`, `rule-engine.ts`, `dispatcher.ts`, `ingest.ts`, the route + alias, schema + migration, and the dispatch wiring until the above suites pass; commit green. Follow with adjacent-suite + `git diff --check` + `bun --bun run ci`.

## Regression risks and concerns

- **PR-close parity (highest risk):** refactoring the GitHub route into the generalized pipeline could subtly change archive behavior or `prStatus` derivation. Mitigated by the dedicated fail-before/pass-after parity test and keeping `/api/github/webhook` as a thin alias.
- **Durability gap if 2b is incomplete:** a crash between intent and run loses the wake-up. Mitigated by gating on 2b and enqueuing into its durable queue; the idempotency key is the reconciliation hook.
- **Dedup correctness across instances:** an in-memory `Set` (as in the POC eval) is not durable. Mitigated by a unique index on the idempotency key (or a TTL'd store) so dedup holds across instances and stays bounded.
- **Secret misconfiguration looks like an attack:** a rotated/wrong secret and a real attacker both produce 401. Mitigated by per-source verification-failure-rate observability and a clear `signature invalid` UI state.
- **Provider payload/signature drift:** normalizers can break when providers change shapes; Vercel/Sentry schemes are doc-derived. Mitigated by fail-closed normalizers (`[]` + `normalize_empty` event) and deferring Vercel/Sentry until confirmed against live deliveries.
- **Unattended-run amplification:** auto-opening PRs on every event can amplify an incident or loop. Acknowledged; rate limits / spend caps / dry-run are tracked out of scope but must not be forgotten before broad enablement (feature flag stays narrow until then).

## Deploy or migration impact

- **Migration:** new `eventSources` + `triggerRules` tables via `bun run --cwd apps/web db:generate`; commit the generated `.sql`. Migrations run automatically during `bun run build` on every Vercel deploy (preview gets an isolated Neon branch). Include the unique index on the idempotency key.
- **Secret provisioning/rotation:** per-source secrets stored by `secretRef`; GitHub reuses the existing GitHub App webhook secret; AgentMail secret captured at webhook registration. Rotation UX issues a new secret and invalidates the old; document the operator runbook.
- **Routes:** add `/api/events/[source]`; keep `/api/github/webhook` as a thin alias over the same pipeline so the live GitHub App URL and secret are unchanged (no install-side reconfiguration, no regression).
- **Feature flag:** gate the Triggers/Event-Sources/delivery-log surfaces and the `/api/events/[source]` route; launch narrow (GitHub + email) with the flag off by default until verification-health observability and unattended-run guardrails are in place.
- **Sequencing:** ship only after POC 2b's durable runtime is adopted.

## Definition of done

- [ ] Red test written first: failing per-source pipeline (GitHub + AgentMail) and GitHub PR-close-parity tests added before implementation.
- [ ] Behavior proof red before implementation: the failing state is observed and recorded.
- [ ] Red-test commit created (or a documented exception per repo policy).
- [ ] Green commit after red: implementation makes the targeted tests pass.
- [ ] Targeted tests pass (`bun test apps/web/lib/event-agents/`).
- [ ] Adjacent suite passes (`apps/web/lib/background-agents/`, including `dispatcher.test.ts`).
- [ ] `git diff --check` is clean.
- [ ] `bun --bun run ci` passes (format, lint, typecheck, tests).
- [ ] Regression harness implemented, **including GitHub PR-close parity** (archive + `prStatus = "merged"` + single run) and dedup-persistence via the unique index.
- [ ] Docs updated (architecture and, if applicable, lessons-learned); `/api/github/webhook` alias behavior documented.
- [ ] Observability evidence captured: `event-agents` structured events, typed error kinds, correlation IDs, redaction verified, per-source normalized JSON + dispatch decisions, and the 53/53 eval referenced; authenticated-local-UI + webhook-delivery smoke evidence attached.
- [ ] Deploy/migration notes included: `eventSources` + `triggerRules` migration, per-source secret provisioning/rotation, `/api/events/[source]` route, feature flag, and the GitHub-alias no-regression note.
