/**
 * suggested-trigger-query.ts — encodes/decodes a LoopTemplateSuggestedTriggerSpec
 * (#765) into URL search params so it can survive the redirect from
 * "create from template" to the post-create landing page (the builder), where
 * the one-click "Attach suggested trigger" nudge reads it back.
 *
 * Kept as a small, pure, colocated module (no React) so both the create form
 * (encode) and the nudge component (decode) can unit-test against the same
 * contract without rendering anything.
 */
import type { LoopTemplateSuggestedTriggerSpec } from "./loop-templates";

const KIND_PARAM = "suggestedTriggerKind";
const SCHEDULE_PARAM = "suggestedTriggerSchedule";

/** Appends the suggested-trigger query params to a path. Pure string building. */
export function appendSuggestedTriggerParams(
  path: string,
  spec: LoopTemplateSuggestedTriggerSpec | undefined,
): string {
  if (!spec) {
    return path;
  }
  const params = new URLSearchParams();
  params.set(KIND_PARAM, spec.kind);
  if (spec.kind === "schedule.cron") {
    params.set(SCHEDULE_PARAM, spec.schedule);
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${params.toString()}`;
}

/** Decodes a suggested-trigger spec back out of a URLSearchParams instance. */
export function decodeSuggestedTriggerParams(
  searchParams: URLSearchParams,
): LoopTemplateSuggestedTriggerSpec | undefined {
  const kind = searchParams.get(KIND_PARAM);
  if (!kind) {
    return undefined;
  }
  if (kind === "schedule.cron") {
    const schedule = searchParams.get(SCHEDULE_PARAM);
    if (!schedule) {
      return undefined;
    }
    return { kind: "schedule.cron", schedule };
  }
  if (
    kind === "github.pull_request" ||
    kind === "github.pull_request_review" ||
    kind === "github.deployment_status" ||
    kind === "github.issue" ||
    kind === "github.check_suite"
  ) {
    return { kind };
  }
  return undefined;
}
