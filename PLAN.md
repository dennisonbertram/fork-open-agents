Title: feat: Add user-owned inference profiles for Anthropic model routing

Labels: type:feature

Issue type: Epic plan with PR-sized feature slices

## Current Implementation Slice

Summary: implement the first manual-testable user/project override path by
adding user-owned Anthropic inference profiles, routing selected chats through a
direct Anthropic-compatible provider, and showing user-backed model options in
the existing chat model picker.

Context:

- `chats.model_id` is the current source of truth for the catalog model.
- `packages/agent/models.ts` builds Vercel AI Gateway models by default.
- `apps/web/app/workflows/chat.ts` resolves chat model settings immediately
  before the agent run, which is the right server-only boundary for decrypting
  profile keys.
- Settings already has a Models page and model variant management pattern that
  can host inference profile CRUD without adding a new settings area.
- The provided Anthropic-compatible URL requires the direct Anthropic provider
  path, normalized to a `/v1` base URL; Vercel AI Gateway custom config did not
  accept it.

System Impact:

- The built-in route remains Vercel AI Gateway when no profile is selected.
- User-owned direct Anthropic credentials become a separate source of truth in
  `inference_profiles`; only encrypted key material is persisted.
- `chats.inference_profile_id` records the per-chat routing override separately
  from the model id, so duplicate model labels can coexist as `User` and
  provider catalog choices.
- `sessions.inference_profile_id` and
  `user_preferences.default_inference_profile_id` provide the project/session
  default path for new chats without forcing environment variables.
- Workflow and usage attribution record whether a run used the Gateway route or
  a user profile before model invocation.

Approach:

- Implement direct Anthropic profiles first, because it gives strict key and
  base URL control and avoids Gateway BYOK fallback/credit ambiguity.
- Keep profile resolution server-only. The browser only receives safe
  descriptors: profile id, display name, provider, base URL, key last4, status,
  and test summary.
- Build user-backed picker entries from available Anthropic catalog models plus
  enabled user profiles. The option id encodes the profile id for the UI, then
  API writes split it back into `modelId` and `inferenceProfileId`.

Changes:

- `apps/web/lib/db/schema.ts` - add `inference_profiles`,
  chat/session/default profile columns, and safe attribution columns.
- `apps/web/lib/inference/*` - add profile schemas, encryption, URL/model id
  normalization, option id helpers, and server-only resolution.
- `apps/web/lib/db/inference-profiles.ts` - add owned CRUD helpers with
  encryption/decryption and safe descriptor mapping.
- `apps/web/app/api/inference-profiles/*` - add profile CRUD and test routes.
- `packages/agent/models.ts` and `packages/agent/open-agent.ts` - add direct
  Anthropic model creation while preserving Gateway defaults.
- `apps/web/app/workflows/chat.ts` and `chat-post-finish.ts` - resolve profile
  routes, expose user-facing setup errors, and record attribution.
- `apps/web/lib/model-options.ts`, model picker components, hooks, and session
  chat context - add `User` model options and persist selected profile ids.
- `apps/web/app/settings/models/page.tsx` - show an Inference Profiles section.

Verification:

- Unit tests for encryption, Anthropic URL/model id normalization, profile
  resolver, model option grouping, and chat PATCH profile updates.
- Route tests for profile CRUD/test behavior with redacted failures.
- `bun run --cwd apps/web db:generate`, `bun --bun run check`, targeted tests,
  and `bun --bun run ci` when feasible.
- Manual smoke: create an Anthropic profile with the provided key and custom
  URL, test it, select `User -> Haiku/Opus` in a chat, send a trivial prompt,
  and confirm the run completes without exposing key material.

## Issue Sizing Review

This is epic-sized, not a single feature slice. Use this file as the planning
epic, then open separate feature-slice issues before implementation. Each slice
should use `.github/ISSUE_TEMPLATE/feature-slice.yml`, name the protected path,
define the red test first, and carry its own verification evidence.

Recommended slices:

