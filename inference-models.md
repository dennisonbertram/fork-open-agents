# Audit Scratchpad: Inference Profiles & Model Catalog/Variants

## Files Read

- `apps/web/lib/inference/types.ts` — Zod schemas & types for inference profiles
- `apps/web/lib/inference/encryption.ts` — AES-256-GCM encrypt/decrypt of API keys
- `apps/web/lib/inference/encryption.test.ts` — Round-trip & multi-key fallback tests
- `apps/web/lib/inference/model-routing.ts` — Base URL normalization, secret redaction, error-to-message
- `apps/web/lib/inference/profile-resolution.ts` — Resolves profile model selection at runtime
- `apps/web/lib/inference/fetch-profile-models.ts` — Fetches /v1/models from provider endpoints
- `apps/web/lib/inference/model-option-id.ts` — Compound user-profile model option IDs
- `apps/web/lib/inference/inference-decrypt-error.test.ts` — Decryption error contract tests
- `apps/web/lib/inference/inference-decrypt-regression.test.ts` — Regression for decryption error handling
- `apps/web/lib/models.ts` — Core model types, cost estimation, context lookup
- `apps/web/lib/models-with-context.ts` — Gateway + models.dev enrichment pipeline
- `apps/web/lib/model-variants.ts` — Model variant schemas, resolution, built-in variants
- `apps/web/lib/model-availability.ts` — Disabled model filtering (openai/gpt-*-pro)
- `apps/web/lib/model-roles.ts` — Static role hints & cost-tier derivation
- `apps/web/lib/model-options.ts` — ModelOption building, grouping, filtering, recommended list
- `apps/web/lib/db/inference-profiles.ts` — CRUD operations with userId-based authz
- `apps/web/lib/db/schema.ts` (lines 199-236) — inference_profiles table definition
- `apps/web/app/api/models/route.ts` — GET /api/models (unauthenticated model catalog)
- `apps/web/app/api/models/route.test.ts` — Tests for model list enrichment
- `apps/web/app/api/inference-profiles/route.ts` — CRUD for inference profiles (auth required)
- `apps/web/app/api/inference-profiles/[profileId]/test/route.ts` — POST test endpoint
- `apps/web/app/api/sessions/[sessionId]/route.ts` (lines 103-123) — Session PATCH validates inferenceProfileId
- `apps/web/app/workflows/chat.ts` (lines 96-108, 170-270, 2176-2235) — Chat workflow model resolution
- `apps/web/app/api/chat/_lib/model-selection.ts` — resolveChatModelSelection
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx` (lines 1098-1119) — updateChatModel client
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx` (lines 1997-2011) — handleModelChange
- `apps/web/app/api/sessions/_lib/session-context.ts` (lines 65-78) — requireAuthenticatedUser
- `docs/agents/lessons-learned.md` — Known lessons, none specific to inference/models domain

## Assumptions About How the App Works

1. **Auth model**: All mutation endpoints use `requireAuthenticatedUser()` (Better Auth session). GET models is intentionally unauthenticated (public catalog). All inference profile CRUD + test endpoints require auth.

2. **API key storage**: Keys are AES-256-GCM encrypted at rest in `inference_profiles.encrypted_api_key`. `keyLast4` and `keyFingerprint` are stored for identification without exposing the full key. `SafeInferenceProfile` excludes the encrypted key entirely.

3. **Key rotation**: `getDecryptionKeys()` tries `ENCRYPTION_KEY` first, then falls back to `BETTER_AUTH_SECRET`. If both are set, both are tried. Duplicate derived keys are deduplicated.

4. **Model selection flow (client → DB → workflow)**:
   - Client shows compound IDs like `user-profile:<profileId>:<modelId>` in the picker
   - On selection, `parseModelOptionSelection` splits into `modelId` + `inferenceProfileId`
   - `updateChatModel` sends PATCH to `/api/sessions/[sessionId]/chats/[chatId]`
   - DB stores raw `modelId` (e.g., `glm-4.6`) and `inferenceProfileId` separately
   - Chat workflow reads both from DB, resolves profile, validates model ∈ profile.models
   - Each turn, `resolveStepInferenceProfileModel` re-fetches profile, decrypts key, returns anthropic direct config

