import "server-only";

import { getComposioClient } from "./client";
import { getComposioConfig } from "./config";
import { redactComposioErrorMessage } from "./errors";

/**
 * Shared Composio toolkit catalog fetch/normalize logic, extracted from
 * `/api/composio/toolkits` (#805, epic #796 T9) so the repo Tools surface's
 * server-side data loader can reuse the SAME catalog source instead of a
 * parallel reimplementation. The route re-exports these types and calls this
 * module's `fetchComposioToolkitCatalog` so both callers stay identical.
 */

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

export type ComposioToolkitCatalogResult =
  | { ok: true; toolkits: ComposioToolkitSummary[] }
  | { ok: false; message: string };

/**
 * The ONE place that calls `composio.toolkits.get(...)` for the platform
 * catalog. Returns an empty, ok catalog when Composio isn't configured
 * (matches the route's existing behavior) and a distinct `{ ok: false }`
 * result on a real SDK failure so callers can surface an honest error
 * instead of silently treating a fetch failure as "zero toolkits exist".
 */
export async function fetchComposioToolkitCatalog(): Promise<ComposioToolkitCatalogResult> {
  if (!getComposioConfig().configured) {
    return { ok: true, toolkits: [] };
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

    return { ok: true, toolkits };
  } catch (error) {
    const message = redactComposioErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    return {
      ok: false,
      message: message || "Failed to load Composio toolkit catalog",
    };
  }
}