- Slice 1: Profile foundation and secret storage.
  - Add `inference_profiles`, encrypted key storage, profile CRUD, ownership
    enforcement, redaction, safe descriptors, and profile test plumbing.
  - Add model discovery/mapping helpers for Anthropic direct ids.
- Slice 2: Runtime routing and attribution.
  - Extend model selection types, add the server-only profile resolver, create
    direct Anthropic model instances, preserve Gateway defaults, and write safe
    workflow/usage attribution before model invocation.
- Slice 3: Settings and chat picker UX.
  - Add Settings -> Models profile management, chat/session profile selection,
    the `User` picker group above provider groups, duplicate model search
    results, and Agent Browser smoke evidence.
- Slice 4: Follow-up routes and policy.
  - Evaluate Vercel AI Gateway BYOK, team/shared profiles, budgets, spend
    limits, and admin policy only after direct Anthropic is proven.

## Why This Matters

Users need a visible, product-level way to choose who pays for model calls. The
current app defaults to Vercel AI Gateway, which is good for the hosted product,
but it does not let a user bring a personal or client-paid Anthropic key for a
specific project, session, or chat.

The protected outcome is: a user can keep the normal Vercel AI Gateway catalog
available, add a personal Anthropic profile in Settings, and intentionally pick
`User -> Opus 4` from the model selector without relying on hidden inference
environment variables.

## User/Operator Path Protected

A signed-in user can:

- Open Settings -> Models.
- Add a personal Anthropic inference profile with an API key and optional base
  URL.
- Return to a session chat.
- Open the existing model selector in the chat bar.
- Search for `Opus 4`.
- See both user-paid and product-catalog options, for example:
  - `User -> Opus 4`
  - `Anthropic -> Opus 4`
- Select the user-paid option and send a trivial message.
- See run attribution that confirms the selected model, inference source, and
  cost source without exposing key material.

An operator can:

- Inspect workflow/session events and usage rows to determine whether a run used
  the built-in Gateway route or a user-owned profile.
- Confirm no API key was sent to the browser, sandbox, model context, tool
  output, or logs.

## Behavior Contract

- Given no inference profiles exist, when the user opens the chat model picker,
  then the existing provider catalog remains unchanged and Vercel AI Gateway is
  the implicit inference route.
- Given a user creates an Anthropic profile named `Personal Anthropic`, when the
  user opens the model picker, then a `User` group appears above provider
  groups and contains Anthropic-compatible user-backed options.
- Given a user searches `Opus 4`, when both a user-backed option and a catalog
  option match, then both options are shown and grouped by source.
- Given the user selects `User -> Opus 4`, then the app stores the catalog model
  id and the inference profile id separately.
- Given the selected profile uses a direct Anthropic route, when the workflow
  starts, then the server decrypts the key only inside the server runtime and
  creates the Anthropic model using the profile key and optional base URL.
- Given the selected profile is missing, deleted, disabled, or incompatible with
  the selected model, when the user sends a message, then the run fails before
  model invocation with a user-visible, actionable error.
- Given the selected profile key is invalid, when the user tests the profile or
  sends a message, then the UI says the Anthropic credentials failed and does
  not leak the key or raw provider response body.
- Given the default Gateway route fails due Vercel AI Gateway credits or
  provider availability, then the existing Gateway-specific error remains
  intact and does not mention user keys unless a user profile was selected.
- Given a direct Anthropic run completes, then Gateway-reported cost metadata may
  be absent; usage should label the cost source as provider/direct estimate or
  unknown rather than implying Vercel Gateway billed it.

## Product And Design Spec

- Entry point:
  - Extend Settings -> Models with an `Inference profiles` section above or
    near model variants.
  - Use the existing chat bar model selector as the primary in-chat selection
    surface.
