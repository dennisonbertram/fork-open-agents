import { z } from "zod";

/**
 * Strict allowlist schema for PATCH /api/sessions/[sessionId] bodies.
 *
 * `.strict()` rejects any key not explicitly listed here, closing the mass
 * assignment hole where a client could set arbitrary session columns (e.g.
 * `userId`, `sandboxState`) by including them in the request body.
 */
export const updateSessionRequestSchema = z
  .object({
    title: z.string().optional(),
    status: z.enum(["running", "completed", "failed", "archived"]).optional(),
    runtimeMode: z.enum(["classic", "managed_runtime"]).optional(),
    managedRuntimeProfileId: z.string().optional(),
    inferenceProfileId: z.string().nullable().optional(),
    linesAdded: z.number().optional(),
    linesRemoved: z.number().optional(),
    prNumber: z.number().optional(),
    prStatus: z.enum(["open", "merged", "closed"]).optional(),
  })
  .strict();

export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>;

/**
 * Extracts the rejected key names from a Zod error produced by
 * `updateSessionRequestSchema.safeParse`. Used only for structured logging,
 * so values are never included, only the offending field names.
 *
 * `.strict()` reports disallowed keys as a single `unrecognized_keys` issue
 * with an empty `path` and a `keys` array, rather than one issue per key, so
 * both shapes are handled here.
 */
export function invalidUpdateSessionKeys(error: z.ZodError): string[] {
  const keys = error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys;
    }
    const [key] = issue.path;
    return typeof key === "string" ? [key] : [];
  });
  return [...new Set(keys)];
}
