# Inference Profiles & Model Catalog Audit Scratchpad

Domain: Inference profiles, model list/variants/availability/context/roles/options.
Scope paths: apps/web/lib/inference, apps/web/lib/model-*, apps/web/lib/models*, apps/web/app/api/models, apps/web/app/api/inference-profiles.

## Files read
- docs/agents/lessons-learned.md (full — no inference-specific lessons; encryption/decrypt-error lessons are reflected in current code which has multi-key decryption + secret-free error messages)
- apps/web/app/api/models/route.ts — GET, NO auth
- apps/web/app/api/models/route.test.ts
- apps/web/app/api/inference-profiles/route.ts — CRUD, authed via requireAuthenticatedUser
- apps/web/app/api/inference-profiles/[profileId]/test/route.ts — POST, authed, decrypts key, generateText to user baseUrl
- apps/web/lib/inference/fetch-profile-models.ts — server fetch to user baseUrl with x-api-key header
- apps/web/lib/inference/types.ts — zod schemas; baseUrl only validates http/https protocol, no host check
- apps/web/lib/inference/encryption.ts — AES-256-GCM, multi-key decrypt, secret-free errors (good)
- apps/web/lib/inference/profile-resolution.ts — scoped by userId, enabled check
- apps/web/lib/inference/model-routing.ts — normalizeAnthropicBaseUrl + redactInferenceSecret + toInferenceProfileTestMessage
- apps/web/lib/inference/model-routing.test.ts
- apps/web/lib/inference/model-option-id.ts
- apps/web/lib/models.ts, models-with-context.ts, model-availability.ts, model-variants.ts, model-roles.ts, model-options.ts
- apps/web/lib/db/inference-profiles.ts — all queries scoped by (id, userId); toSafeInferenceProfile strips encryptedApiKey
- apps/web/lib/db/user-preferences.ts — modelVariants stored per-user in jsonb
- apps/web/app/api/settings/model-variants/route.ts — GET/POST/PATCH/DELETE, authed, built-in variants protected
- apps/web/app/api/chat/_lib/model-selection.ts
- apps/web/app/workflows/chat.ts (resolveChatModelRuntime region + profile resolution) — session ownership verified (sessionRecord.userId !== params.userId -> throw), profile lookup scoped by userId
- packages/agent/models.ts (toAnthropicDirectModelId, directAnthropicModel)
- schema.ts / migrations: inference_profiles has uniqueIndex(userId,name); FK from chats/sessions/agents/usage_events with ON DELETE set null (clean)

## Assumptions / how it works
- Inference profiles are per-user AES-GCM-encrypted Anthropic-compatible API-key records with an optional user-supplied baseUrl.
- Resolved at chat runtime: decrypt key, call Anthropic-compatible endpoint at baseUrl with the key in x-api-key header.
- Model variants are per-user jsonb preferences; built-in variants cannot be mutated/deleted.
- /api/models returns the shared Vercel AI Gateway catalog enriched from models.dev (public, no per-user data).
- Ownership discipline is consistently enforced: every inference-profile query is scoped by (id, userId); chat resolution re-checks session ownership before resolving a profile. No IDOR found.

## Candidate defects considered

1. SSRF / credential-exfil via user-controlled baseUrl (no host/internal-IP guard) — ACCEPTED. Provable. fetch-profile-models.ts + test route + profile-resolution.ts + directAnthropicModel all send the decrypted key to a server-side fetch against a user-chosen http(s) URL with no allowlist/denylist. Trigger: authenticated user creates a profile with baseUrl=https://attacker.example (or internal/loopback/metadata host) and any apiKey; server fetches it with x-api-key=<key>. Medium severity (bounded: the key forwarded is the user's own; SSRF is self-initiated from an authenticated session but abuses server network position to reach internal addresses).

2. /api/models returns gateway catalog with no auth — ACCEPTED as low. Provable. No requireAuthenticatedUser/session check in route.ts GET. Exposes model ids/names/descriptions/context/pricing of the configured gateway. Low severity (no secrets, shared catalog, but reveals tenant gateway config to anonymous callers; a self-hoster's private/differentiated model list leaks).

3. Redaction bypass in toInferenceProfileTestMessage — REJECTED. Literal-secret split/join runs first, then sk-/plat-/{32,} regexes; the stored/returned message is fully redacted. Tests cover exact-key and sk- redaction. Not a defect.

4. Concurrency / read-modify-write on model-variants POST — REJECTED as a finding. Code explicitly documents it as an accepted, known tradeoff with a NOTE comment (route.ts ~line 75). Not raising a known-accepted design choice.

5. Dangling inferenceProfileId reference after profile delete — REJECTED. FK ON DELETE set null + resolution guards null/unavailable. Clean.

6. Duplicate profile name — REJECTED. uniqueIndex(userId,name) exists; route catches unique/duplicate error text correctly.

7. DELETE-with-body on inference-profiles — REJECTED. Works in Next/Node; parses JSON body. Not a defect.

8. /models create POST calls fetchInferenceProfileModels inline (10s hang on slow baseUrl) — noted as minor reliability, not raising (bounded, best-effort, returns [] on failure).

9. buildModelOptions clones full Anthropic catalog per profile without discovered models — minor perf, not a correctness/security defect.

## Coverage gaps
- Did not exercise live gateway.getAvailableModels() against a real Vercel AI Gateway token; behavior inferred from code + tests.
- Did not run the managed-runtime/sandbox path that might also consume inference profiles (out of domain scope).
- Did not audit the chat streaming path's handling of a profile whose key fails to decrypt mid-stream (profile-resolution throws InferenceProfileResolutionError; chat.ts surfaces it — looks correct, not deeply traced).
- packages/agent model option defaulting (getProviderOptionsForModel) only skimmed; deeper correctness of provider-option merging not exhaustively reviewed.