- Primary flow:
  - The default state shows `Vercel AI Gateway` as the built-in product route.
  - User adds `Anthropic` profile:
    - display name
    - API key
    - optional base URL
    - optional description
    - optional default Anthropic model
  - App stores only encrypted key material plus safe display fields.
  - User tests profile before or after saving.
  - A successful profile test refreshes model availability when possible.
  - User-backed options prefer verified provider-discovered models and fall
    back to a maintained Gateway-to-direct mapping only when discovery is
    unavailable.
  - User selects profile-backed model from the chat picker.
- Model picker behavior:
  - Add a top-priority `User` group before `Anthropic` and `OpenAI`.
  - Preserve catalog/provider options even when a user-backed option exists for
    the same model family.
  - Search should match model label, catalog model id, direct provider model id,
    provider, profile name, and profile description.
  - User-backed items should include compact secondary text such as
    `Personal Anthropic` or `Client A Anthropic key`.
  - The selected pill should show both model and route when space allows; on the
    compact chat bar, prefer a source-aware tooltip/title if text would crowd
    the input.
- Empty/loading/success/error states:
  - Empty profiles: show the built-in Gateway route and an `Add Anthropic
    profile` action.
  - Loading profiles: keep the catalog picker usable; user group can appear when
    loaded.
  - Saved untested profile: visible `Untested` status.
  - Tested profile: visible `Verified` status with timestamp.
  - Failed test: visible failure summary with retry.
  - Deleted active profile: fail closed or require reselection; do not silently
    bill the product Gateway for a user-paid selection.
- Permissions/auth boundaries:
  - Profiles are user-owned in this slice.
  - Only the owning user can list, read, test, update, delete, or select a
    profile.
  - No team/shared profiles in this slice.
- Accessibility/usability notes:
  - Settings form controls need labels, validation errors, disabled states, and
    password manager friendly key input.
  - Model picker group headings must remain readable by screen readers.
  - Duplicate labels are acceptable only because group and secondary text
    disambiguate source.
- Copy or terminology:
  - Use `Inference profile` for saved routing credentials.
  - Use `Vercel AI Gateway` for the built-in product route.
  - Use `User` as the picker group label for user-owned routes.
  - Use copy like `Paid with Personal Anthropic` or `Direct Anthropic` for
    attribution.

## Integration Spec

- Routes/components/API surfaces:
  - Add profile CRUD and test APIs under `/api/inference-profiles`.
  - Extend `/api/settings/preferences` for default inference profile.
  - Extend chat/session APIs to accept an `inferenceProfileId` separately from
    `modelId`.
  - Extend Settings -> Models with profile management UI.
  - Extend `ModelSelectorCompact` and `ModelCombobox` so duplicate model labels
    from different sources can coexist.
- Agent/workflow surfaces:
  - Extend `AgentModelSelection` so a selection can carry route metadata:
    - catalog model id
    - runtime provider route
    - direct provider model id when needed
    - provider options
    - safe attribution metadata
  - Add a server-only resolver before `openAgent` is called.
  - Do not let the agent, tools, sandbox, or model prompt see the decrypted key.
- Data model/migrations/events/background jobs:
  - Add `inference_profiles`.
  - Add nullable `inference_profile_id` to `chats`.
  - Add nullable `inference_profile_id` to `sessions` for project/session-level
    defaults.
  - Add nullable `default_inference_profile_id` to `user_preferences`.
  - Add inference attribution to `workflow_runs` and `usage_events`.
  - Add session events for profile selection, profile test, and run routing.
- External services/config/env vars:
  - Do not read inference provider API keys from app/project env for user
    overrides.
  - Use the existing deployment encryption secret, `ENCRYPTION_KEY`, only for
    encrypting stored user profile keys.
  - Built-in Gateway behavior remains the existing app/Vercel configuration.
- Observability/status/logging/evidence:
  - Store safe profile id, display name, route type, provider, and key
    fingerprint/last4.
  - Redact key-like strings in test failures and session events.
  - Distinguish Gateway-reported cost from direct-provider estimated or unknown
    cost.
  - Record app-selected inference route before model invocation; do not depend
    on provider or Gateway response metadata for route attribution.
