import "server-only";

import {
  getUserDefaultAgent,
  upsertUserDefaultAgent,
  deleteUserDefaultAgent,
  listAgentsForUser,
} from "@/lib/db/agents";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  agentPatchSchema,
  agentDeleteSchema,
  splitAgentPatchModel,
} from "./agents-api-mapper";
import type { AgentRole } from "@/lib/agents/resolve-agent";

/** The four canonical roles — returned in order by GET. */
const AGENT_ROLES: AgentRole[] = ["main", "explorer", "executor", "design"];

export type AgentSettingsRow = {
  role: AgentRole;
  modelId: string | null;
  inferenceProfileId: string | null;
  composioToolkitSlugs: string[];
  composioProfileId: string | null;
  instructions: string | null;
  managedRuntimeProfileId: string | null;
  githubToolsEnabled: boolean;
  toolAuthoringEnabled: boolean;
};

export type AgentSettingsResponse = {
  agents: AgentSettingsRow[];
};

/**
 * GET /api/settings/agents
 * Returns the four user_default agent rows for the authenticated user.
 * Roles with no row are returned with all-null fields (inheriting defaults).
 */
export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const rows = await listAgentsForUser({
    userId: authResult.userId,
  });

  const userDefaultByRole = new Map(
    rows.filter((r) => r.scope === "user_default").map((r) => [r.role, r]),
  );

  const agents: AgentSettingsRow[] = AGENT_ROLES.map((role) => {
    const row = userDefaultByRole.get(role);
    if (!row) {
      return {
        role,
        modelId: null,
        inferenceProfileId: null,
        composioToolkitSlugs: [],
        composioProfileId: null,
        instructions: null,
        managedRuntimeProfileId: null,
        githubToolsEnabled: false,
        toolAuthoringEnabled: false,
      };
    }
    return {
      role,
      modelId: row.modelId,
      inferenceProfileId: row.inferenceProfileId,
      composioToolkitSlugs: row.composioToolkitSlugs,
      composioProfileId: row.composioProfileId,
      instructions: row.instructions,
      managedRuntimeProfileId: row.managedRuntimeProfileId,
      githubToolsEnabled: row.githubToolsEnabled,
      toolAuthoringEnabled: row.toolAuthoringEnabled,
    };
  });

  return Response.json({ agents } satisfies AgentSettingsResponse);
}

/**
 * PATCH /api/settings/agents
 * Upsert a user_default agent row for one role.
 * Only scope=user_default writes are allowed from this endpoint.
 */
export async function PATCH(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = agentPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request body",
        details: parsed.error.flatten(),
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  const { role } = parsed.data;
  // A "user-profile:<profileId>:<modelId>" composite (emitted by the Settings
  // -> Agents "User model" picker) must never land in agents.model_id while
  // inference_profile_id stays null (#1157) — split it at this write
  // boundary, same as the read-side parsing in resolve-agent.ts.
  const patch = splitAgentPatchModel(parsed.data);

  await upsertUserDefaultAgent(authResult.userId, role, patch);

  const updated = await getUserDefaultAgent(authResult.userId, role);

  const result: AgentSettingsRow = {
    role,
    modelId: updated?.modelId ?? null,
    inferenceProfileId: updated?.inferenceProfileId ?? null,
    composioToolkitSlugs: updated?.composioToolkitSlugs ?? [],
    composioProfileId: updated?.composioProfileId ?? null,
    instructions: updated?.instructions ?? null,
    managedRuntimeProfileId: updated?.managedRuntimeProfileId ?? null,
    githubToolsEnabled: updated?.githubToolsEnabled ?? false,
    toolAuthoringEnabled: updated?.toolAuthoringEnabled ?? false,
  };

  return Response.json({ agent: result });
}

/**
 * DELETE /api/settings/agents
 * Reset a role to inherited (deletes its user_default row).
 */
export async function DELETE(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const parsed = agentDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request body",
        details: parsed.error.flatten(),
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  await deleteUserDefaultAgent(authResult.userId, parsed.data.role);

  return Response.json({ ok: true });
}
