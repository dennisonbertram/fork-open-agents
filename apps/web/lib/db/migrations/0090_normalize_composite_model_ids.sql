-- #1154: split legacy "user-profile:<profileId>:<modelId>" composite ids
-- that predate #1123's write-time split back into their model + profile
-- columns. This SPLITS the composite (preserving the user's chosen model);
-- it never drops the composite and falls back to an app default. Only rows
-- whose paired profile column is currently NULL are touched, so an
-- already-correct pairing is never overwritten.
--
-- Excluded on purpose:
--   - usage_events.model_id — a historical record; rewriting it falsifies
--     past usage.
--   - user_preferences.default_subagent_model_id — composite by design
--     (apps/web/app/workflows/resolve-step-agent-models.ts).
--
-- ponytail: decodes only the "%2F" (slash) escape that encodeURIComponent
-- produces for provider/model ids (e.g. "anthropic/claude-sonnet-4.5").
-- Inference profile ids are nanoid-generated from a URL-safe alphabet and
-- are never percent-encoded by createUserInferenceModelOptionId. If a
-- future id introduces other reserved characters, extend the decode here to
-- match decodeURIComponent's behavior in parseModelOptionSelection
-- (apps/web/lib/inference/model-option-id.ts).
--
-- The profile column is assigned through a scalar subquery against
-- "inference_profiles" rather than the decoded value directly. When a composite
-- references a profile that has since been deleted, the FK (ON DELETE SET NULL)
-- has already nulled the paired column, so the WHERE clause selects the row --
-- and assigning the decoded id would violate the foreign key. Because
-- migrations run during every build, that failure would block deploys, not just
-- this one. A scalar subquery yields NULL for a missing profile, so the model id
-- is still normalized and the stale profile is correctly left NULL.

UPDATE "user_preferences"
SET
  "default_model_id" = replace(
    substring(
      substring("default_model_id" from 14)
      from position(':' in substring("default_model_id" from 14)) + 1
    ),
    '%2F', '/'
  ),
  "default_inference_profile_id" = (
    SELECT p."id" FROM "inference_profiles" p
    WHERE p."id" = replace(
      split_part(substring("default_model_id" from 14), ':', 1),
      '%2F', '/'
    )
  )
WHERE "default_model_id" LIKE 'user-profile:%'
  AND "default_inference_profile_id" IS NULL
  AND position(':' in substring("default_model_id" from 14)) > 0;
--> statement-breakpoint

UPDATE "chats"
SET
  "model_id" = replace(
    substring(
      substring("model_id" from 14)
      from position(':' in substring("model_id" from 14)) + 1
    ),
    '%2F', '/'
  ),
  "inference_profile_id" = (
    SELECT p."id" FROM "inference_profiles" p
    WHERE p."id" = replace(
      split_part(substring("model_id" from 14), ':', 1),
      '%2F', '/'
    )
  )
WHERE "model_id" LIKE 'user-profile:%'
  AND "inference_profile_id" IS NULL
  AND position(':' in substring("model_id" from 14)) > 0;
--> statement-breakpoint

UPDATE "workflow_runs"
SET
  "model_id" = replace(
    substring(
      substring("model_id" from 14)
      from position(':' in substring("model_id" from 14)) + 1
    ),
    '%2F', '/'
  ),
  "inference_profile_id" = (
    SELECT p."id" FROM "inference_profiles" p
    WHERE p."id" = replace(
      split_part(substring("model_id" from 14), ':', 1),
      '%2F', '/'
    )
  )
WHERE "model_id" LIKE 'user-profile:%'
  AND "inference_profile_id" IS NULL
  AND position(':' in substring("model_id" from 14)) > 0;