- Backward compatibility:
  - Existing chats with only `model_id` continue using built-in Gateway.
  - Existing model variants keep working and remain separate from inference
    profiles.
  - Shared chat rendering should not expose profile names or private source
    details unless explicitly intended.

## Recommended Technical Decision

Use direct Anthropic profiles for the first implementation slice.

Reasoning:

- The user need is strict payer/source control with an Anthropic key and optional
  custom URL.
- Vercel AI Gateway request-scoped BYOK exists, but current docs state BYOK
  requests can fall back to system credentials and teams must still have Gateway
  credits. That is not strict enough for "this client/user pays" attribution.
- Vercel Gateway request-scoped BYOK passes credentials through the Gateway
  request body and documented Gateway behavior still differs from strict direct
  provider billing. The first user-owned route should avoid ambiguous fallback
  semantics.
- Local AI Gateway research in `develop/agent-university` found that Gateway
  provider metadata can be absent depending on auth mode, so runtime attribution
  must be recorded by this app instead of inferred after the provider returns.
- Anthropic's AI SDK provider supports `createAnthropic({ apiKey, baseURL })`,
  which matches the immediate key plus URL requirement.
- The product default still remains Vercel AI Gateway; only explicit user
  profile selections use the direct route.
- Gateway BYOK should be a later route type for users who explicitly want
  Gateway observability and accept Gateway credit/fallback semantics.

## Source Of Truth

Before:

- `chats.model_id` stores selected model.
- `user_preferences.defaultModelId` stores default model.
- `packages/agent/models.ts` always creates a Gateway-backed language model.
- `modelVariants` represent prompt/provider option presets, not payer/source.

After:

- `chats.model_id` still stores the selected catalog model id.
- `chats.inference_profile_id` optionally stores chat-level routing credentials.
- `sessions.inference_profile_id` optionally stores session/project default
  routing credentials.
- `user_preferences.default_inference_profile_id` optionally stores the user's
  default routing credentials.
- `inference_profiles` stores user-owned, encrypted provider credentials and
  safe public descriptors.
- A server-only resolver combines model selection and inference profile
  selection into a runtime model instance.

## In Scope

- Personal, user-owned Anthropic inference profiles.
- Encrypted key storage with last4/fingerprint display.
- Optional direct Anthropic base URL.
- Profile CRUD and test endpoints.
- Chat/session/user-default profile resolution.
- Chat model picker `User` group.
- User-backed Anthropic model options alongside existing Gateway catalog
  options.
- Separate persistence for selected model and selected profile.
- Direct Anthropic model creation through `@ai-sdk/anthropic`.
- Model id mapping between Gateway catalog ids and Anthropic direct model ids.
- Run and usage attribution for profile/provider/route/cost source.
- Focused tests and Agent Browser smoke for the protected path.

## Out Of Scope

- Team/shared billing profiles.
- Organization policy or admin-managed profiles.
- OpenAI, Google, Bedrock, Vertex, or multi-provider direct profiles.
- Vercel AI Gateway request-scoped BYOK route.
- Budget caps, spend alerts, or monthly reconciliation.
- Automatic project/client inference policy.
- Agent-created inference profiles.
- Composio tool selection changes.
- Replacing model variants.
- Migrating historical runs or backfilling usage attribution.

## Research And Context Sources

- Repo process:
  - `docs/process/feature-ticket-format.md`
  - `docs/process/github-build-process.md`
  - `docs/process/behavior-tdd.md`
  - `docs/process/observability-discipline.md`
- Existing code:
  - `packages/agent/models.ts` currently wraps AI SDK `createGateway()`.
  - `packages/agent/open-agent.ts` currently normalizes `AgentModelSelection`
    into Gateway model instances.
  - `apps/web/app/workflows/chat.ts` resolves chat model runtime before agent
    invocation.
  - `apps/web/app/api/chat/_lib/model-selection.ts` handles model variants and
    model availability.
  - `apps/web/lib/model-options.ts`, `apps/web/components/model-combobox.tsx`,
    and `apps/web/components/model-selector-compact.tsx` own picker options and
    grouping.
  - `apps/web/lib/db/schema.ts` owns `chats`, `sessions`,
    `user_preferences`, `workflow_runs`, and `usage_events`.
  - `apps/web/lib/harness/redaction.ts` and
    `apps/web/lib/observability/events.ts` provide redaction patterns to reuse.
