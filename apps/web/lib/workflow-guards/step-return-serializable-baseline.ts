import path from "node:path";
import type { StepReturnViolation } from "./step-return-serializable";

/**
 * Known, pre-existing violations in apps/web/app/workflows/ that this guard
 * (added in #1281) discovered but did not cause, and that this task is not
 * permitted to fix (chat.ts is off-limits here).
 *
 * `resolveChatModelRuntime`'s declared return type is `Promise<ChatModelRuntime>`,
 * whose `agentOptions` field is `ChatModelRuntimeAgentOptions =
 * Omit<OpenAgentCallOptions, "sandbox" | "skills" | "toolAuthoringEnabled" |
 * "proposeToolAction" | "manageAgentEnabled" | "manageBackgroundAgentAction">`
 * (chat.ts). That Omit list does not include "writer" —
 * `OpenAgentCallOptions.writer` (packages/agent/open-agent.ts) is
 * `{ write: (chunk) => Promise<void> | void } | undefined`, so the declared
 * type still structurally permits a callable `agentOptions.writer.write` to
 * cross the "use step" boundary, even though no current return statement in
 * that function sets `.writer`. This is the exact bug class #1281 exists to
 * catch; it just hasn't been exercised yet.
 *
 * Recommended follow-up: add "writer" to that Omit list in chat.ts.
 *
 * This list must only ever shrink. Do not add new entries here to silence a
 * violation — fix the return type instead.
 */
const KNOWN_PRE_EXISTING_STEP_RETURN_VIOLATIONS: Array<
  Omit<StepReturnViolation, "filePath"> & { fileName: string }
> = [
  {
    functionName: "resolveChatModelRuntime",
    fileName: "chat.ts",
    propertyPath: "agentOptions.writer.write",
  },
];

/**
 * Resolves the baseline above into full `StepReturnViolation` objects (with
 * absolute `filePath`s) for a given `apps/web/app/workflows` directory.
 */
export function resolveKnownPreExistingViolations(
  workflowsDir: string,
): StepReturnViolation[] {
  return KNOWN_PRE_EXISTING_STEP_RETURN_VIOLATIONS.map(
    ({ fileName, ...rest }) => ({
      ...rest,
      filePath: path.join(workflowsDir, fileName),
    }),
  );
}
