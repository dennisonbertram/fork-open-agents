import { listManagedRuntimeProfiles } from "@open-agents/sandbox/managed-runtime-profiles";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  createManagedRuntimeSavedProfile,
  listUserDefaultProfiles,
} from "@/lib/db/managed-runtime-saved-profiles";

// --------------------------------------------------------------------------
// Shared validation schema (reused by the [profileId] PATCH route)
// --------------------------------------------------------------------------

export const commandSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  required: z.boolean().optional(),
});

export const createOrUpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1),
  description: z.string().trim().min(1),
  setupCommands: z.array(commandSchema).min(1),
  verificationCommands: z.array(commandSchema).min(1),
  expectedTools: z.array(z.string().trim().min(1)).default([]),
  optionalTools: z.array(z.string().trim().min(1)).default([]),
  defaultPorts: z.array(z.number().int().positive()).default([]),
});

export type CreateOrUpdateProfilePayload = z.infer<
  typeof createOrUpdateProfileSchema
>;

// --------------------------------------------------------------------------
// Response types
// --------------------------------------------------------------------------

export type RuntimeProfileOption = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  setupCommandCount: number;
  verificationCommandCount: number;
  expectedTools: string[];
  optionalTools: string[];
  defaultPorts: number[];
  source: "built_in" | "user_default";
  testStatus?: "untested" | "passed" | "failed";
  testedAt?: string | null;
};

export type RuntimeProfilesResponse = {
  profiles: RuntimeProfileOption[];
};

export type RuntimeProfileCreateResponse = {
  profile: RuntimeProfileOption;
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function toProfileOption(
  profile: {
    id: string;
    version: string;
    displayName: string;
    description: string;
    setupCommands: unknown[];
    verificationCommands: unknown[];
    expectedTools: string[];
    optionalTools: string[];
    defaultPorts: number[];
    testedAt?: Date | null;
    testFailureMessage?: string | null;
    testResults?: Array<{ status: string; required?: boolean }>;
  },
  source: RuntimeProfileOption["source"],
): RuntimeProfileOption {
  const testResults = profile.testResults ?? [];
  const hasEvidence =
    profile.testedAt ?? profile.testFailureMessage ?? testResults.length > 0;
  let testStatus: RuntimeProfileOption["testStatus"] = "untested";

  if (hasEvidence) {
    const hasRequiredFailure = testResults.some(
      (r) => r.status === "failed" && r.required !== false,
    );
    testStatus =
      profile.testFailureMessage || hasRequiredFailure ? "failed" : "passed";
  }

  return {
    id: profile.id,
    version: profile.version,
    displayName: profile.displayName,
    description: profile.description,
    setupCommandCount: profile.setupCommands.length,
    verificationCommandCount: profile.verificationCommands.length,
    expectedTools: profile.expectedTools,
    optionalTools: profile.optionalTools,
    defaultPorts: profile.defaultPorts,
    source,
    testStatus: source === "user_default" ? testStatus : undefined,
    testedAt:
      source === "user_default"
        ? (profile.testedAt?.toISOString() ?? null)
        : undefined,
  };
}

// --------------------------------------------------------------------------
// Route handlers
// --------------------------------------------------------------------------

export async function GET(_req: Request): Promise<Response> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const userProfiles = await listUserDefaultProfiles({ userId: auth.userId });
  const builtInProfiles = listManagedRuntimeProfiles();

  const userOptions = userProfiles.map((p) =>
    toProfileOption(p, "user_default"),
  );
  const builtInOptions = builtInProfiles.map((p) =>
    toProfileOption(
      {
        ...p,
        testResults: undefined,
        testedAt: undefined,
        testFailureMessage: undefined,
      },
      "built_in",
    ),
  );

  return Response.json({
    profiles: [...userOptions, ...builtInOptions],
  } satisfies RuntimeProfilesResponse);
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = createOrUpdateProfileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid managed runtime profile",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const profile = await createManagedRuntimeSavedProfile({
    userId: auth.userId,
    ...parsed.data,
  });

  return Response.json(
    {
      profile: toProfileOption(profile, "user_default"),
    } satisfies RuntimeProfileCreateResponse,
    { status: 201 },
  );
}