- Context7:
  - Library resolved: `/websites/ai-sdk_dev`.
  - Docs fetched for AI SDK Gateway and Anthropic provider configuration.
  - Library resolved: `/websites/vercel_ai-gateway`.
  - Docs fetched for Gateway models, BYOK, provider options, credits, and model
    discovery APIs.
- Local research repositories:
  - `/Users/dennison/develop/vercel-ai-stack/docs/reference/04-ai-gateway.md`
  - `/Users/dennison/develop/vercel-ai-stack/docs/reference/03-ai-sdk-providers.md`
  - `/Users/dennison/develop/vercel-ai-stack/docs/context/known-issues.md`
  - `/Users/dennison/develop/agent-university/vercel/degrees/01-ai-gateway/01-research/mental-model.md`
  - `/Users/dennison/develop/agent-university/vercel/degrees/01-ai-gateway/01-research/config.md`
  - `/Users/dennison/develop/agent-university/vercel/degrees/01-ai-gateway/01-research/security.md`
  - `/Users/dennison/develop/agent-university/vercel/degrees/01-ai-gateway/01-research/observability.md`
  - `/Users/dennison/develop/agent-university/vercel/degrees/01-ai-gateway/01-research/failure-modes.md`
  - `/Users/dennison/develop/agent-university/vercel/degrees/01-ai-gateway/01-research/testing.md`
  - `/Users/dennison/develop/agent-university/vercel/degrees/01-ai-gateway/05-distillation/before-you-build.md`
  - `/Users/dennison/develop/agent-university/vercel/degrees/01-ai-gateway/05-distillation/distilled-principles.md`
- Vendor docs:
  - AI SDK Gateway provider:
    https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway
  - AI SDK Anthropic provider:
    https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
  - Vercel AI Gateway request-scoped BYOK:
    https://vercel.com/docs/ai-gateway/authentication-and-byok/byok
  - Vercel AI Gateway models and providers:
    https://vercel.com/docs/ai-gateway/models-and-providers
  - Vercel AI Gateway provider options:
    https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
  - Anthropic model overview:
    https://platform.claude.com/docs/en/about-claude/models/overview
- Research findings:
  - AI SDK Gateway can be used through string model ids or explicit
    `gateway(modelId)` and supports custom provider instances with `apiKey`,
    `baseURL`, and `headers`.
  - AI Gateway supports request-scoped BYOK via `providerOptions.gateway.byok`.
  - Vercel BYOK docs state Gateway may fall back to system credentials if BYOK
    credentials fail and that Gateway credits are still required.
  - AI SDK Anthropic supports `createAnthropic({ apiKey, baseURL })`.
  - Gateway model slugs change over time; validate model ids against the live
    `/v1/models` catalog instead of relying on static docs or memory.
  - Direct Anthropic routes lose Gateway dashboard/cost metadata; this app must
    write safe route, provider, profile, and cost-source attribution itself.
  - AI SDK v6 examples use token fields such as `inputTokens` and
    `outputTokens`, and generation limits such as `maxOutputTokens`; profile
    tests should follow installed package types.
  - There is no local AI Gateway emulator in the researched examples. Live
    Gateway or provider tests cost credits and should be gated behind explicit
    credentials.
  - Direct Anthropic model ids are not the same as Gateway catalog ids. Example:
    `anthropic/claude-opus-4.7` in Gateway maps to a direct Anthropic id such as
    `claude-opus-4-7`.
  - Current Gateway model list check on 2026-05-24 returned Anthropic catalog
    ids including `anthropic/claude-opus-4.7`,
    `anthropic/claude-opus-4.6`, `anthropic/claude-opus-4.5`,
    `anthropic/claude-opus-4.1`, `anthropic/claude-opus-4`, and
    `anthropic/claude-haiku-4.5`.