5. **Profile test flow**: `POST /api/inference-profiles/[profileId]/test` decrypts the stored key, calls `generateText` with the key + optional base URL, records pass/fail, and refreshes the discovered model list on success.

6. **Model catalog**: `GET /api/models` calls Vercel AI Gateway (`gateway.getAvailableModels()`), enriches with context/cost from `models.dev/api.json`, filters to language models only and excludes disabled `openai/gpt-*-pro` models.

## Candidate Defects Considered

### C1: GET /api/models is unauthenticated
- **Observed**: `route.ts` has NO auth check. Any unauthenticated request returns the full model catalog.
- **Analysis**: Model catalogs are typically public information. The Vercel AI Gateway is called on each request (cost per call). No rate limiting.
- **Decision**: ACCEPT as medium finding. The unauthenticated nature isn't inherently wrong (model catalogs are public), but the lack of rate limiting combined with paid Gateway calls creates an abuse vector, and there's no observability on who/what is calling it. Additionally, the `Cache-Control: private, no-store` prevents any CDN caching that could mitigate the cost.

### C2: API key sent to default Anthropic endpoint when baseUrl is null (POST creation flow)
- **Observed**: `POST /api/inference-profiles` calls `fetchInferenceProfileModels` with the raw API key and the user's `baseUrl` (or default `https://api.anthropic.com/v1`).
- **Analysis**: If a user intends to use a non-Anthropic provider but hasn't set `baseUrl` yet, their key is sent to Anthropic. However, this is a user workflow issue (they should set the baseUrl), and the payload to Anthropic is just a GET /v1/models which simply fails for non-Anthropic keys.
- **Decision**: REJECT. Not a real defect — the key is only sent to the intended endpoint (user-specified or the default). The default is Anthropic because it's the only provider type supported.

### C3: `http://` base URL allows plaintext API key transmission
- **Observed**: `baseUrlInputSchema` in `types.ts` line 29 allows `url.protocol === "http:"`.
- **Analysis**: A user could configure an HTTP endpoint and their key would be sent in plaintext. This is a user responsibility/choice. Some local dev setups require HTTP. The validation is permissive by design.
- **Decision**: REJECT. Low severity and by design for development flexibility.

### C4: Secret redaction in `toInferenceProfileTestMessage` — regex gaps
- **Observed**: `redactInferenceSecret` uses three regex patterns as fallback after exact-key matching. Third regex `\b[A-Za-z0-9_-]{32,}\b` could miss keys shorter than 32 chars or containing special chars like `+/=`.
- **Analysis**: Anthropic keys are `sk-ant-api03-...` (well over 32 chars, only alphanumeric/hyphen). The exact-key match (`split(secret).join("[redacted]")`) provides primary protection. The regexes are defense-in-depth for unknown patterns.
- **Decision**: REJECT. The exact-key match in the primary code path is sufficient. The regex fallbacks are defense-in-depth and adequate for Anthropic key formats.

### C5: `model-option-id.ts` parsing with colons in model IDs
- **Observed**: `parseModelOptionSelection` splits on first `:` after the prefix, but `createUserInferenceModelOptionId` uses `encodeURIComponent` which does NOT encode `:`.
- **Analysis**: Anthropic-compatible model IDs (from /v1/models) don't contain colons. The app catalog uses `/` as separator. Profile IDs are nanoids (no colons). The risk requires a provider whose model IDs contain colons.
- **Decision**: REJECT. No real-world trigger for the currently supported provider type.

### C6: Every turn re-fetches profile and decrypts key
- **Observed**: `resolveStepInferenceProfileModel` is called EACH turn in the agent loop, hitting DB and decrypting the key each time.
- **Analysis**: This is correct behavior — the key must be decrypted for use. The `"use step"` directive makes it a durable workflow step. Key is never cached in memory.
- **Decision**: REJECT. Correct security posture — never cache decrypted keys.

