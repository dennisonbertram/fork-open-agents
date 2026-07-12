import { z } from "zod";
import type {
  AutomationRunSource,
  AutomationTriggerSource,
  NormalizedRunId,
} from "./types";

export const runsListViews = [
  "all",
  "active",
  "attention",
  "completed",
] as const;
export type RunsListView = (typeof runsListViews)[number];

export interface RunsFilters {
  view: RunsListView;
  repoOwner?: string;
  repoName?: string;
  automationSource?: AutomationRunSource;
  automationId?: string;
  triggerSource?: Exclude<AutomationTriggerSource, "unknown">;
  triggerKind?: string;
  triggerId?: string;
}

export interface RunsCursor {
  createdAt: string;
  id: NormalizedRunId;
  queryKey: string;
}

export type ParsedRunsQuery =
  | {
      ok: true;
      value: { filters: RunsFilters; limit: number; cursor?: RunsCursor };
    }
  | { ok: false; error: string };

const rawQuerySchema = z
  .object({
    view: z.enum(runsListViews).default("all"),
    repoOwner: z.string().trim().min(1).max(100).optional(),
    repoName: z.string().trim().min(1).max(100).optional(),
    automationSource: z.enum(["background_agent", "agent_loop"]).optional(),
    automationId: z.string().trim().min(1).max(200).optional(),
    triggerSource: z
      .enum(["github", "schedule", "webhook", "manual"])
      .optional(),
    triggerKind: z.string().trim().min(1).max(100).optional(),
    triggerId: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(4096).optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.repoOwner) !== Boolean(value.repoName)) {
      context.addIssue({
        code: "custom",
        message: "repoOwner and repoName must be provided together",
      });
    }
    if (Boolean(value.automationSource) !== Boolean(value.automationId)) {
      context.addIssue({
        code: "custom",
        message: "automationSource and automationId must be provided together",
      });
    }
  });

const cursorSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().datetime({ offset: true }),
  id: z
    .string()
    .regex(/^(background_agent|agent_loop):.+$/)
    .transform((value) => value as NormalizedRunId),
  queryKey: z.string().min(1).max(2000),
});

export function buildRunsQueryKey(filters: RunsFilters): string {
  return JSON.stringify([
    filters.view,
    filters.repoOwner ?? null,
    filters.repoName ?? null,
    filters.automationSource ?? null,
    filters.automationId ?? null,
    filters.triggerSource ?? null,
    filters.triggerKind ?? null,
    filters.triggerId ?? null,
  ]);
}

export function encodeRunsCursor(cursor: RunsCursor): string {
  return Buffer.from(
    JSON.stringify({ version: 1, ...cursor }),
    "utf8",
  ).toString("base64url");
}

export function decodeRunsCursor(
  encoded: string,
  filters: RunsFilters,
): RunsCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid Runs cursor");
  }
  const cursor = cursorSchema.parse(decoded);
  if (cursor.queryKey !== buildRunsQueryKey(filters)) {
    throw new Error("Runs cursor filters do not match current filters");
  }
  const { version: _version, ...position } = cursor;
  return position;
}

export function parseRunsQuery(searchParams: URLSearchParams): ParsedRunsQuery {
  const value = (key: string) => searchParams.get(key)?.trim() || undefined;
  const parsed = rawQuerySchema.safeParse({
    view: value("view"),
    repoOwner: value("repoOwner"),
    repoName: value("repoName"),
    automationSource: value("automationSource"),
    automationId: value("automationId"),
    triggerSource: value("triggerSource"),
    triggerKind: value("triggerKind"),
    triggerId: value("triggerId"),
    limit: value("limit"),
    cursor: value("cursor"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid Runs query" };
  }

  const { limit, cursor: encodedCursor, ...filters } = parsed.data;
  try {
    return {
      ok: true,
      value: {
        filters,
        limit,
        ...(encodedCursor
          ? { cursor: decodeRunsCursor(encodedCursor, filters) }
          : {}),
      },
    };
  } catch {
    return { ok: false, error: "Invalid Runs cursor" };
  }
}