## Agent Todo Checklist

- [ ] Read this issue, `docs/process/feature-ticket-format.md`, and
  `docs/process/observability-discipline.md`.
- [ ] Split this epic into PR-sized feature issues before implementation.
- [ ] Verify installed AI SDK package exports and types after dependency setup;
  do not assume provider option type names from docs.
- [ ] Verify direct Anthropic model id support from installed `@ai-sdk/anthropic`
  types/docs before finalizing the mapping.
- [ ] Trace the current model flow from Settings/defaults through chat PATCH,
  workflow runtime resolution, `openAgent`, usage events, and UI pills.
- [ ] Add failing tests for encrypted inference profile key storage and
  redaction.
- [ ] Add failing DB/API tests for profile CRUD, ownership enforcement, key
  omission, and profile testing.
- [ ] Add failing model mapping tests for Gateway Anthropic ids to direct
  Anthropic ids.
- [ ] Add failing resolver tests for chat > session > user > built-in Gateway
  profile order.
- [ ] Add failing `packages/agent/models.ts` tests for direct Anthropic model
  creation and Gateway fallback preservation.
- [ ] Add failing chat PATCH/workflow tests proving model id and profile id are
  persisted and resolved separately.
- [ ] Add failing UI helper tests proving `User` group sorts above provider
  groups and duplicate labels survive search.
- [ ] Commit the failing test-only state, or document why the red commit cannot
  be separated.
- [ ] Add `inference_profiles` schema, profile references, and generated
  migration.
- [ ] Add server-only encryption, fingerprinting, public descriptor, and
  redaction helpers.
- [ ] Add profile CRUD and test APIs.
- [ ] Add profile resolution and compatibility checks.
- [ ] Extend agent model selection types and model factory routing.
- [ ] Extend chat/session/preference APIs for selected inference profile ids.
- [ ] Extend workflow run and usage attribution.
- [ ] Extend Settings -> Models with profile management.
- [ ] Extend chat model picker options, grouping, search, selection, and
  selected-state display.
- [ ] Run targeted tests as each layer goes green.
- [ ] Run `bun run --cwd apps/web db:generate` after schema changes and commit
  the migration.
- [ ] Run `bun --bun run check`.
- [ ] Run `bun --bun run typecheck`.
- [ ] Run `bun run --cwd apps/web db:check`.
- [ ] Run `git diff --check`.
- [ ] Run `bun --bun run ci`.
- [ ] Use Agent Browser to smoke Settings profile creation, model picker
  selection, a trivial chat, run attribution, and redaction.
- [ ] Run optional live profile smoke only through a real user-supplied
  Anthropic key in the UI; CI and local unit tests should use mocks/fakes.
- [ ] Inspect browser console, browser errors, relevant network responses, and
  local server logs.
- [ ] Update docs/notes with implementation summary and verification evidence.

## Tests To Add First

- Smallest unit/contract tests:
  - `apps/web/lib/inference/secret-encryption.test.ts`
    - Expected red command:
      `bun test apps/web/lib/inference/secret-encryption.test.ts`
    - Expected red reason: module does not exist.
    - Prove round-trip encryption, wrong key failure, fingerprint/last4, and no
      plaintext in serialized records.
  - `apps/web/lib/inference/anthropic-model-ids.test.ts`
    - Expected red command:
      `bun test apps/web/lib/inference/anthropic-model-ids.test.ts`
    - Expected red reason: mapping module does not exist.
    - Prove Gateway ids map to direct Anthropic ids and unknown ids fail closed.
  - `packages/agent/models.test.ts`
    - Expected red command: `bun test packages/agent/models.test.ts`
    - Expected red reason: no direct Anthropic runtime config exists.
    - Prove built-in Gateway path still calls Gateway, direct Anthropic path
      calls `createAnthropic`, and direct route passes no key through provider
      options or logs.
