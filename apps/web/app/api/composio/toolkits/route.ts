import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { getComposioClient } from "@/lib/composio/client";
import { getComposioConfig } from "@/lib/composio/config";

export interface ComposioToolkitSummary {
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  categories: string[];
  /** True when Composio provides managed OAuth — i.e. one-click "Connect" works. */
  managedAuth: boolean;
  /** True when the toolkit needs no account connection at all. */
  noAuth: boolean;
}

export interface ComposioToolkitsResponse {
  toolkits: ComposioToolkitSummary[];
}

/** Structural view of the @composio/core toolkit list item (avoids `any`). */
interface RawToolkit {
  slug?: string;
  name?: string;
  noAuth?: boolean;
  composioManagedAuthSchemes?: unknown[];
  meta?: {
    logo?: string | null;
    description?: string | null;
    categories?: Array<string | { name?: string; slug?: string }>;
  };
}

function toCategoryName(
  category: string | { name?: string; slug?: string },
): string | null {
  if (typeof category === "string") {
    return category;
  }
  return category.name ?? category.slug ?? null;
}

function normalizeToolkit(raw: RawToolkit): ComposioToolkitSummary | null {
  if (!raw.slug) {
    return null;
  }
  return {
    slug: raw.slug,
    name: raw.name ?? raw.slug,
    description: raw.meta?.description ?? null,
    logo: raw.meta?.logo ?? null,
    categories: (raw.meta?.categories ?? []).flatMap((category) => {
      const name = toCategoryName(category);
      return name ? [name] : [];
    }),
    managedAuth: (raw.composioManagedAuthSchemes?.length ?? 0) > 0,
    noAuth: Boolean(raw.noAuth),
  };
}

// Catalog is platform-level (keyed only by the server API key), so it is safe to cache.
export const revalidate = 3600;

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  if (!getComposioConfig().configured) {
    return Response.json({ toolkits: [] } satisfies ComposioToolkitsResponse);
  }

  try {
    const client = getComposioClient();
    const response = (await client.toolkits.get({})) as unknown as {
      items?: RawToolkit[];
    };
    const items = Array.isArray(response)
      ? (response as RawToolkit[])
      : (response.items ?? []);
    const toolkits = items
      .map(normalizeToolkit)
      .filter((value): value is ComposioToolkitSummary => value !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    return Response.json({ toolkits } satisfies ComposioToolkitsResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: message || "Failed to load Composio toolkits" },
      { status: 502 },
    );
  }
}