### C7: `resolveInferenceProfileModelSelection` and chat workflow have overlapping profile validation
- **Observed**: Both `resolveChatModelRuntime` (line 239-250 of chat.ts) and `resolveInferenceProfileModelSelection` (line 33-41 of profile-resolution.ts) independently check `profile.enabled`.
- **Analysis**: This is defense-in-depth. The chat workflow checks first, and the step-level resolution checks again (in case profile was disabled mid-run).
- **Decision**: REJECT. Correct defense-in-depth pattern.

### C8: `resolveModelSelection` doesn't handle user-inference model IDs
- **Observed**: If `chat.modelId` were a compound `user-profile:...` ID, `resolveModelSelection` wouldn't resolve it (only handles `variant:` prefix).
- **Analysis**: Verified that `chat.modelId` stores the RAW model ID (e.g., `glm-4.6`), NOT the compound option ID. The compound ID is only used client-side and is parsed back before saving. So this path is never hit.
- **Decision**: REJECT. No real scenario where compound IDs reach `resolveModelSelection`.

### C9: `toInferenceProfileTestMessage` default case over-aggressively redacts
- **Observed**: The third regex `\b[A-Za-z0-9_-]{32,}\b` can match UUIDs, request IDs, or error codes in messages.
- **Analysis**: This is in the test-result message path, not in user-facing chat. Slightly over-redacted test messages are acceptable. Not a security or correctness issue.
- **Decision**: REJECT. Minor cosmetic issue in test messages.

### C10: No FK validation when deleting a profile with active chats
- **Observed**: `inference_profiles` has `ON DELETE SET NULL` on the `chats.inference_profile_id` FK. When a profile is deleted, chats that reference it silently lose their profile association.
- **Analysis**: The `"set null"` behavior is intentional. The chat workflow handles `inferenceProfileId: null` gracefully (falls back to gateway). The `withMissingModelOption` function creates a synthetic "missing profile" option for the picker.
- **Decision**: REJECT. Handled correctly by the schema and application logic.

## Accepted Findings

See final structured output for the two accepted findings:

1. **inference-models-1**: Unauthenticated + unrate-limited model catalog endpoint exposing paid Gateway calls (Medium, Security/Performance)
2. **inference-models-2**: `POST /api/inference-profiles` PATCH handler accepts JSON body for PATCH (but DELETE also uses JSON body) — actually re-checking, this is consistent across the handler. MOVING TO REJECT.

### Finding 1 Details (Accepted)
**File**: `apps/web/app/api/models/route.ts` (entire file, lines 1-25)
**Issue**: The `GET /api/models` route has zero authentication. It calls `gateway.getAvailableModels()` from the Vercel AI SDK on every request — a paid API call. Combined with `Cache-Control: private, no-store`, every unauthenticated request costs money. No rate limiting, no request attribution.
**Trigger**: Any unauthenticated HTTP client can curl `GET /api/models` infinitely.
**Impact**: Financial cost from Gateway API abuse, potential for service degradation.

## Coverage Gaps

1. **No test for authenticated model listing**: The test at `route.test.ts` only tests unauthenticated calls. No test verifies what happens when an authenticated user hits the endpoint (should it return different models? user-specific models?).

2. **No integration test for inference profile CRUD + model flow**: Tests cover encryption, decryption, and model-selection in isolation, but there's no end-to-end test that creates a profile, tests it, selects a model from its discovered list, and verifies the chat workflow uses the correct key + endpoint.

3. **No test for `parseModelOptionSelection` with edge cases**: No test verifies behavior with empty segments, double-encoded values, or malformed inputs beyond the valid path.

4. **No test for profile deletion cascade**: No test verifies that deleting a profile correctly sets `chat.inferenceProfileId` to NULL and that the UI handles this gracefully.

5. **No observability on /api/models abuse**: No structured logging or metrics on the unauthenticated model endpoint to detect abuse patterns.