- API/DB tests:
  - `apps/web/lib/db/inference-profiles.test.ts`
    - CRUD, ownership, key update preservation, redacted public descriptor.
  - `apps/web/app/api/inference-profiles/route.test.ts`
    - Auth required, create/list responses omit key material.
  - `apps/web/app/api/inference-profiles/[profileId]/route.test.ts`
    - Read/update/delete ownership and missing profile behavior.
  - `apps/web/app/api/inference-profiles/[profileId]/test/route.test.ts`
    - Test success/failure status and redacted failure summary.
    - Use the smallest possible prompt and `maxOutputTokens` when exercising a
      real provider in a gated manual smoke; CI should use a mocked provider
      factory and require no real Anthropic key.
- Workflow and behavior tests:
  - `apps/web/lib/inference/profile-resolution.test.ts`
    - chat > session > user > built-in order.
    - missing/deleted/incompatible profile fail closed.
  - `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.test.ts`
    - PATCH accepts `modelId` and `inferenceProfileId` separately.
  - `apps/web/app/workflows/chat.test.ts`
    - Direct Anthropic profile is resolved and attributed.
    - Gateway credit restriction copy remains unchanged for built-in route.
    - Direct provider key failure surfaces as profile credential failure.
- UI/helper tests:
  - `apps/web/lib/model-options.test.ts`
    - User-backed model options appear in `User` group above provider groups.
    - Duplicate `Opus 4` labels from different sources coexist.
    - Search value includes profile name and direct provider model id.
  - Component tests only if an existing pattern is available; otherwise cover
    picker behavior through helper tests plus Agent Browser smoke.
- End-to-end smoke:
  - Agent Browser path:
    - open `/settings/models`
    - create Anthropic profile
    - verify key is not visible after save
    - open a session chat
    - search `Opus 4`
    - select `User -> Opus 4`
    - send a trivial prompt
    - verify run attribution and no key leakage in page text, console, network
      payloads, or server logs.

## Observability And User Feedback

- User-visible status:
  - Settings profile cards show `Untested`, `Verified`, `Failed`, or
    `Disabled`.
  - Chat bar selected model shows or tooltips inference source.
  - Run/transcript attribution shows model, provider, profile name, route, and
    cost source.
- Logs/events/metadata:
  - `inference.profile.created`
  - `inference.profile.updated`
  - `inference.profile.deleted`
  - `inference.profile.tested`
  - `inference.profile.selected`
  - `workflow.step.started` payload includes safe inference attribution.
  - Write the app-selected route before the model call starts. Provider metadata
    can enrich the event later, but must not be required to answer "which route
    did this run use?"
- Runtime/profile attribution:
  - `workflow_runs.inference_profile_id`
  - `workflow_runs.inference_provider`
  - `workflow_runs.inference_route`
  - `usage_events.inference_profile_id`
  - `usage_events.inference_route`
  - `usage_events.cost_source`
- Screenshots/browser/service evidence:
  - Settings profile manager with saved profile.
  - Model picker showing `User` group and provider catalog group.
  - Run attribution showing direct Anthropic profile.
- Failure modes surfaced:
  - Missing key.
  - Invalid key.
  - Invalid base URL.
  - Profile deleted.
  - Profile owned by another user.
  - Model/profile incompatibility.
  - Direct provider unavailable.
  - Gateway credit restriction for built-in Gateway route.

## TDD Audit Trail

- [ ] Red test commit planned:
  - Commit:
  - Failing command/output:
- [ ] Green implementation commit planned:
  - Commit:
  - Passing command/output:
- [ ] If red and green work cannot be separated into commits, explain why:

## Regression Risks And Concerns

- Risk: Direct Anthropic ids differ from Gateway catalog ids.
  - Mitigation/test: add explicit mapping tests and fail closed on unknown
    direct model id.
  - Open concern: whether to dynamically query Anthropic Models API for
    user-specific model availability in a later slice.
