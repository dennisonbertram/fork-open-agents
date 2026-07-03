import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  fetchComposioToolkitCatalog,
  type ComposioToolkitSummary,
} from "@/lib/composio/toolkit-catalog";

export type { ComposioToolkitSummary };

export interface ComposioToolkitsResponse {
  toolkits: ComposioToolkitSummary[];
}

// Catalog is platform-level (keyed only by the server API key), so it is safe to cache.
export const revalidate = 3600;

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const result = await fetchComposioToolkitCatalog();
  if (!result.ok) {
    return Response.json({ error: result.message }, { status: 502 });
  }

  return Response.json({
    toolkits: result.toolkits,
  } satisfies ComposioToolkitsResponse);
}
