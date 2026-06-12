import { z } from "zod";

/**
 * Validates that a URL is either:
 * - https:// (any host, required for production MCP servers)
 * - http://localhost or http://127.0.0.1 (allowed for dev servers)
 */
function isAllowedMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") {
      return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    }
    return false;
  } catch {
    return false;
  }
}

export const createMcpServerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  url: z.string().url("Must be a valid URL").refine(isAllowedMcpUrl, {
    message:
      "URL must use https:// (or http://localhost / http://127.0.0.1 for local servers)",
  }),
  transport: z.enum(["http", "sse"]).default("http"),
  headers: z
    .record(z.string().max(100), z.string().max(2000))
    .refine((headers) => Object.keys(headers).length <= 10, {
      message: "At most 10 headers allowed",
    })
    .optional(),
});

export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;

export const updateMcpServerSchema = createMcpServerSchema
  .partial()
  .strict()
  .extend({
    enabled: z.boolean().optional(),
    /** Passing null clears all headers. */
    headers: z
      .record(z.string().max(100), z.string().max(2000))
      .refine((headers) => Object.keys(headers).length <= 10, {
        message: "At most 10 headers allowed",
      })
      .nullable()
      .optional(),
  });

export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;