- Risk: A user thinks a user profile was used, but billing falls back to the
  product Gateway.
  - Mitigation/test: first slice uses direct Anthropic, not Gateway BYOK.
    Missing/deleted profile must fail closed.
- Risk: Key material leaks through API responses, events, provider options
  snapshots, console logs, or test failures.
  - Mitigation/test: redaction tests, response-shape tests, Agent Browser
    network/log inspection.
- Risk: Existing Gateway errors, usage cost extraction, or model variants break.
  - Mitigation/test: preserve existing Gateway tests and add direct-provider
    tests next to them.
- Risk: Runtime/provider metadata is missing or inconsistent, especially across
  Gateway auth modes.
  - Mitigation/test: use app-side route attribution as source of truth and treat
    provider metadata as optional enrichment.
- Risk: Static model lists drift from Gateway or Anthropic availability.
  - Mitigation/test: validate against live `/v1/models` for Gateway catalog
    checks and refresh direct profile model availability during profile tests
    when provider support exists.
- Risk: Model picker becomes confusing with duplicate labels.
  - Mitigation/test: group by source and include secondary text; browser smoke
    search for `Opus 4`.
- Risk: Migration touches hot tables.
  - Mitigation/test: nullable columns, generated migration, `db:check`, and
    deployment notes.
- Risk: Direct provider calls lose Gateway cost metadata.
  - Mitigation/test: distinguish `gateway_reported`, `estimated`, and `unknown`
    cost sources.
- Risk: Direct provider routing bypasses Vercel AI Gateway observability and
  centralized spend controls by design.
  - Mitigation/test: make source selection explicit in UI and events; keep
    Gateway as the default product route.

## Open Questions

- Should direct Anthropic model availability be discovered live through
  Anthropic APIs during profile test, or should Slice 1 ship with a maintained
  mapping and add discovery later?
- Should the picker group always be `User`, or should multi-profile users see
  profile-name sublabels strongly enough that `User` remains useful?
- Should session/project default profile selection ship in Slice 2 with runtime
  resolution, or in Slice 3 with the visible Settings/chat UX?
- Should a direct profile be selectable without a successful test, or should the
  first slice require a verified profile before chat use?

## Deploy Or Migration Impact

- Database migration required:
  - `inference_profiles`
  - `chats.inference_profile_id`
  - `sessions.inference_profile_id`
  - `user_preferences.default_inference_profile_id`
  - inference attribution columns on `workflow_runs`
  - inference attribution columns on `usage_events`
- Vercel environment:
  - No new inference provider env vars.
  - `ENCRYPTION_KEY` must remain configured for secret encryption.
- Production rollout:
  - Existing chats should continue to route through built-in Gateway because new
    profile ids are nullable.
  - If `ENCRYPTION_KEY` is missing, profile creation/testing should fail with a
    server-side configuration error; existing Gateway usage should continue.
  - User-selected direct Anthropic profiles should bypass Vercel AI Gateway
    credits and Gateway fallback semantics, while the built-in default remains
    Gateway-backed.
- Rollback:
  - Disable profile UI and ignore nullable profile ids to return all chats to
    built-in Gateway.
  - Do not delete encrypted profile rows during rollback.

## Definition Of Done

- [ ] Smallest behavior/contract test observed red first.
- [ ] Behavior/integration proof observed red before implementation where
  applicable.
- [ ] Red test commit exists on the work branch, or exception is documented.
- [ ] Green implementation commit exists after the red test commit, or exception
  is documented.
- [ ] Targeted tests pass.
- [ ] Adjacent suite passes.
- [ ] `git diff --check` passes.
- [ ] `bun --bun run check` passes.
- [ ] `bun --bun run typecheck` passes.
- [ ] `bun run --cwd apps/web db:check` passes.
- [ ] `bun --bun run ci` passes or approved/pre-existing failures are
  documented.
- [ ] Agent Browser smoke passes for Settings profile creation, picker
  selection, trivial chat, attribution, and redaction.
- [ ] Docs updated with implementation summary and verification notes.
- [ ] Deploy notes include migration and encryption-key considerations.
