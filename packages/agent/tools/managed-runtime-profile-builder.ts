import { tool, type UIToolInvocation } from "ai";
import { z } from "zod";

const profileCommandDraftSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  required: z.boolean().optional(),
});

export const managedRuntimeProfileDraftSchema = z.object({
  displayName: z.string().min(1),
  description: z.string().min(1),
  setupCommands: z.array(profileCommandDraftSchema).min(1),
  verificationCommands: z.array(profileCommandDraftSchema).min(1),
  expectedTools: z.array(z.string().min(1)).default([]),
  optionalTools: z.array(z.string().min(1)).default([]),
  defaultPorts: z.array(z.number().int().positive()).default([]),
});

export const setupManagedRuntimeProfileInputSchema = z.object({
  goal: z
    .string()
    .min(1)
    .describe("Why this repo needs a managed runtime profile."),
  repoSignals: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Repo files, scripts, frameworks, or failures that informed this draft.",
    ),
  draft: managedRuntimeProfileDraftSchema,
  questionsForUser: z
    .array(z.string().min(1))
    .default([])
    .describe("Open questions the user should answer before approving."),
});

export type SetupManagedRuntimeProfileInput = z.infer<
  typeof setupManagedRuntimeProfileInputSchema
>;

export const setupManagedRuntimeProfileOutputSchema = z.discriminatedUnion(
  "decision",
  [
    z.object({
      decision: z.literal("approved"),
      notes: z.string().optional(),
      savedProfileId: z.string().optional(),
      appliedToSessionId: z.string().optional(),
    }),
    z.object({
      decision: z.literal("revise"),
      instructions: z.string().min(1),
    }),
    z.object({
      decision: z.literal("discarded"),
      reason: z.string().optional(),
    }),
  ],
);

export type SetupManagedRuntimeProfileOutput = z.infer<
  typeof setupManagedRuntimeProfileOutputSchema
>;

export const setupManagedRuntimeProfileTool = tool({
  description: `Propose a managed runtime profile for the current repository and ask the user to review it.

Use this when the user asks to build, infer, adjust, or test managed runtime setup. Inspect the repo first, then submit a concrete profile draft with setup commands, verification commands, expected tools, and preview ports.

The client will show a review UI. Wait for the user's approval, revision request, or discard decision before treating the profile as accepted.`,
  inputSchema: setupManagedRuntimeProfileInputSchema,
  outputSchema: setupManagedRuntimeProfileOutputSchema,
  toModelOutput: ({ output }) => {
    if (!output) {
      return {
        type: "text",
        value: "The user has not reviewed the managed runtime profile draft.",
      };
    }

    if (output.decision === "approved") {
      const savedProfileText = output.savedProfileId
        ? ` Saved profile id: ${output.savedProfileId}.`
        : "";
      const appliedSessionText = output.appliedToSessionId
        ? ` Applied to session: ${output.appliedToSessionId}.`
        : "";
      return {
        type: "text",
        value: `The user approved the managed runtime profile draft.${savedProfileText}${appliedSessionText}${output.notes ? ` Notes: ${output.notes}` : ""}`,
      };
    }

    if (output.decision === "revise") {
      return {
        type: "text",
        value: `The user requested revisions to the managed runtime profile draft: ${output.instructions}`,
      };
    }

    return {
      type: "text",
      value: `The user discarded the managed runtime profile draft.${output.reason ? ` Reason: ${output.reason}` : ""}`,
    };
  },
});

export type SetupManagedRuntimeProfileToolUIPart = UIToolInvocation<
  typeof setupManagedRuntimeProfileTool
>;
